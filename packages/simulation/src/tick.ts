import { PlayerActionSchema, Rng, type EventDefinition, type HistoricalEvent, type PlayerAction, type WorldState } from "@genesis/schemas";
import { choiceAvailability, resolvePendingDecisions, runNarrativePhase, runPersonalPhase, type EventRejection } from "@genesis/narrative";
import { TickContext } from "./context";
import { computeMetrics, type TickMetrics } from "./metrics";
import { applyAction, councilDecisions, validateAction } from "./systems/agents";
import { consume, produce, wellbeing } from "./systems/economy";
import { births, comingOfAge, mortality } from "./systems/demographics";
import { development, exploration, research } from "./systems/progress";
import { abandonment, milestones } from "./systems/settlements";
import { playerUpkeep } from "./systems/players";
import { attributeDrift } from "./systems/attributes";

export const MAX_EVENTS_PER_TICK = 3;

export interface TickInput {
  /** Published event definitions (frozen content bundle). */
  events: readonly EventDefinition[];
  /** Developer/player actions applied at the start of this tick. */
  actions?: readonly unknown[];
  /** Developer decisions for narrative events: definitionId -> choiceId. */
  choiceOverrides?: Record<string, string>;
}

export interface TickResult {
  state: WorldState;
  events: HistoricalEvent[];
  acceptedActions: PlayerAction[];
  rejectedActions: { action: unknown; reason: string }[];
  rejectedEvents: EventRejection[];
  metrics: TickMetrics;
}

/**
 * Advance the world by exactly one tick. Pure function: the input state is
 * never mutated, and the output depends only on (state, input).
 *
 * Phase order:
 *  1. clock advance      5. wellbeing        9. development
 *  2. developer actions  6. mortality/aging 10. exploration
 *  3. council (agent)    7. births          11. narrative storylets
 *  4. production/use     8. coming of age   12. abandonment & milestones
 *                        + research
 */
export function stepWorld(prev: WorldState, input: TickInput): TickResult {
  const state = structuredClone(prev);
  state.tick += 1;
  const rng = new Rng(state.rng);
  const ctx = new TickContext(state, rng);

  const acceptedActions: PlayerAction[] = [];
  const rejectedActions: { action: unknown; reason: string }[] = [];
  for (const raw of input.actions ?? []) {
    const reason = validateAction(ctx, raw);
    if (reason) {
      rejectedActions.push({ action: raw, reason });
      continue;
    }
    const action = PlayerActionSchema.parse(raw);
    applyAction(ctx, action);
    acceptedActions.push(action);
  }

  // Decisions players (and everyone else involved) made since last tick take effect first.
  const resolved = resolvePendingDecisions(ctx.state, input.events, rng, (st, choice, settlementId) =>
    choiceAvailability(st, choice, settlementId ? st.settlements.find((s) => s.id === settlementId) ?? null : null, null).available,
  );
  ctx.state = resolved.state;
  ctx.events.push(...resolved.events);
  ctx.deaths += countDeaths(resolved.events);

  councilDecisions(ctx);
  produce(ctx);
  consume(ctx);
  wellbeing(ctx);
  attributeDrift(ctx);
  mortality(ctx);
  births(ctx);
  comingOfAge(ctx);
  research(ctx);
  development(ctx);
  exploration(ctx);

  const narrative = runNarrativePhase(ctx.state, input.events, rng, {
    maxEventsPerTick: MAX_EVENTS_PER_TICK,
    choiceOverrides: input.choiceOverrides,
  });
  ctx.state = narrative.state;
  ctx.events.push(...narrative.events);
  // Deaths caused by narrative effects count toward this tick's demographics.
  ctx.deaths += countDeaths(narrative.events);

  // Things that happen to each player personally (newer worlds only).
  const personal = runPersonalPhase(ctx.state, input.events, rng);
  ctx.state = personal.state;
  ctx.events.push(...personal.events);
  ctx.deaths += countDeaths(personal.events);

  abandonment(ctx);
  milestones(ctx);
  playerUpkeep(ctx);

  ctx.state.rng = rng.state;
  const narrativeCount = ctx.events.filter((e) => e.kind === "narrative").length;
  return {
    state: ctx.state,
    events: ctx.events,
    acceptedActions,
    rejectedActions,
    rejectedEvents: [...resolved.rejections, ...narrative.rejections, ...personal.rejections],
    metrics: computeMetrics(ctx.state, { births: ctx.births, deaths: ctx.deaths, events: narrativeCount }),
  };
}

function countDeaths(events: readonly HistoricalEvent[]): number {
  return events.reduce((n, e) => n + e.changes.filter((c) => c.path.endsWith(".alive") && c.after === false).length, 0);
}
