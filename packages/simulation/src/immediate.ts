import { PLAYER_ACTION_TYPES, PlayerActionSchema, Rng, type HistoricalEvent, type PlayerAction, type WorldState } from "@genesis/schemas";
import { TickContext } from "./context";
import { applyAction, validateAction } from "./systems/agents";

const IMMEDIATE = new Set<string>(PLAYER_ACTION_TYPES);

/** Player actions take effect at once, between ticks, instead of waiting for the next tick. */
export function isImmediateAction(raw: unknown): boolean {
  const parsed = PlayerActionSchema.safeParse(raw);
  return parsed.success && IMMEDIATE.has(parsed.data.type);
}

export interface ImmediateResult {
  state: WorldState;
  events: HistoricalEvent[];
  action: PlayerAction | null;
  rejected: string | null;
}

/**
 * Apply one player action to the world right now, without advancing time.
 * Pure: the input is never mutated. Uses (and advances) the world's own RNG,
 * so logging these actions in order is enough to replay them exactly.
 */
export function applyImmediate(prev: WorldState, raw: unknown): ImmediateResult {
  if (!isImmediateAction(raw)) return { state: prev, events: [], action: null, rejected: "Only player actions can be applied immediately" };
  const state = structuredClone(prev);
  const rng = new Rng(state.rng);
  const ctx = new TickContext(state, rng);
  const reason = validateAction(ctx, raw);
  if (reason) return { state: prev, events: [], action: null, rejected: reason };
  const action = PlayerActionSchema.parse(raw);
  applyAction(ctx, action);
  ctx.state.rng = rng.state;
  return { state: ctx.state, events: ctx.events, action, rejected: null };
}
