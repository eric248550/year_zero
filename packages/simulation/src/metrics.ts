import { TECHNOLOGIES, type WorldState } from "@genesis/schemas";
import { activeSettlements, currentYear, population, round2, totalResource } from "@genesis/narrative";

export interface TickMetrics {
  tick: number;
  year: number;
  population: number;
  settlements: number;
  food: number;
  water: number;
  materials: number;
  knowledge: number;
  technologies: number;
  births: number;
  deaths: number;
  morale: number;
  health: number;
  events: number;
  status: WorldStatus;
}

export type WorldStatus = "thriving" | "stable" | "struggling" | "crisis" | "collapsed";

export function worldStatus(state: WorldState): WorldStatus {
  const pop = population(state);
  if (pop === 0) return "collapsed";
  const active = activeSettlements(state);
  if (active.some((s) => s.shortage.food >= 2 || s.shortage.water >= 2)) return "crisis";
  const avgMorale = active.reduce((a, s) => a + s.morale, 0) / Math.max(1, active.length);
  const avgHealth = active.reduce((a, s) => a + s.health, 0) / Math.max(1, active.length);
  if (avgMorale < 40 || avgHealth < 45 || active.some((s) => s.shortage.food > 0 || s.shortage.water > 0)) return "struggling";
  if (active.length >= 2 && state.technologies.length >= 4 && avgMorale >= 55) return "thriving";
  return "stable";
}

export function worldEra(state: WorldState): { name: string; description: string } {
  const n = state.technologies.length;
  if (n <= 1) return { name: "Emergence", description: "Survivors take their first steps on the surface." };
  if (n <= 4) return { name: "Rebuilding", description: "Basic survival technologies are being recovered." };
  if (n <= 7) return { name: "Expansion", description: "Communities spread and specialise." };
  if (n < TECHNOLOGIES.length) return { name: "Renewal", description: "Infrastructure links the settlements together." };
  return { name: "New Dawn", description: "The bunker archives are exhausted; what comes next is unwritten." };
}

export function computeMetrics(state: WorldState, extra: { births: number; deaths: number; events: number }): TickMetrics {
  const active = activeSettlements(state);
  const avg = (f: (s: (typeof active)[number]) => number) => (active.length ? round2(active.reduce((a, s) => a + f(s), 0) / active.length) : 0);
  return {
    tick: state.tick,
    year: currentYear(state),
    population: population(state),
    settlements: active.length,
    food: round2(totalResource(state, "food")),
    water: round2(totalResource(state, "water")),
    materials: round2(totalResource(state, "materials")),
    knowledge: round2(totalResource(state, "knowledge")),
    technologies: state.technologies.length,
    births: extra.births,
    deaths: extra.deaths,
    morale: avg((s) => s.morale),
    health: avg((s) => s.health),
    events: extra.events,
    status: worldStatus(state),
  };
}
