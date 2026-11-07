import {
  EFFECT_TYPES,
  LOCATION_BY_ID,
  EXCLUSIVE_FLAGS,
  RESERVED_FLAG_PREFIXES,
  SECRET_BY_ID,
  TECH_BY_ID,
  TECHNOLOGIES,
  RESOURCES,
  type Character,
  type Effect,
  type EventCategory,
  type EventScope,
  type FacilityId,
  type HistoricalEvent,
  type ResourceId,
  type Settlement,
  type StateChange,
  type WorldState,
} from "@genesis/schemas";
import { EffectError, InsufficientResourcesError } from "./errors";
import { activeSettlements, allocateHistoryId, currentYear, fullName, getCharacter, nearestClaimable, projectOf, relationshipKey, rivalOf, round2, tensionKey } from "./queries";
import { say } from "./texts";

/** Collects every transition made inside a transaction. */
export interface ChangeRecorder {
  changes: StateChange[];
  childEvents: HistoricalEvent[];
}

export function newRecorder(): ChangeRecorder {
  return { changes: [], childEvents: [] };
}

export interface EffectContext {
  tick: number;
  settlementId: string | null;
  roles: Record<string, string>;
  /** History id of the event applying these effects (for provenance). */
  historyId: string;
  title: string;
  scope: EventScope;
  category: EventCategory;
  storylineIds: string[];
  /** Season index the event happens in (default: spring of this tick). Follow-ups count from it. */
  season?: number;
}

function record(rec: ChangeRecorder, path: string, label: string, before: StateChange["before"], after: StateChange["after"]) {
  if (before === after) return;
  rec.changes.push({
    path,
    label,
    before: typeof before === "number" ? round2(before) : before,
    after: typeof after === "number" ? round2(after) : after,
  });
}

/** Gain or lose a resource. Losses clamp at zero and record the actual delta. */
export function adjustResource(s: Settlement, resource: ResourceId, amount: number, rec: ChangeRecorder): number {
  if (!Number.isFinite(amount)) throw new EffectError(`Non-finite resource amount for ${resource}`);
  const before = s.resources[resource];
  const after = Math.max(0, before + amount);
  s.resources[resource] = after;
  record(rec, `settlements.${s.id}.resources.${resource}`, `${s.name} ${resource}`, before, after);
  return after - before;
}

/**
 * Spend resources. Unlike losses, spending must be fully affordable — the
 * whole spend is rejected if any resource is insufficient.
 */
export function spendResources(s: Settlement, costs: Partial<Record<ResourceId, number>>, rec: ChangeRecorder): void {
  for (const r of RESOURCES) {
    const need = costs[r] ?? 0;
    if (need < 0) throw new EffectError(`Negative cost for ${r}`);
    if (s.resources[r] + 1e-9 < need) {
      throw new InsufficientResourcesError(`${s.name} cannot spend ${need} ${r} (has ${round2(s.resources[r])})`);
    }
  }
  for (const r of RESOURCES) {
    const need = costs[r] ?? 0;
    if (need > 0) adjustResource(s, r, -need, rec);
  }
}

export function canAfford(s: Settlement, costs: Partial<Record<ResourceId, number>> | undefined): boolean {
  if (!costs) return true;
  return RESOURCES.every((r) => s.resources[r] + 1e-9 >= (costs[r] ?? 0));
}

function targetSettlements(state: WorldState, target: "settlement" | "all_settlements", ctx: EffectContext): Settlement[] {
  if (target === "all_settlements") return activeSettlements(state);
  if (!ctx.settlementId) throw new EffectError("Effect targets a settlement but the event has no target settlement");
  const s = state.settlements.find((x) => x.id === ctx.settlementId);
  if (!s || s.status !== "active") throw new EffectError(`Target settlement ${ctx.settlementId} is not active`);
  return [s];
}

/** Returns the living character bound to a role, null for unfilled optional roles. */
function roleCharacter(state: WorldState, role: string, ctx: EffectContext) {
  const id = ctx.roles[role];
  if (id === undefined) return null;
  const c = getCharacter(state, id);
  if (!c) throw new EffectError(`Role "${role}" refers to unknown character ${id}`);
  if (c.deathTick !== null) throw new EffectError(`${fullName(c)} is dead and cannot take part in events`);
  return c;
}

