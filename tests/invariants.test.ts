import { describe, expect, it } from "vitest";
import { POLICIES } from "@genesis/schemas";
import { population } from "@genesis/narrative";
import { checkInvariants, runHeadless } from "@genesis/simulation";
import { seedContent } from "./helpers";

describe("simulation stress test across seeds", () => {
  for (const policy of POLICIES) {
    it(`${policy}: 10 seeds × 120 ticks hold all invariants`, () => {
      for (let seed = 100; seed < 110; seed++) {
        const r = runHeadless({ seed, ticks: 120, policy, events: seedContent.events });
        expect(r.violations, `seed ${seed}`).toEqual([]);
        for (const m of r.metrics) {
          expect(m.population).toBeGreaterThanOrEqual(0);
          for (const k of ["food", "water", "materials", "knowledge"] as const) expect(m[k]).toBeGreaterThanOrEqual(0);
        }
        expect(population(r.final)).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("the sample world can develop: most seeds grow and unlock technology", () => {
    const runs = Array.from({ length: 12 }, (_, i) => runHeadless({ seed: 500 + i, ticks: 100, events: seedContent.events }));
    const grew = runs.filter((r) => r.metrics.at(-1)!.population > 20).length;
    const techs = runs.map((r) => r.final.technologies.length);
    expect(grew).toBeGreaterThanOrEqual(6);
    expect(Math.max(...techs)).toBeGreaterThanOrEqual(4);
    expect(runs.some((r) => r.metrics.at(-1)!.settlements >= 2)).toBe(true);
  });

  it("checkInvariants detects corrupted state", () => {
    const r = runHeadless({ seed: 1, ticks: 5, events: [] });
    const bad = structuredClone(r.final);
    bad.settlements[0]!.resources.food = -5;
    bad.technologies.push("irrigation");
    expect(checkInvariants(bad).length).toBeGreaterThanOrEqual(2);
  });
});
