import type { WorldState } from "@genesis/schemas";
import { activeSettlements, population } from "@genesis/narrative";

/**
 * The world's main line: rebuilding civilization. Five stages, each a short
 * list of milestones read straight from the world (technologies, settlements,
 * people, story flags). Derived, never stored, so it changes no replay.
 */
export type MilestoneCheck =
  | { kind: "tech"; tech: string }
  | { kind: "population"; min: number }
  | { kind: "settlements"; min: number }
  | { kind: "flag"; flag: string };

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
      { id: "harvest", check: { kind: "flag", flag: "food.surface_farming" } },
      { id: "irrigation", check: { kind: "tech", tech: "irrigation" } },
      { id: "workshop", check: { kind: "tech", tech: "workshop" } },
      { id: "school", check: { kind: "flag", flag: "culture.school" } },
      { id: "people", check: { kind: "population", min: 140 } },
    ],
  },
  {
    id: "connect",
    milestones: [
      { id: "caravan", check: { kind: "flag", flag: "trade.caravan" } },
      { id: "network", check: { kind: "settlements", min: 3 } },
      { id: "homesteading", check: { kind: "tech", tech: "homesteading" } },
      { id: "radio", check: { kind: "tech", tech: "radio" } },
      { id: "clinic", check: { kind: "tech", tech: "field_medicine" } },
    ],
  },
  {
    id: "order",
    milestones: [
      { id: "assembly", check: { kind: "flag", flag: "governance.assembly" } },
      { id: "schooling", check: { kind: "tech", tech: "schooling" } },
      { id: "antibiotics", check: { kind: "tech", tech: "antibiotics" } },
      { id: "trade", check: { kind: "tech", tech: "trade_routes" } },
      { id: "people", check: { kind: "population", min: 200 } },
    ],
  },
  {
    id: "renewal",
    milestones: [
      { id: "light", check: { kind: "flag", flag: "power.first_light" } },
      { id: "grid", check: { kind: "tech", tech: "power_grid" } },
      { id: "institute", check: { kind: "tech", tech: "research_institute" } },
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

function check(state: WorldState, c: MilestoneCheck): { done: boolean; current: number | null } {
  switch (c.kind) {
    case "tech": return { done: state.technologies.includes(c.tech), current: null };
    case "flag": return { done: state.flags[c.flag] !== undefined && state.flags[c.flag] !== false, current: null };
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
