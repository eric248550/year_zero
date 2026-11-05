import { describe, expect, it } from "vitest";
import { Rng } from "@genesis/schemas";
import { InsufficientResourcesError, adjustResource, checkEligibility, executeEvent, newRecorder, spendResources } from "@genesis/narrative";
import { createWorld, stepWorld } from "@genesis/simulation";
import { def } from "./helpers";

describe("resources", () => {
  it("spending more than available throws and changes nothing", () => {
    const w = createWorld({ seed: 1 });
    const s = w.settlements[0]!;
    s.resources.materials = 10;
    const before = structuredClone(s.resources);
    const rec = newRecorder();
    expect(() => spendResources(s, { materials: 5, food: 99999 }, rec)).toThrow(InsufficientResourcesError);
    expect(s.resources).toEqual(before);
    expect(rec.changes).toEqual([]);
  });

  it("losses clamp at zero and record the actual change", () => {
    const w = createWorld({ seed: 1 });
    const s = w.settlements[0]!;
    s.resources.water = 7;
    const rec = newRecorder();
    const delta = adjustResource(s, "water", -50, rec);
    expect(s.resources.water).toBe(0);
    expect(delta).toBe(-7);
    expect(rec.changes[0]).toMatchObject({ before: 7, after: 0 });
  });

  it("choices whose costs cannot be paid are unavailable; event cannot fire without an affordable choice", () => {
    const w = createWorld({ seed: 2 });
    w.settlements[0]!.resources.materials = 3;
    const d = def({ id: "costly", choices: [{ id: "build", label: "Build", costs: { materials: 50 }, effects: [] }] });
    expect(checkEligibility(w, d).eligible).toBe(false);
    expect(() => executeEvent(w, d, "s-haven", new Rng(1), { chance: 1, roll: 0 })).toThrow();
    w.settlements[0]!.resources.materials = 60;
    const r = executeEvent(w, d, "s-haven", new Rng(1), { chance: 1, roll: 0 });
    expect(r.state.settlements[0]!.resources.materials).toBe(10);
  });

  it("developer resource transfers are rejected when the source cannot afford them", () => {
    let w = createWorld({ seed: 3 });
    w.settlements.push({ ...structuredClone(w.settlements[0]!), id: "s-x", name: "X", locationId: "ashford_crossing", kind: "settlement" });
    const r = stepWorld(w, { events: [], actions: [{ type: "TRANSFER_RESOURCES", fromSettlementId: "s-haven", toSettlementId: "s-x", resource: "food", amount: 999 }] });
    expect(r.acceptedActions).toHaveLength(0);
    expect(r.rejectedActions[0]!.reason).toMatch(/has only/);
    w = r.state;
    expect(w.settlements.every((s) => s.resources.food >= 0)).toBe(true);
  });
});