/** Unlock a technology, enforcing prerequisites. Shared by research and narrative effects. */
export function unlockTechnology(state: WorldState, techId: string, rec: ChangeRecorder): boolean {
  const tech = TECH_BY_ID[techId];
  if (!tech) throw new EffectError(`Unknown technology "${techId}"`);
  if (state.technologies.includes(techId)) return false;
  const missing = tech.prerequisites.filter((p) => !state.technologies.includes(p));
  if (missing.length > 0) {
    throw new EffectError(`Cannot unlock ${tech.name}: missing prerequisites ${missing.join(", ")}`);
  }
  state.technologies.push(techId);
  state.techUnlockedAt[techId] = state.tick;
  record(rec, `technologies.${techId}`, `Technology ${tech.name}`, false, true);
  return true;
}

export function discoverLocation(state: WorldState, locationId: string, rec: ChangeRecorder): boolean {
  if (!LOCATION_BY_ID[locationId]) throw new EffectError(`Unknown location "${locationId}"`);
  const loc = state.locations.find((l) => l.id === locationId);
  if (!loc) throw new EffectError(`Location "${locationId}" missing from world state`);
  if (loc.discovered) return false;
  loc.discovered = true;
  loc.discoveredTick = state.tick;
  record(rec, `locations.${locationId}.discovered`, `${LOCATION_BY_ID[locationId]!.name} discovered`, false, true);
  return true;
}

