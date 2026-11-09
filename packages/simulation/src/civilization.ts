import { FACILITY_WORKING, PLANNING, type FacilityId, type WorldState } from "@genesis/schemas";
import { activeSettlements, facilityLevel, population, powerAt } from "@genesis/narrative";

/**
 * The world's main line: rebuilding civilization. Five stages, each a short
 * list of milestones read straight from the world (technologies, settlements,
 * people, story flags). Derived, never stored, so it changes no replay.
 */
export type MilestoneCheck =
  | { kind: "tech"; tech: string }
  | { kind: "population"; min: number }
  | { kind: "settlements"; min: number }
  | { kind: "flag"; flag: string }
  | { kind: "anyFlag"; flags: string[] }
  /** A settlement has this working now. */
  | { kind: "facility"; facility: FacilityId }
  /** A settlement's fields have come in at least once. */
  | { kind: "harvested" }
  /** Power after dark, from any source: stored sun, a water-driven dynamo, or a line from elsewhere. */
  | { kind: "nightPower"; min: number }
  /** Daytime power, anywhere. */
  | { kind: "powered"; min: number }
  /** Settlements joined by working lines, with a source on the line. */
  | { kind: "linked"; min: number }
  /** Any of these counts: equivalent ways of having the same thing. */
  | { kind: "any"; of: MilestoneCheck[] }
  | { kind: "all"; of: MilestoneCheck[] };

export interface CivMilestone {
  id: string;
  check: MilestoneCheck;
}

export interface CivStage {
  id: "survive" | "root" | "connect" | "order" | "renewal";
  milestones: CivMilestone[];
}

export const CIV_STAGES: readonly CivStage[] = [
  {
    id: "survive",
    milestones: [
      { id: "water", check: { kind: "tech", tech: "water_purification" } },
      { id: "hydroponics", check: { kind: "tech", tech: "hydroponics" } },
      { id: "surface", check: { kind: "settlements", min: 2 } },
    ],
  },
  {
    id: "root",
    milestones: [
      { id: "harvest", check: { kind: "any", of: [{ kind: "flag", flag: "food.surface_farming" }, { kind: "harvested" }] } },
      { id: "irrigation", check: { kind: "tech", tech: "irrigation" } },
      { id: "workshop", check: { kind: "tech", tech: "workshop" } },
      { id: "school", check: { kind: "any", of: [{ kind: "flag", flag: "culture.school" }, { kind: "facility", facility: "schoolhouse" }] } },
      { id: "people", check: { kind: "population", min: 140 } },
    ],
  },
  {
    id: "connect",
    milestones: [
      { id: "caravan", check: { kind: "any", of: [{ kind: "flag", flag: "trade.caravan" }, { kind: "tech", tech: "trade_routes" }] } },
      { id: "network", check: { kind: "settlements", min: 3 } },
      { id: "homesteading", check: { kind: "tech", tech: "homesteading" } },
      { id: "radio", check: { kind: "tech", tech: "radio" } },
      { id: "clinic", check: { kind: "tech", tech: "field_medicine" } },
    ],
  },
  {
    id: "order",
    milestones: [
      // Any settled way of governing counts: an elected assembly, a council of elders, or a written charter.
      { id: "assembly", check: { kind: "any", of: [{ kind: "anyFlag", flags: ["governance.assembly", "governance.elder_council"] }, { kind: "tech", tech: "civic_charter" }] } },
      { id: "schooling", check: { kind: "tech", tech: "schooling" } },
      { id: "antibiotics", check: { kind: "tech", tech: "antibiotics" } },
      { id: "trade", check: { kind: "tech", tech: "trade_routes" } },
      { id: "people", check: { kind: "population", min: 200 } },
    ],
  },
  {
    id: "renewal",
    milestones: [
      // What counts is light after dark, however it is made. A night once lit stays in the record.
      { id: "light", check: { kind: "any", of: [{ kind: "flag", flag: "power.first_light" }, { kind: "nightPower", min: PLANNING.nightPower }] } },
      { id: "grid", check: { kind: "all", of: [{ kind: "tech", tech: "power_grid" }, { kind: "linked", min: 2 }] } },
      { id: "institute", check: { kind: "all", of: [{ kind: "tech", tech: "research_institute" }, { kind: "powered", min: PLANNING.nightPower }] } },
      { id: "charter", check: { kind: "tech", tech: "civic_charter" } },
      { id: "people", check: { kind: "population", min: 300 } },
    ],
  },
];

export interface CivMilestoneStatus extends CivMilestone {
  done: boolean;
  /** For counts: where the world is now. */
  current: number | null;
}

export interface CivilizationStatus {
  /** Index of the stage being worked on; equals CIV_STAGES.length once everything is done. */
  stage: number;
  stages: { id: CivStage["id"]; done: boolean; milestones: CivMilestoneStatus[] }[];
  done: number;
  total: number;
}

/** Settlements on a working line that actually carries power. */
export function linkedSettlements(state: WorldState): number {
  const on = activeSettlements(state).filter((s) => (s.facilities?.power_lines ?? 0) >= FACILITY_WORKING);
  return on.some((s) => powerAt(state, s).day > 0) ? on.length : 0;
}

export function check(state: WorldState, c: MilestoneCheck): { done: boolean; current: number | null } {
  switch (c.kind) {
    case "facility": return { done: activeSettlements(state).some((s) => facilityLevel(s, c.facility) > 0), current: null };
    case "harvested": return { done: activeSettlements(state).some((s) => (s.farm?.harvests ?? 0) > 0), current: null };
    case "nightPower": return { done: activeSettlements(state).some((s) => powerAt(state, s).night >= c.min), current: null };
    case "powered": return { done: activeSettlements(state).some((s) => powerAt(state, s).day >= c.min), current: null };
    case "linked": { const n = linkedSettlements(state); return { done: n >= c.min, current: n }; }
    case "any": return { done: c.of.some((x) => check(state, x).done), current: null };
    case "all": return { done: c.of.every((x) => check(state, x).done), current: null };
    case "tech": return { done: state.technologies.includes(c.tech), current: null };
    case "flag": return { done: state.flags[c.flag] !== undefined && state.flags[c.flag] !== false, current: null };
    case "anyFlag": return { done: c.flags.some((f) => state.flags[f] !== undefined && state.flags[f] !== false), current: null };
    case "population": { const n = population(state); return { done: n >= c.min, current: n }; }
    case "settlements": { const n = activeSettlements(state).length; return { done: n >= c.min, current: n }; }
  }
}

export function civilization(state: WorldState): CivilizationStatus {
  const stages = CIV_STAGES.map((s) => {
    const milestones = s.milestones.map((m) => ({ ...m, ...check(state, m.check) }));
    return { id: s.id, done: milestones.every((m) => m.done), milestones };
  });
  const firstOpen = stages.findIndex((s) => !s.done);
  const all = stages.flatMap((s) => s.milestones);
  return { stage: firstOpen === -1 ? stages.length : firstOpen, stages, done: all.filter((m) => m.done).length, total: all.length };
}
