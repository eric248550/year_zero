import { LOCATION_BY_ID, TECHNOLOGIES, type Character, type Settlement } from "@genesis/schemas";
import { activeSettlements, characterAge, hasTech, population, residents, round2 } from "@genesis/narrative";
import type { TickContext } from "../context";
import { placeDescription, placeName, say } from "@genesis/narrative";

export const FOUNDING_MATERIALS = 30;

export function foundingBlocker(ctx: TickContext, locationId: string, from: Settlement, settlers: number): string | null {
  const st = ctx.state;
  const info = LOCATION_BY_ID[locationId];
  const loc = st.locations.find((l) => l.id === locationId);
  if (!info || !loc) return `Unknown location ${locationId}`;
  if (!loc.discovered) return `${info.name} has not been discovered`;
  if (!info.settleable) return `${info.name} cannot support a settlement`;
  if (loc.settlementId) return `${info.name} is already settled`;
  if (from.status !== "active") return `${from.name} is not active`;
  const pop = population(st, from.id);
  if (pop < settlers + 4) return `${from.name} needs at least ${settlers + 4} residents to send ${settlers} settlers`;
  if (from.resources.materials < FOUNDING_MATERIALS) return `${from.name} needs ${FOUNDING_MATERIALS} materials`;
  return null;
}

/** Move settlers (and their young children) to found a new surface settlement. */
export function foundSettlement(ctx: TickContext, locationId: string, from: Settlement, settlers: number, reason: string): Settlement {
  const st = ctx.state;
  const info = LOCATION_BY_ID[locationId]!;
  const loc = st.locations.find((l) => l.id === locationId)!;
  // Player-controlled characters decide for themselves and are never moved by the council.
  const people = residents(st, from.id).filter((c) => !c.controllerId);
  const adults = ctx.rng.shuffle(people.filter((c) => characterAge(st, c) >= 16));
  const movers: Character[] = adults.slice(0, settlers);
  const moverIds = new Set(movers.map((m) => m.id));
  for (const child of people.filter((c) => characterAge(st, c) < 16)) {
    if (child.parentIds.some((p) => moverIds.has(p))) movers.push(child);
  }

  const share = movers.length / Math.max(1, people.length);
  const id = `s-${String(st.counters.nextSettlement).padStart(3, "0")}`;
  st.counters.nextSettlement += 1;
  const transfer = {
    food: round2(from.resources.food * share),
    water: round2(from.resources.water * share),
    materials: FOUNDING_MATERIALS,
    knowledge: 0,
  };
  from.resources.food = round2(from.resources.food - transfer.food);
  from.resources.water = round2(from.resources.water - transfer.water);
  from.resources.materials = round2(from.resources.materials - transfer.materials);

  const settlement: Settlement = {
    id,
    name: placeName(st, locationId),
    locationId,
    kind: "settlement",
    status: "active",
    foundedTick: st.tick,
    abandonedTick: null,
    level: 1,
    morale: round2(Math.min(100, from.morale + 5)),
    health: from.health,
    capacity: 40 + (hasTech(st, "power_grid") ? 10 : 0),
    supportedBy: from.id,
    resources: transfer,
    shortage: { food: 0, water: 0 },
    shortageOrigin: { food: null, water: null },
  };
  st.settlements.push(settlement);
  loc.settlementId = id;
  for (const m of movers) m.homeId = id;

  const e = ctx.system({
    category: "settlement",
    importance: "major",
    title: say(st).foundTitle(placeName(st, locationId)),
    text: say(st).foundText(movers.length, from.name, placeName(st, locationId), placeDescription(st, locationId)),
    settlementIds: [id, from.id],
    characterIds: movers.map((m) => m.id),
    changes: [
      { path: `settlements.${id}.status`, label: `${info.name}`, before: null, after: "active" },
      { path: `settlements.${from.id}.population`, label: `${from.name} population`, before: people.length, after: people.length - movers.length },
      { path: `settlements.${from.id}.resources.materials`, label: `${from.name} materials`, before: round2(from.resources.materials + transfer.materials), after: from.resources.materials },
    ],
    summary: reason,
  });
  for (const m of movers) m.lifeEvents.push({ tick: st.tick, text: say(st).helpedFound(placeName(st, locationId)), historyId: e.id });
  return settlement;
}

/** Abandon empty settlements and detect civilizational collapse. */
export function abandonment(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    if (population(st, s.id) > 0) continue;
    s.status = "abandoned";
    s.abandonedTick = st.tick;
    const loc = st.locations.find((l) => l.id === s.locationId);
    if (loc && s.kind !== "bunker") loc.settlementId = null;
    ctx.system({
      category: "settlement",
      importance: "major",
      title: say(st).silentTitle(s.name),
      text: say(st).silentText(s.name),
      settlementIds: [s.id],
      changes: [{ path: `settlements.${s.id}.status`, label: s.name, before: "active", after: "abandoned" }],
    });
  }
  if (population(st) === 0 && !st.milestones.includes("collapse")) {
    st.milestones.push("collapse");
    ctx.system({
      category: "milestone",
      importance: "critical",
      title: say(st).lastTitle(),
      text: say(st).lastText(),
    });
  }
}

const POPULATION_MILESTONES = [200, 300, 500, 800, 1200] as const;

export function milestones(ctx: TickContext): void {
  const st = ctx.state;
  const pop = population(st);
  st.stats.peakPopulation = Math.max(st.stats.peakPopulation, pop);
  for (const m of POPULATION_MILESTONES) {
    const key = `population.${m}`;
    if (pop >= m && !st.milestones.includes(key)) {
      st.milestones.push(key);
      ctx.system({
        category: "milestone",
        importance: "major",
        title: say(st).popTitle(m),
        text: say(st).popText(pop),
      });
    }
  }
  const settlements = activeSettlements(st).length;
  if (settlements >= 3 && !st.milestones.includes("settlements.3")) {
    st.milestones.push("settlements.3");
    ctx.system({ category: "milestone", importance: "major", title: say(st).networkTitle(), text: say(st).networkText(settlements) });
  }
  if (st.technologies.length === TECHNOLOGIES.length && !st.milestones.includes("tech.all")) {
    st.milestones.push("tech.all");
    ctx.system({ category: "milestone", importance: "critical", title: say(st).rebuildTitle(), text: say(st).rebuildText() });
  }
}
