import { describe, expect, it } from "vitest";
import { validateEventDefinition } from "@genesis/narrative";
import { seedContent } from "./helpers";

const ctx = { knownEventIds: new Set(seedContent.events.map((e) => e.id)), knownStorylineIds: new Set(seedContent.storylines.map((s) => s.id)) };
const base = {
  id: "test-event", title: "Test", scope: "settlement", category: "resource", description: "d",
  narrative: { headline: "h", text: "t" }, preconditions: [], effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 5 }],
};
const codes = (r: ReturnType<typeof validateEventDefinition>) => r.errors.map((e) => e.code);

describe("event definition validation", () => {
  it("accepts all seeded content with at least 10 executable events and 3 storylines", () => {
    expect(seedContent.problems).toEqual([]);
    expect(seedContent.events.length).toBeGreaterThanOrEqual(10);
    expect(seedContent.storylines.map((s) => s.id).sort()).toEqual(["first-charter", "first-school", "first-water-crisis", "light-again", "rebuilding-food-production", "roads-between", "the-forgotten-bunker"]);
  });

  it("rejects unsupported effect types (e.g. arbitrary code from an LLM)", () => {
    const r = validateEventDefinition({ ...base, effects: [{ type: "RUN_SCRIPT", source: "rm -rf /" }] }, ctx);
    expect(r.valid).toBe(false);
    expect(codes(r)).toContain("effect.unsupported");
  });

  it("rejects unknown references", () => {
    const r = validateEventDefinition({
      ...base,
      preconditions: [{ type: "technology", tech: "warp_drive", has: true }],
      effects: [{ type: "DISCOVER_LOCATION", location: "atlantis" }, { type: "REVEAL_SECRET", secret: "aliens" }],
      storylineIds: ["nope"],
    }, ctx);
    expect(codes(r)).toEqual(expect.arrayContaining(["ref.technology", "ref.location", "ref.secret", "ref.storyline"]));
  });

  it("detects impossible / contradictory preconditions", () => {
    const r1 = validateEventDefinition({ ...base, preconditions: [{ type: "resource", resource: "food", op: "<", value: 10 }, { type: "resource", resource: "food", op: ">", value: 50 }] }, ctx);
    expect(codes(r1)).toContain("precondition.impossible");
    const r2 = validateEventDefinition({ ...base, preconditions: [{ type: "settlement_stat", stat: "morale", op: ">", value: 100 }] }, ctx);
    expect(codes(r2)).toContain("precondition.impossible");
    const r3 = validateEventDefinition({ ...base, preconditions: [{ type: "technology", tech: "irrigation", has: true }, { type: "technology", tech: "hydroponics", has: false }] }, ctx);
    expect(codes(r3)).toContain("precondition.impossible");
    const r4 = validateEventDefinition({ ...base, preconditions: [{ type: "flag", flag: "a", present: true }, { type: "flag", flag: "a", present: false }] }, ctx);
    expect(codes(r4)).toContain("precondition.contradiction");
  });

  it("rejects writes to reserved secret flags and undeclared roles", () => {
    const r = validateEventDefinition({ ...base, effects: [{ type: "ADD_WORLD_FLAG", flag: "secret.project_halcyon" }, { type: "CHARACTER_DEATH", role: "ghost", cause: "x" }] }, ctx);
    expect(codes(r)).toEqual(expect.arrayContaining(["flag.reserved", "ref.role"]));
  });

  it("rejects settlement effects in world-scoped events", () => {
    const r = validateEventDefinition({ ...base, scope: "world", effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 5, target: "settlement" }] }, ctx);
    expect(codes(r)).toContain("scope.mismatch");
  });

  it("warns about unguarded technology unlocks", () => {
    const r = validateEventDefinition({ ...base, effects: [{ type: "UNLOCK_TECHNOLOGY", tech: "irrigation" }] }, ctx);
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("tech.prerequisites");
  });
});
