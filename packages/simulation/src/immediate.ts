import { PLAYER_ACTION_TYPES, PlayerActionSchema, Rng, type EventDefinition, type HistoricalEvent, type PlayerAction, type WorldState } from "@genesis/schemas";
import { choiceAvailability, getCharacter, resolvePendingDecisions } from "@genesis/narrative";
import { TickContext } from "./context";
import { applyAction, validateAction } from "./systems/agents";
import { proposalNotices } from "./systems/governance";

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
 * A CHOOSE that completes a decision (every
 * living participant has answered) resolves it on the spot, so a personal
 * event shows its outcome at once. `events` is the run's frozen content.
 * Pure: the input is never mutated. Uses (and advances) the world's own RNG,
 * so logging these actions in order is enough to replay them exactly.
 */
export function applyImmediate(prev: WorldState, raw: unknown, events: readonly EventDefinition[] = []): ImmediateResult {
  const parsed = PlayerActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { state: prev, events: [], action: null, rejected: `Malformed action: ${parsed.error.issues.map((i) => `${i.path.join(".") || "action"}: ${i.message}`).join("; ")}` };
  }
  if (!IMMEDIATE.has(parsed.data.type)) return { state: prev, events: [], action: null, rejected: "Only player actions can be applied immediately" };
  const state = structuredClone(prev);
  const rng = new Rng(state.rng);
  const ctx = new TickContext(state, rng);
  const reason = validateAction(ctx, raw);
  if (reason) return { state: prev, events: [], action: null, rejected: reason };
  const action = PlayerActionSchema.parse(raw);
  applyAction(ctx, action);
  if (action.type === "CHOOSE") resolveIfEveryoneChose(ctx, action.decisionId, events);
  proposalNotices(ctx.state);
  if ("playerId" in action) { const p = ctx.state.players?.[action.playerId]; if (p) p.lastActionTick = ctx.state.tick; }
  ctx.state.rng = rng.state;
  return { state: ctx.state, events: ctx.events, action, rejected: null };
}

function resolveIfEveryoneChose(ctx: TickContext, decisionId: string, events: readonly EventDefinition[]): void {
  const st = ctx.state;
  if (events.length === 0) return;
  const p = st.pendingDecisions?.find((d) => d.id === decisionId);
  if (!p) return;
  const waiting = p.participants.some((id) => {
    const c = getCharacter(st, id);
    return c && c.deathTick === null && p.responses[id] === undefined;
  });
  if (waiting) return;
  p.resolveTick = st.tick;
  // Between ticks, "now" is the coming year: whatever takes seasons counts from its spring.
  const resolved = resolvePendingDecisions(st, events, ctx.rng, (s, choice, settlementId) =>
    choiceAvailability(s, choice, settlementId ? s.settlements.find((x) => x.id === settlementId) ?? null : null, null).available,
  (st.tick + 1) * 4);
  ctx.state = resolved.state;
  ctx.events.push(...resolved.events);
}