/** The building in the worst shape that is not already being repaired. */
export function worstFacility(s: Settlement): FacilityId | undefined {
  return (Object.entries(s.facilities ?? {}) as [FacilityId, number][])
    .filter(([f, c]) => c < 100 && s.building?.[f] === undefined)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

export const INHERIT = { share: 0.5, min: 40 } as const;

/** When someone dies, their children inherit their strongest bonds, friend and foe, at half strength. */
export function inheritBonds(st: WorldState, dead: Character): void {
  const children = st.characters.filter((c) => c.deathTick === null && c.parentIds.includes(dead.id));
  if (children.length === 0) return;
  for (const [key, v] of Object.entries(st.relationships)) {
    if (Math.abs(v) < INHERIT.min) continue;
    const [a, b] = key.split("|");
    const other = a === dead.id ? b : b === dead.id ? a : null;
    if (!other) continue;
    const o = getCharacter(st, other);
    if (!o || o.deathTick !== null) continue;
    for (const child of children) {
      if (child.id === other) continue;
      const k = relationshipKey(child.id, other);
      const inherited = Math.round(v * INHERIT.share);
      const now = st.relationships[k] ?? 0;
      if (Math.abs(now) >= Math.abs(inherited)) continue;
      st.relationships[k] = inherited;
      child.lifeEvents.push({ tick: st.tick, text: inherited > 0 ? say(st).inheritedFriend(fullName(dead), fullName(o)) : say(st).inheritedFeud(fullName(dead), fullName(o)), historyId: null });
    }
  }
}

/** Shift tension between two settlements, clamped to 0–100. Shared with the conflict rules. */
export function changeTension(state: WorldState, a: string, b: string, delta: number, rec?: ChangeRecorder): number {
  const key = tensionKey(a, b);
  const before = state.tensions?.[key] ?? 0;
  const after = Math.round(Math.min(100, Math.max(0, before + delta)) * 100) / 100;
  if (after === before) return after;
  state.tensions ??= {};
  state.tensions[key] = after;
  if (rec) record(rec, `tensions.${key}`, `Tension ${key}`, before, after);
  return after;
}

/**
 * Apply one typed effect to a draft world state. Unknown effect types are
 * rejected — content (including AI drafts) cannot run arbitrary code.
 */
export function applyEffect(state: WorldState, effect: Effect, ctx: EffectContext, rec: ChangeRecorder): void {
  switch (effect.type) {
    case "ADJUST_RESOURCE": {
      for (const s of targetSettlements(state, effect.target, ctx)) {
        if (effect.from && effect.amount > 0) {
          // Only what the land still holds can be taken from it.
          const loc = state.locations.find((l) => l.id === s.locationId);
          const pool = loc?.[effect.from] ?? 0;
          const take = Math.min(effect.amount, pool);
          if (!loc || take <= 0) continue;
          loc[effect.from] = round2(pool - take);
          record(rec, `locations.${loc.id}.${effect.from}`, `${loc.id} ${effect.from}`, pool, loc[effect.from]!);
          adjustResource(s, effect.resource, take, rec);
        } else adjustResource(s, effect.resource, effect.amount, rec);
      }
      return;
    }
    case "ADD_SEEDS":
    case "CHANGE_FERTILITY":
    case "SET_FARM_PLAN":
    case "CHANGE_CROPS": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const farm = (s!.farm ??= { seeds: 0, fertility: 100, crops: [], harvests: 0 });
      if (effect.type === "ADD_SEEDS") {
        const before = farm.seeds;
        farm.seeds = round2(Math.max(0, before + effect.amount));
        record(rec, `settlements.${s!.id}.farm.seeds`, `${s!.name} seed`, before, farm.seeds);
      } else if (effect.type === "CHANGE_FERTILITY") {
        const before = farm.fertility;
        farm.fertility = Math.max(0, Math.min(150, before + effect.delta));
        record(rec, `settlements.${s!.id}.farm.fertility`, `${s!.name} fertility`, before, farm.fertility);
      } else if (effect.type === "SET_FARM_PLAN") {
        const before = farm.plan ?? "seedsave";
        farm.plan = effect.plan;
        record(rec, `settlements.${s!.id}.farm.plan`, `${s!.name} farm plan`, before, effect.plan);
      } else {
        const before = farm.crops.reduce((n, c) => n + c.seeds, 0);
        for (const c of farm.crops) c.seeds = round2(c.seeds * (1 + effect.fraction));
        record(rec, `settlements.${s!.id}.farm.crops`, `${s!.name} crops`, before, farm.crops.reduce((n, c) => n + c.seeds, 0));
      }
      return;
    }
    case "PRIORITIZE_BRANCH": {
      const active = new Set((state.projects ?? []).map((p) => p.techId));
      const next = TECHNOLOGIES.filter((t) => t.branch === effect.branch && !state.technologies.includes(t.id) && !active.has(t.id) && t.prerequisites.every((p) => state.technologies.includes(p)))
        .sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : 1))[0];
      if (!next) return;
      const before = state.researchFocus;
      state.researchFocus = next.id;
      record(rec, "researchFocus", "Research focus", before, next.id);
      return;
    }
    case "CHANGE_SETTLEMENT_STAT": {
      for (const s of targetSettlements(state, effect.target, ctx)) {
        const before = s[effect.stat];
        const raw = before + effect.delta;
        const after = effect.stat === "capacity" ? Math.max(0, Math.round(raw)) : Math.min(100, Math.max(0, raw));
        s[effect.stat] = after;
        record(rec, `settlements.${s.id}.${effect.stat}`, `${s.name} ${effect.stat}`, before, after);
      }
      return;
    }
    case "EXCHANGE": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const rival = rivalOf(state, s!);
      if (!rival) return;
      // Only what both sides actually have changes hands, in the agreed proportion.
      const share = Math.min(1, rival.resources[effect.get.resource] / effect.get.amount, effect.give ? s!.resources[effect.give.resource] / effect.give.amount : 1);
      if (share <= 0) return;
      const got = effect.get.amount * share;
      const move = (from: Settlement, to: Settlement, r: ResourceId, n: number) => {
        const amount = Math.min(round2(n), from.resources[r]);
        if (amount <= 0) return;
        const fb = from.resources[r];
        from.resources[r] = round2(fb - amount);
        record(rec, `settlements.${from.id}.resources.${r}`, `${from.name} ${r}`, fb, from.resources[r]);
        const tb = to.resources[r];
        to.resources[r] = round2(tb + amount);
        record(rec, `settlements.${to.id}.resources.${r}`, `${to.name} ${r}`, tb, to.resources[r]);
      };
      move(rival, s!, effect.get.resource, got);
      if (effect.give) move(s!, rival, effect.give.resource, effect.give.amount * share);
      return;
    }
    case "CHANGE_PROJECT": {
      const holder = effect.role ? roleCharacter(state, effect.role, ctx) : null;
      const p = effect.role
        ? (holder ? projectOf(state, holder.id) : undefined)
        : (state.projects ?? []).find((x) => x.techId === effect.tech);
      if (!p) return; // nobody is building it: the moment passes
      const tech = TECH_BY_ID[p.techId]!;
      if (effect.progress !== undefined) {
        const before = p.progress;
        p.progress = round2(Math.max(0, Math.min(tech.cost - 0.01, p.progress + tech.cost * effect.progress)));
        record(rec, `projects.${p.id}.progress`, `Project ${tech.name}`, before, p.progress);
      }
      if (effect.approach) {
        const before = p.approach ?? "steady";
        p.approach = effect.approach;
        record(rec, `projects.${p.id}.approach`, `Project ${tech.name} approach`, before, effect.approach);
      }
      return;
    }
    case "BUILD_FACILITY": {
      const [s] = targetSettlements(state, "settlement", ctx);
      if (effect.facility === "worst") {
        const worst = worstFacility(s!);
        if (!worst) return;
        applyEffect(state, { ...effect, facility: worst }, ctx, rec);
        return;
      }
      if (effect.seasons) {
        // On a building that already stands this is a repair: it keeps working as it is until the work is done.
        if (s!.building?.[effect.facility] !== undefined) return; // already being built or repaired
        const due = (ctx.season ?? ctx.tick * 4) + effect.seasons;
        s!.building = { ...(s!.building ?? {}), [effect.facility]: due };
        record(rec, `settlements.${s!.id}.building.${effect.facility}`, `${s!.name} builds ${effect.facility}`, null, due);
        return;
      }
      const before = s!.facilities?.[effect.facility] ?? null;
      s!.facilities = { ...(s!.facilities ?? {}), [effect.facility]: 100 };
      record(rec, `settlements.${s!.id}.facilities.${effect.facility}`, `${s!.name} ${effect.facility}`, before, 100);
      return;
    }
    case "CHANGE_FACILITY": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const have = Object.entries(s!.facilities ?? {}) as [FacilityId, number][];
      const id = effect.facility === "any"
        ? [...have].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
        : effect.facility === "worst" ? worstFacility(s!)
        : have.some(([k]) => k === effect.facility) ? effect.facility : undefined;
      if (!id) return; // nothing there to damage or mend
      const before = s!.facilities![id]!;
      const after = Math.max(0, Math.min(100, before + effect.delta));
      s!.facilities![id] = after;
      record(rec, `settlements.${s!.id}.facilities.${id}`, `${s!.name} ${id}`, before, after);
      return;
    }
    case "ENACT_LAW":
    case "REPEAL_LAW": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const had = !!s!.laws?.includes(effect.law);
      const want = effect.type === "ENACT_LAW";
      if (had === want) return;
      s!.laws = want ? [...(s!.laws ?? []), effect.law] : (s!.laws ?? []).filter((l) => l !== effect.law);
      record(rec, `settlements.${s!.id}.laws.${effect.law}`, `${s!.name} law ${effect.law}`, had, want);
      return;
    }
    case "CLAIM_SITE": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const loc = effect.location === "nearest" ? nearestClaimable(state) : state.locations.find((l) => l.id === effect.location);
      if (!loc || !loc.discovered || loc.settlementId) return; // unknown, or someone lives there
      const before = loc.claimedBy ?? null;
      // A site belongs to one settlement at a time; taking it from another goes through CEDE_CLAIM.
      if (before !== null) return;
      loc.claimedBy = s!.id;
      record(rec, `locations.${loc.id}.claimedBy`, `${LOCATION_BY_ID[loc.id]?.name ?? loc.id} claim`, before, s!.id);
      return;
    }
    case "CEDE_CLAIM": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const rival = rivalOf(state, s!);
      const loc = state.locations.find((l) => l.claimedBy === s!.id && !l.settlementId);
      if (!rival || rival.status !== "active" || !loc) return;
      loc.claimedBy = rival.id;
      record(rec, `locations.${loc.id}.claimedBy`, `${LOCATION_BY_ID[loc.id]?.name ?? loc.id} claim`, s!.id, rival.id);
      return;
    }
    case "ADD_SPECIALTY": {
      const c = roleCharacter(state, effect.role, ctx);
      if (!c || c.specialties?.includes(effect.specialty)) return;
      c.specialties = [...(c.specialties ?? []), effect.specialty];
      record(rec, `characters.${c.id}.specialties.${effect.specialty}`, `${fullName(c)} learns ${effect.specialty}`, false, true);
      return;
    }
    case "AFTER": {
      const due = (ctx.season ?? ctx.tick * 4) + effect.seasons;
      const actor = ctx.roles.actor ?? "";
      const id = `${ctx.historyId}:after${actor ? `:${actor}` : ""}:${(state.scheduled ?? []).length}`;
      state.scheduled ??= [];
      state.scheduled.push({
        id, definitionId: "", dueSeason: due, settlementId: ctx.settlementId, roles: { ...ctx.roles }, causeId: ctx.historyId,
        inline: { title: effect.title, text: effect.text, effects: effect.effects, risk: effect.risk, away: effect.away ?? [], category: ctx.category },
      });
      record(rec, `scheduled.${id}`, `Follow-up: ${effect.title}`, null, due);
      for (const r of effect.away ?? []) {
        const c = roleCharacter(state, r, ctx);
        if (c) c.awayUntil = Math.max(c.awayUntil ?? 0, due);
      }
      return;
    }
    case "SCHEDULE_EVENT": {
      const due = (ctx.season ?? ctx.tick * 4) + effect.seasons;
      const actor = ctx.roles.actor ?? "";
      const id = `${ctx.historyId}:${effect.event}${actor ? `:${actor}` : ""}`;
      state.scheduled ??= [];
      if (state.scheduled.some((x) => x.id === id)) return;
      state.scheduled.push({ id, definitionId: effect.event, dueSeason: due, settlementId: ctx.settlementId, roles: { ...ctx.roles }, causeId: ctx.historyId, ...(effect.away?.length ? { away: effect.away } : {}) });
      record(rec, `scheduled.${id}`, `Follow-up ${effect.event}`, null, due);
      for (const r of effect.away ?? []) {
        const c = roleCharacter(state, r, ctx);
        if (c) c.awayUntil = Math.max(c.awayUntil ?? 0, due);
      }
      return;
    }
    case "CHANGE_TENSION": {
      const [s] = targetSettlements(state, "settlement", ctx);
      const rival = rivalOf(state, s!);
      if (!rival) return;
      changeTension(state, s!.id, rival.id, effect.delta, rec);
      return;
    }
    case "CHANGE_RELATIONSHIP": {
      const a = roleCharacter(state, effect.a, ctx);
      const b = roleCharacter(state, effect.b, ctx);
      if (!a || !b) return; // optional role unfilled
      if (a.id === b.id) throw new EffectError("A character cannot have a relationship with themselves");
      const key = relationshipKey(a.id, b.id);
      const before = state.relationships[key] ?? 0;
      // Warm people make friends faster: positive changes scale with both sides' social skill.
      const delta = effect.delta > 0 && a.attributes && b.attributes
        ? Math.round(effect.delta * (0.6 + a.attributes.social / 250 + b.attributes.social / 250))
        : effect.delta;
      const after = Math.max(-100, Math.min(100, before + delta));
      state.relationships[key] = after;
      record(rec, `relationships.${key}`, `${fullName(a)} ↔ ${fullName(b)}`, before, after);
      return;
    }
    case "DISCOVER_LOCATION":
      discoverLocation(state, effect.location, rec);
      return;
    case "UNLOCK_TECHNOLOGY":
      unlockTechnology(state, effect.tech, rec);
      return;
    case "ADD_WORLD_FLAG": {
      if (RESERVED_FLAG_PREFIXES.some((p) => effect.flag.startsWith(p))) {
        throw new EffectError(`Flag "${effect.flag}" is in a reserved namespace; secrets can only be revealed with REVEAL_SECRET`);
      }
      // Rival outcomes cannot both hold: this one replaces the others in its group.
      for (const other of EXCLUSIVE_FLAGS.find((g) => g.includes(effect.flag)) ?? []) {
        if (other === effect.flag || state.flags[other] === undefined) continue;
        record(rec, `flags.${other}`, `Flag ${other}`, state.flags[other]!, null);
        delete state.flags[other];
        delete state.flagOrigins[other];
      }
      const before = state.flags[effect.flag] ?? null;
      state.flags[effect.flag] = effect.value;
      state.flagOrigins[effect.flag] = ctx.historyId;
      record(rec, `flags.${effect.flag}`, `Flag ${effect.flag}`, before, effect.value);
      return;
    }
    case "REMOVE_WORLD_FLAG": {
      if (RESERVED_FLAG_PREFIXES.some((p) => effect.flag.startsWith(p))) {
        throw new EffectError(`Flag "${effect.flag}" is in a reserved namespace`);
      }
      const before = state.flags[effect.flag];
      if (before === undefined) return;
      delete state.flags[effect.flag];
      delete state.flagOrigins[effect.flag];
      record(rec, `flags.${effect.flag}`, `Flag ${effect.flag}`, before, null);
      return;
    }
    case "REVEAL_SECRET": {
      if (!SECRET_BY_ID[effect.secret]) throw new EffectError(`Unknown secret "${effect.secret}"`);
      if (state.secrets[effect.secret]) return;
      state.secrets[effect.secret] = { revealedTick: state.tick, historyId: ctx.historyId };
      record(rec, `secrets.${effect.secret}`, `Secret ${SECRET_BY_ID[effect.secret]!.title}`, "hidden", "revealed");
      return;
    }
    case "CREATE_HISTORICAL_EVENT": {
      // Append-only: creates a NEW record linked to the parent. There is no effect that edits history.
      const id = allocateHistoryId(state);
      rec.childEvents.push({
        id,
        tick: state.tick,
        year: currentYear(state),
        kind: "narrative",
        definitionId: null,
        definitionVersion: null,
        category: ctx.category,
        scope: ctx.scope,
        importance: effect.importance,
        title: effect.title,
        text: effect.description,
        settlementIds: ctx.settlementId ? [ctx.settlementId] : [],
        characterIds: Object.values(ctx.roles),
        storylineIds: ctx.storylineIds,
        causeIds: [ctx.historyId],
        parentId: ctx.historyId,
        trigger: null,
        choice: null,
        changes: [],
      });
      return;
    }
    case "ADD_LIFE_EVENT": {
      const c = roleCharacter(state, effect.role, ctx);
      if (!c) return;
      c.lifeEvents.push({ tick: state.tick, text: effect.text, historyId: ctx.historyId });
      return;
    }
    case "CHARACTER_DEATH": {
      const c = roleCharacter(state, effect.role, ctx);
      if (!c) return;
      c.deathTick = state.tick;
      c.causeOfDeath = effect.cause;
      c.lifeEvents.push({ tick: state.tick, text: say(state).diedEvent(effect.cause), historyId: ctx.historyId });
      state.stats.deaths += 1;
      record(rec, `characters.${c.id}.alive`, `${fullName(c)} alive`, true, false);
      inheritBonds(state, c);
      return;
    }
    case "ADJUST_ATTRIBUTE": {
      const c = roleCharacter(state, effect.role, ctx);
      if (!c || !c.attributes) return; // optional role unfilled, or a world without attributes
      const before = c.attributes[effect.attribute];
      const after = Math.max(0, Math.min(100, before + effect.delta));
      c.attributes[effect.attribute] = after;
      record(rec, `characters.${c.id}.attributes.${effect.attribute}`, `${fullName(c)} ${effect.attribute}`, before, after);
      return;
    }
    case "ADD_CARETAKER": {
      const carer = roleCharacter(state, effect.caretaker, ctx);
      const ward = roleCharacter(state, effect.ward, ctx);
      if (!carer || !ward) return;
      if (carer.id === ward.id) throw new EffectError("A character cannot look after themselves");
      if (ward.caretakerIds?.includes(carer.id)) return;
      ward.caretakerIds = [...(ward.caretakerIds ?? []), carer.id];
      record(rec, `characters.${ward.id}.caretakers`, `${fullName(carer)} looks after ${fullName(ward)}`, false, true);
      return;
    }
    default: {
      const unknown = effect as { type?: unknown };
      throw new EffectError(`Unsupported effect type "${String(unknown.type)}". Allowed: ${EFFECT_TYPES.join(", ")}`);
    }
  }
}

export function applyEffects(state: WorldState, effects: readonly Effect[], ctx: EffectContext, rec: ChangeRecorder): void {
  for (const e of effects) applyEffect(state, e, ctx, rec);
}

/**
 * Run a mutation against a deep copy. Either every change commits or none do.
 */
export function transact<T>(state: WorldState, fn: (draft: WorldState) => T): { state: WorldState; result: T } {
  const draft = structuredClone(state);
  const result = fn(draft);
  return { state: draft, result };
}
