import type { EventDefinition, HistoricalEvent, PolicyId, WorldState } from "@genesis/schemas";
import { checkInvariants } from "./invariants";
import type { TickMetrics } from "./metrics";
import { stepWorld } from "./tick";
import { createWorld } from "./world-factory";

export interface HeadlessRunResult {
  seed: number;
  policy: PolicyId;
  final: WorldState;
  metrics: TickMetrics[];
  history: HistoricalEvent[];
  violations: { tick: number; message: string }[];
  rejectedEvents: number;
  durationMs: number;
}

/** Run a world headlessly (no persistence) — used by tests and `pnpm sim:run`. */
export function runHeadless(options: { seed: number; ticks: number; policy?: PolicyId; events: readonly EventDefinition[]; keepHistory?: boolean }): HeadlessRunResult {
  const started = performance.now();
  let state = createWorld({ seed: options.seed, policy: options.policy });
  const metrics: TickMetrics[] = [];
  const history: HistoricalEvent[] = [];
  const violations: { tick: number; message: string }[] = [];
  let rejectedEvents = 0;
  for (let i = 0; i < options.ticks; i++) {
    const r = stepWorld(state, { events: options.events });
    state = r.state;
    metrics.push(r.metrics);
    rejectedEvents += r.rejectedEvents.length;
    if (options.keepHistory !== false) history.push(...r.events);
    for (const m of checkInvariants(state, options.keepHistory !== false ? history : r.events)) violations.push({ tick: state.tick, message: m });
  }
  return { seed: options.seed, policy: state.policy, final: state, metrics, history, violations, rejectedEvents, durationMs: performance.now() - started };
}
