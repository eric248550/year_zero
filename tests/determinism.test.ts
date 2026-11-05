import { describe, expect, it } from "vitest";
import { createWorld, hashState, runHeadless, stepWorld } from "@genesis/simulation";
import { seedContent } from "./helpers";

describe("determinism", () => {
  it("creates identical worlds from the same seed", () => {
    expect(hashState(createWorld({ seed: 42 }))).toBe(hashState(createWorld({ seed: 42 })));
    expect(hashState(createWorld({ seed: 42 }))).not.toBe(hashState(createWorld({ seed: 43 })));
  });

  it("same seed + same decisions produce identical histories", () => {
    const a = runHeadless({ seed: 7, ticks: 80, events: seedContent.events });
    const b = runHeadless({ seed: 7, ticks: 80, events: seedContent.events });
    expect(hashState(a.final)).toBe(hashState(b.final));
    expect(a.history).toEqual(b.history);
    expect(a.metrics).toEqual(b.metrics);
  });

  it("different seeds diverge", () => {
    const finals = [1, 2, 3, 4].map((seed) => hashState(runHeadless({ seed, ticks: 40, events: seedContent.events }).final));
    expect(new Set(finals).size).toBe(4);
  });

  it("different decisions (policy) diverge from the same seed", () => {
    const a = runHeadless({ seed: 11, ticks: 60, policy: "scholarly", events: seedContent.events });
    const b = runHeadless({ seed: 11, ticks: 60, policy: "expansionist", events: seedContent.events });
    expect(hashState(a.final)).not.toBe(hashState(b.final));
  });

  it("stepWorld never mutates its input", () => {
    const world = createWorld({ seed: 5 });
    const before = hashState(world);
    stepWorld(world, { events: seedContent.events });
    expect(hashState(world)).toBe(before);
  });

  it("the world clock is the only time source: one tick per step", () => {
    let s = createWorld({ seed: 9 });
    for (let i = 1; i <= 5; i++) {
      s = stepWorld(s, { events: [] }).state;
      expect(s.tick).toBe(i);
    }
  });
});
