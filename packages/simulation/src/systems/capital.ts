import { ADULT_AGE, LOCATION_BY_ID, PLANNING, PRIORITIES, type Character, type PriorityId, type Settlement, type WorldState } from "@genesis/schemas";
import { activeSettlements, characterAge, good, headOf, residents } from "@genesis/narrative";
import type { TickContext } from "../context";
import { majorWorkDelay, nextPlanStep } from "../planning";
import { proposeBuilding, proposePriority } from "./work";

const PRIORITY_TAGS: Record<PriorityId, string[]> = { food: ["community"], industry: ["industry", "growth"], knowledge: ["science"], expansion: ["bold", "growth"], health: ["community", "cautious"], hoard: ["cautious"] };

/**
 * What a settlement's circumstances lean it toward: its ground, what it is
 * short of, what it already is. Nothing is assigned to a place by name.
 */
export function leaningOf(st: WorldState, s: Settlement): PriorityId | null {
  const land = LOCATION_BY_ID[s.locationId]?.features ?? [];
  const here = st.locations.find((l) => l.id === s.locationId);
  const people = Math.max(1, residents(st, s.id).length);
  const score: Partial<Record<PriorityId, number>> = {
    food: (land.includes("fertile") ? 2 : 0) + (s.shortage.food > 0 || s.resources.food / people < 1.2 ? 3 : 0),
    industry: (land.includes("ruins") || (here?.ore ?? 0) > 0 ? 2 : 0) + (st.technologies.includes("workshop") && good(s, "parts") < 5 ? 1 : 0),
    knowledge: s.kind === "bunker" ? 2 : 0,
    health: s.health < 50 ? 2.5 : 0,
    expansion: st.locations.some((l) => !l.discovered) && people > s.capacity * 0.8 ? 1.5 : 0,
  };
  const best = PRIORITIES.map((p) => ({ p, n: score[p] ?? 0 })).sort((a, b) => b.n - a.n)[0]!;
  return best.n >= 1.5 ? best.p : null;
}

function direction(ctx: TickContext, s: Settlement): void {
  const st = ctx.state;
  if (st.tick < 10) return;
  const crisis = s.shortage.food >= PLANNING.crisisYears && s.priority !== "food";
  if (s.priority && !crisis) return;
  const open = (st.proposals ?? []).filter((p) => p.settlementId === s.id && p.key === "settlement-priority").sort((a, b) => (b.resolvedTick ?? b.createdTick) - (a.resolvedTick ?? a.createdTick))[0];
  if (open && (open.status === "open" || st.tick - (open.resolvedTick ?? open.createdTick) < (crisis ? PLANNING.afterRejected : PLANNING.directionYears))) return;
  const lean = crisis ? "food" : leaningOf(st, s);
  if (!lean) return;
  const npc = (c: Character | undefined) => !!c && !c.controllerId;
  const profession = lean === "food" ? "Farmer" : lean === "industry" ? "Engineer" : lean === "knowledge" ? "Scientist" : lean === "health" ? "Medic" : "Scout";
  const head = headOf(st, s, profession);
  const speaker = npc(head) ? head : residents(st, s.id).find((c) => !c.controllerId && characterAge(st, c) >= ADULT_AGE);
  if (speaker) proposePriority(ctx, speaker, lean, PRIORITY_TAGS[lean]);
}

function majorWork(ctx: TickContext, s: Settlement): void {
  const st = ctx.state;
  const f = nextPlanStep(st, s);
  if (!f || majorWorkDelay(st, s, f) !== null) return;
  const leader = residents(st, s.id).filter((c) => !c.controllerId && c.profession === "Engineer" && characterAge(st, c) >= ADULT_AGE && (c.attributes?.knowledge ?? 0) >= PLANNING.competence).sort((a, b) => (b.attributes?.knowledge ?? 0) - (a.attributes?.knowledge ?? 0) || (a.id < b.id ? -1 : 1))[0];
  if (!leader || !ctx.rng.chance(0.25 + (leader.attributes?.knowledge ?? 0) / 200)) return;
  proposeBuilding(ctx, leader, s, f);
  const stats = ctx.state.stats;
  stats.plans ??= { proposed: 0, approved: 0, rejected: 0, failed: 0 };
  stats.plans.proposed += 1;
}

/** Each year a settlement's NPC leaders may put forward a direction or the next major work. Everything goes to a vote. */
export function leadership(ctx: TickContext): void {
  for (const id of activeSettlements(ctx.state).map((s) => s.id)) {
    const s = ctx.state.settlements.find((x) => x.id === id)!;
    direction(ctx, s);
    const fresh = ctx.state.settlements.find((x) => x.id === id)!;
    majorWork(ctx, fresh);
  }
}
