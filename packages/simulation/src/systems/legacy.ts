import {
  CLAIM_SEED,
  CLAIM_YIELD,
  LAND,
  INFRASTRUCTURE,
  LOCATION_BY_ID,
  FACILITY_WORKING,
  type Character,
  type FacilityId,
  type LawId,
  type ResourceId,
  type Settlement,
  type WorldState,
} from "@genesis/schemas";
import {
  activeSettlements,
  changeTension,
  facilityLevel,
  characterAge,
  facilityName,
  fullName,
  getCharacter,
  residents,
  round2,
  say,
  specialtyName,
} from "@genesis/narrative";
import type { TickContext } from "../context";

/**
 * What a world keeps: buildings that stand or fall, laws, claimed sites,
 * skills handed down, and grudges and friendships that outlive the people
 * who made them.
 */
export const LEGACY = {
  /** Materials per building per year. Paid: it slowly mends. Unpaid: it decays. */
  upkeep: 1,
  mend: 3,
  decay: 8,
  /** Tension each claim adds with every other settlement per year (envy). */
  claimEnvy: 0.3,
  /** Chance per year a youngster picks up a parent's or carer's specialty. */
  teachChance: 0.12,
  /** Share of a dead person's strong bonds their children inherit. */
} as const;

export function working(s: Settlement | undefined, f: FacilityId): boolean {
  return (s?.facilities?.[f] ?? 0) >= FACILITY_WORKING;
}

/** How much of its effect a building gives: 0 when missing or broken, else its condition (0.3–1). */
export function level(s: Settlement | undefined, f: FacilityId): number {
  return facilityLevel(s, f);
}

/** Wild food grows back each year, up to what the land can carry. Salvage does not. */
export function land(ctx: TickContext): void {
  for (const l of ctx.state.locations) {
    const cap = LAND.wildCap(LOCATION_BY_ID[l.id]?.features ?? []);
    if (cap <= 0) continue;
    l.wild = round2(Math.min(cap, (l.wild ?? 0) + cap * LAND.wildRegrowth));
  }
}

/**
 * Settlements that know a technology build its infrastructure for themselves:
 * one construction a year, paid in materials up front, finished in seasons.
 * Broken buildings are rebuilt the same way.
 */
export function infrastructure(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    if (residents(st, s.id).length < 8 || Object.keys(s.building ?? {}).length > 0) continue;
    const features = LOCATION_BY_ID[s.locationId]?.features ?? [];
    for (const [f, info] of Object.entries(INFRASTRUCTURE) as [FacilityId, NonNullable<(typeof INFRASTRUCTURE)[FacilityId]>][]) {
      if (!st.technologies.includes(info.tech) || (info.needs && !features.includes(info.needs))) continue;
      if (info.after && facilityLevel(s, info.after) <= 0) continue; // a generator needs a water mill to turn it
      const cond = s.facilities?.[f] ?? 0;
      // Worn below 60: repair it (half the cost). Missing or broken: build it.
      const repair = cond >= FACILITY_WORKING && cond < 60;
      if (cond >= FACILITY_WORKING && !repair) continue;
      const cost = repair ? Math.ceil(info.materials / 2) : info.materials;
      // Keep enough for a year of upkeep and emergencies.
      if (s.resources.materials < cost + 20) continue;
      const before = s.resources.materials;
      s.resources.materials = round2(before - cost);
      const due = st.tick * 4 + (repair ? 1 : info.seasons);
      s.building = { ...(s.building ?? {}), [f]: due };
      ctx.system({
        category: "settlement",
        importance: "minor",
        title: say(st).buildStartTitle(s.name, facilityName(st, f)),
        text: say(st).buildStartText(s.name, facilityName(st, f), info.seasons),
        settlementIds: [s.id],
        changes: [
          { path: `settlements.${s.id}.resources.materials`, label: `${s.name} materials`, before, after: s.resources.materials },
          { path: `settlements.${s.id}.building.${f}`, label: `${s.name} builds ${f}`, before: null, after: due },
        ],
        summary: `${info.tech} is known here; ${cost} materials${repair ? " (repair)" : ""}`,
      });
      break;
    }
  }
}

export function hasLaw(s: Settlement | undefined, law: LawId): boolean {
  return !!s?.laws?.includes(law);
}

/** Upkeep for every building; announce the ones that break. */
export function facilities(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    for (const [id, cond] of Object.entries(s.facilities ?? {}) as [FacilityId, number][]) {
      // Fields are kept up by the people who farm them, not with materials.
      if (id === "fields") { s.facilities![id] = Math.min(100, cond + LEGACY.mend); continue; }
      const paid = s.resources.materials >= LEGACY.upkeep;
      if (paid) s.resources.materials = round2(s.resources.materials - LEGACY.upkeep);
      const after = Math.max(0, Math.min(100, cond + (paid ? LEGACY.mend : -LEGACY.decay)));
      s.facilities![id] = after;
      if (cond >= FACILITY_WORKING && after < FACILITY_WORKING) {
        ctx.system({
          category: "settlement",
          importance: "notable",
          title: say(st).facilityBrokeTitle(s.name, facilityName(st, id)),
          text: say(st).facilityBrokeText(s.name, facilityName(st, id)),
          settlementIds: [s.id],
          changes: [{ path: `settlements.${s.id}.facilities.${id}`, label: `${s.name} ${id}`, before: cond, after }],
        });
      }
    }
  }
}

