import { describe, expect, it } from "vitest";
import type { PlayerAction, WorldState } from "@genesis/schemas";
import { createWorld, hashState, replay, stepWorld, type TickDecisions } from "@genesis/simulation";
import { seedContent } from "./helpers";

function simulate(seed: number, ticks: number, plan: Map<number, TickDecisions>) {
  let state = createWorld({ seed });
  const snapshots = new Map<number, WorldState>([[0, structuredClone(state)]]);
  const accepted = new Map<number, TickDecisions>();
  for (let i = 0; i < ticks; i++) {
    const d = plan.get(state.tick + 1);
    const r = stepWorld(state, { events: seedContent.events, actions: d?.actions ?? [], choiceOverrides: d?.choiceOverrides ?? {} });
    state = r.state;
    // Log what was actually accepted — this is what gets persisted.
    accepted.set(state.tick, { actions: r.acceptedActions, choiceOverrides: d?.choiceOverrides ?? {} });
    if (state.tick % 10 === 0) snapshots.set(state.tick, structuredClone(state));
  }
  return { state, snapshots, accepted };
}

const plan = new Map<number, TickDecisions>([
  [3, { actions: [{ type: "SET_RESEARCH_FOCUS", tech: "field_medicine" } as PlayerAction], choiceOverrides: {} }],
  [8, { actions: [{ type: "SET_POLICY", policy: "expansionist" } as PlayerAction], choiceOverrides: { "reclaimer-filter-failure": "ration" } }],
  [15, { actions: [{ type: "LAUNCH_EXPEDITION", settlementId: "s-haven" } as PlayerAction], choiceOverrides: {} }],
]);

describe("snapshots and replay", () => {
  it("replaying from tick 0 with logged decisions reproduces the run exactly", () => {
    const run = simulate(77, 40, plan);
    const replayed = replay({ from: run.snapshots.get(0)!, toTick: 40, events: seedContent.events, decisions: (t) => run.accepted.get(t) });
    expect(hashState(replayed.state)).toBe(hashState(run.state));
  });

  it("replaying from an intermediate snapshot reproduces later snapshots", () => {
    const run = simulate(78, 40, plan);
    for (const from of [10, 20, 30]) {
      const replayed = replay({ from: run.snapshots.get(from)!, toTick: 40, events: seedContent.events, decisions: (t) => run.accepted.get(t) });
      expect(hashState(replayed.state), `from ${from}`).toBe(hashState(run.state));
    }
  });

  it("snapshots survive a JSON round trip (as stored in SQLite) without changing the hash", () => {
    const run = simulate(79, 25, new Map());
    const snap = run.snapshots.get(20)!;
    const roundTripped = JSON.parse(JSON.stringify(snap)) as WorldState;
    expect(hashState(roundTripped)).toBe(hashState(snap));
    const a = stepWorld(snap, { events: seedContent.events }).state;
    const b = stepWorld(roundTripped, { events: seedContent.events }).state;
    expect(hashState(a)).toBe(hashState(b));
  });

  it("omitting a logged decision makes replay diverge (decisions matter)", () => {
    const run = simulate(80, 30, plan);
    const replayed = replay({ from: run.snapshots.get(0)!, toTick: 30, events: seedContent.events, decisions: () => undefined });
    expect(hashState(replayed.state)).not.toBe(hashState(run.state));
  });
});
