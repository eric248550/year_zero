import { hashValue, type EventDefinition, type HistoricalEvent, type PlayerAction, type WorldState } from "@genesis/schemas";
import { stepWorld, type TickResult } from "./tick";

export function hashState(state: WorldState): string {
  return hashValue(state);
}

/** Logged inputs for a tick — everything needed to reproduce it without external calls. */
export interface TickDecisions {
  actions: PlayerAction[];
  choiceOverrides: Record<string, string>;
}

export interface ReplayInput {
  from: WorldState;
  toTick: number;
  events: readonly EventDefinition[];
  decisions: (tick: number) => TickDecisions | undefined;
  onTick?: (result: TickResult) => void;
}

/**
 * Deterministically re-run a world from a snapshot to a later tick using only
 * logged decisions and frozen content. No LLM or network calls are involved.
 */
export function replay(input: ReplayInput): { state: WorldState; history: HistoricalEvent[] } {
  let state = input.from;
  const history: HistoricalEvent[] = [];
  while (state.tick < input.toTick) {
    const d = input.decisions(state.tick + 1);
    const result = stepWorld(state, { events: input.events, actions: d?.actions ?? [], choiceOverrides: d?.choiceOverrides ?? {} });
    state = result.state;
    history.push(...result.events);
    input.onTick?.(result);
  }
  return { state, history };
}
