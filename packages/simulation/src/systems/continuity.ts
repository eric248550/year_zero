import { ADULT_AGE, LOCATION_BY_ID, PROFESSIONS, type Character, type Settlement } from "@genesis/schemas";
import { activeSettlements, changeTension, characterAge, getSettlement, hasTech, placeName, population, residents, round2, say } from "@genesis/narrative";
import type { TickContext } from "../context";
import { newCharacterId, randomName } from "../world-factory";
import { TRAITS } from "../names";
import { initAttributes } from "./attributes";

/** Tension a supplied outpost adds with its founder each year (see conflict.ts). */
const CONFLICT_OUTPOST_BURDEN = 2;

export const CONTINUITY = {
  /** An outpost is kept stocked to this many years of food and water per person. */
  outpostReserveYears: 1.5,
  /** The founder only gives what it has beyond this many years of its own. */
  parentReserveYears: 1.5,
  /** An outpost stands on its own after this long, or earlier once it is big and fed. */
  outpostMaxYears: 15,
  outpostMinYears: 6,
  outpostIndependentPop: 20,
  /** Wanderers find the region more often when it is empty. */
  wandererChance: (pop: number) => (pop < 40 ? 0.5 : pop < 100 ? 0.15 : 0.05),
} as const;

const yearlyNeed = (st: TickContext["state"], s: Settlement) =>
  residents(st, s.id).reduce((n, c) => n + (characterAge(st, c) >= ADULT_AGE ? 1 : 0.6), 0);

/**
 * Outposts are not on their own yet: before consumption, the settlement that
 * founded one tops up its food and water from whatever it can spare. No
 * randomness. An outpost becomes independent once it is big enough and fed,
 * or after a fixed number of years.
 */
export function supplyOutposts(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    if (!s.supportedBy) continue;
    const parent = getSettlement(st, s.supportedBy);
    const age = st.tick - s.foundedTick;
    const pop = population(st, s.id);
    const fed = s.shortage.food === 0 && s.shortage.water === 0;
    if (!parent || parent.status !== "active" || age >= CONTINUITY.outpostMaxYears || (age >= CONTINUITY.outpostMinYears - (hasTech(st, "homesteading") ? 2 : 0) && pop >= CONTINUITY.outpostIndependentPop && fed)) {
      s.supportedBy = null;
      ctx.system({
        category: "settlement",
        importance: "notable",
        title: say(st).outpostStandsTitle(s.name),
        text: say(st).outpostStandsText(s.name, parent?.name ?? ""),
        settlementIds: [s.id],
        changes: [{ path: `settlements.${s.id}.supportedBy`, label: s.name, before: parent?.id ?? null, after: null }],
      });
      continue;
    }
    const need = yearlyNeed(st, s);
    const parentNeed = yearlyNeed(st, parent);
    for (const r of ["food", "water"] as const) {
      const want = need * CONTINUITY.outpostReserveYears - s.resources[r];
      const spare = parent.resources[r] - parentNeed * CONTINUITY.parentReserveYears;
      const give = round2(Math.max(0, Math.min(want, spare)));
      if (give <= 0) continue;
      parent.resources[r] = round2(parent.resources[r] - give);
      // Feeding someone else's town year after year breeds resentment.
      changeTension(st, parent.id, s.id, CONFLICT_OUTPOST_BURDEN);
      s.resources[r] = round2(s.resources[r] + give);
    }
  }
}

function wanderer(ctx: TickContext, home: Settlement): Character {
  const st = ctx.state;
  const age = ctx.rng.int(16, 45);
  const c: Character = {
    id: newCharacterId(st),
    ...randomName(ctx.rng, undefined, st.locale),
    birthTick: st.tick - age,
    deathTick: null,
    causeOfDeath: null,
    profession: age >= ADULT_AGE ? ctx.rng.pick(PROFESSIONS) : null,
    homeId: home.id,
    parentIds: [],
    traits: [ctx.rng.pick(TRAITS)],
    lifeEvents: [{ tick: st.tick, text: say(st).survivedWastes(), historyId: null }],
  };
  st.characters.push(c);
  initAttributes(st, ctx.rng, c);
  return c;
}

/**
 * A settlement can die; the world does not. Survivors keep walking in from
 * the wastes, more often when the region is nearly empty, and if no one is
 * left at all a band of them settles a known site and starts over.
 */
export function wanderers(ctx: TickContext): void {
  const st = ctx.state;
  const pop = population(st);
  const gates = st.flags["society.open_gates"] ? 1.6 : st.flags["society.closed_gates"] ? 0.4 : 1;
  if (!ctx.rng.chance(Math.min(0.9, CONTINUITY.wandererChance(pop) * gates))) return;
  const n = ctx.rng.int(3, 8);
  let home = [...activeSettlements(st)].sort((a, b) => b.capacity - population(st, b.id) - (a.capacity - population(st, a.id)) || (a.id < b.id ? -1 : 1))[0];
  let refugees = false;
  if (!home) {
    const sites = st.locations.filter((l) => l.discovered && !l.settlementId && LOCATION_BY_ID[l.id]?.settleable);
    if (sites.length === 0) return;
    const loc = ctx.rng.pick(sites);
    const id = `s-${String(st.counters.nextSettlement).padStart(3, "0")}`;
    st.counters.nextSettlement += 1;
    home = {
      id,
      name: placeName(st, loc.id),
      locationId: loc.id,
      kind: "settlement",
      status: "active",
      foundedTick: st.tick,
      abandonedTick: null,
      level: 1,
      morale: 45,
      health: 55,
      capacity: 40,
      resources: { food: n * 2, water: n * 2, materials: 10, knowledge: 0 },
      shortage: { food: 0, water: 0 },
      shortageOrigin: { food: null, water: null },
      supportedBy: null,
      // They bring the little seed they carried with them.
      farm: { seeds: 8, fertility: 100, crops: [], harvests: 0 },
    };
    st.settlements.push(home);
    loc.settlementId = id;
    refugees = true;
  }
  const people = Array.from({ length: n }, () => wanderer(ctx, home!));
  const e = ctx.system({
    category: "demographic",
    importance: refugees ? "major" : "notable",
    title: refugees ? say(st).refugeesTitle(home.name) : say(st).wanderersTitle(n, home.name),
    text: refugees ? say(st).refugeesText(home.name) : say(st).wanderersText(n, home.name),
    settlementIds: [home.id],
    characterIds: people.map((c) => c.id),
  });
  for (const c of people) c.lifeEvents.push({ tick: st.tick, text: e.title, historyId: e.id });
}
