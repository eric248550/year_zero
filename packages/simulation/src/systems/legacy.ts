import {
  CLAIM_YIELD,
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
  characterAge,
  facilityName,
  fullName,
  getCharacter,
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

export function hasLaw(s: Settlement | undefined, law: LawId): boolean {
  return !!s?.laws?.includes(law);
}

/** Upkeep for every building; announce the ones that break. */
export function facilities(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    for (const [id, cond] of Object.entries(s.facilities ?? {}) as [FacilityId, number][]) {
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
    for (const [r, n] of Object.entries(CLAIM_YIELD[loc.id] ?? {}) as [ResourceId, number][]) owner.resources[r] = round2(owner.resources[r] + n);
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