/**
 * Finish construction (and repairs) whose season falls in this year. Runs just
 * before this year's follow-ups, so a field sown in spring is ready for the
 * autumn harvest in the same year.
 */
export function construction(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    // A settlement expansion takes a year of building before anyone can live in it.
    if (s.expanding !== undefined && s.expanding < (st.tick + 1) * 4) {
      const before = { level: s.level, capacity: s.capacity };
      delete s.expanding;
      s.level += 1;
      s.capacity += s.kind === "bunker" ? 4 : 10;
      s.morale = Math.min(100, s.morale + 5);
      ctx.system({
        category: "settlement",
        importance: "notable",
        title: say(st).growTitle(s.name, s.level),
        text: say(st).growText(s.name, s.capacity),
        settlementIds: [s.id],
        changes: [
          { path: `settlements.${s.id}.level`, label: `${s.name} level`, before: before.level, after: s.level },
          { path: `settlements.${s.id}.capacity`, label: `${s.name} capacity`, before: before.capacity, after: s.capacity },
        ],
      });
    }
    // Construction sites whose season has come are finished.
    for (const [id, due] of Object.entries(s.building ?? {}) as [FacilityId, number][]) {
      if (due >= (st.tick + 1) * 4) continue;
      const before = s.facilities?.[id] ?? null;
      delete s.building![id];
      s.facilities = { ...(s.facilities ?? {}), [id]: 100 };
      ctx.system({
        category: "settlement",
        importance: "notable",
        title: say(st).facilityDoneTitle(s.name, facilityName(st, id)),
        text: say(st).facilityDoneText(s.name, facilityName(st, id)),
        settlementIds: [s.id],
        characterIds: st.characters.filter((c) => c.deathTick === null && c.controllerId && c.homeId === s.id).map((c) => c.id),
        changes: [{ path: `settlements.${s.id}.facilities.${id}`, label: `${s.name} ${id}`, before, after: 100 }],
      });
    }
  }
}

/** Raise the building a finished technology comes with, in the settlement that built it. */
export function raiseFacility(st: WorldState, s: Settlement, f: FacilityId): boolean {
  if ((s.facilities?.[f] ?? 0) >= FACILITY_WORKING) return false;
  s.facilities = { ...(s.facilities ?? {}), [f]: 100 };
  return true;
}

/** Claimed sites yield to their claimant; others resent it. Settled sites drop their claim. */
export function claims(ctx: TickContext): void {
  const st = ctx.state;
  const active = activeSettlements(st);
  for (const loc of st.locations) {
    if (!loc.claimedBy) continue;
    const owner = active.find((s) => s.id === loc.claimedBy);
    if (!owner || loc.settlementId) { loc.claimedBy = null; continue; }
    // Materials come out of the site's salvage and food out of its wild growth: only what is there.
    for (const [r, n] of Object.entries(CLAIM_YIELD[loc.id] ?? {}) as [ResourceId, number][]) {
      const pool = r === "materials" ? "salvage" : r === "food" ? "wild" : null;
      const got = pool ? Math.min(n, loc[pool] ?? 0) : n;
      if (pool) loc[pool] = round2((loc[pool] ?? 0) - got);
      owner.resources[r] = round2(owner.resources[r] + got);
    }
    const seed = CLAIM_SEED[loc.id];
    if (seed) { owner.farm ??= { seeds: 0, fertility: 100, crops: [], harvests: 0 }; owner.farm.seeds = round2(owner.farm.seeds + seed); }
    for (const other of active) if (other.id !== owner.id) changeTension(st, owner.id, other.id, LEGACY.claimEnvy);
  }
}

/** The young pick up what their parents and carers know. */
export function teaching(ctx: TickContext): void {
  const st = ctx.state;
  for (const c of st.characters) {
    if (c.deathTick !== null) continue;
    const age = characterAge(st, c);
    if (age < 12 || age > 22) continue;
    const mentors = [...c.parentIds, ...(c.caretakerIds ?? [])]
      .map((id) => getCharacter(st, id))
      .filter((m): m is Character => !!m && m.deathTick === null && m.homeId === c.homeId && !!m.specialties?.length);
    const options = mentors.flatMap((m) => (m.specialties ?? []).filter((x) => !c.specialties?.includes(x)).map((x) => ({ m, x })));
    if (options.length === 0 || !ctx.rng.chance(LEGACY.teachChance)) continue;
    const { m, x } = ctx.rng.pick(options);
    c.specialties = [...(c.specialties ?? []), x];
    c.lifeEvents.push({ tick: st.tick, text: say(st).learnedFrom(fullName(m), specialtyName(st, x)), historyId: null });
  }
}

/** Work multiplier from a matching specialty. */
export function specialtyBoost(c: Character, branch: string): number {
  return c.specialties?.some((x) => SPECIALTY_BRANCH[x] === branch) ? 1.5 : 1;
}

const SPECIALTY_BRANCH: Record<string, string> = { grafting: "farming", smithing: "industry", wiring: "energy", midwifery: "medicine", archivist: "knowledge", wayfinding: "society" };

export function isAway(st: WorldState, c: Character): boolean {
  return c.awayUntil !== undefined && c.awayUntil >= st.tick * 4;
}
