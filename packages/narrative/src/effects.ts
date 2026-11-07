import {
  EFFECT_TYPES,
  LOCATION_BY_ID,
  RESERVED_FLAG_PREFIXES,
  SECRET_BY_ID,
  TECH_BY_ID,
  RESOURCES,
  type Effect,
  type EventCategory,
  type EventScope,
  type HistoricalEvent,
  type ResourceId,
  type Settlement,
  type StateChange,
  type WorldState,
} from "@genesis/schemas";
import { EffectError, InsufficientResourcesError } from "./errors";
import { activeSettlements, allocateHistoryId, currentYear, fullName, getCharacter, relationshipKey, rivalOf, round2, tensionKey } from "./queries";
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
      for (const s of targetSettlements(state, effect.target, ctx)) adjustResource(s, effect.resource, effect.amount, rec);
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
