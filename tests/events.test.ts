import { describe, expect, it } from "vitest";
import { Rng, type EffectInput } from "@genesis/schemas";
import { EffectError, applyEffect, checkEligibility, executeEvent, newRecorder, runNarrativePhase } from "@genesis/narrative";
import { createWorld } from "@genesis/simulation";
import { def, seedContent } from "./helpers";

const ctx = (roles: Record<string, string> = {}) => ({
  tick: 0, settlementId: "s-haven", roles, historyId: "h-test", title: "t", scope: "settlement" as const, category: "social" as const, storylineIds: [],
});

describe("event preconditions", () => {
  it("events cannot execute when preconditions fail", () => {
    const w = createWorld({ seed: 1 });
    const d = def({ id: "needs-famine", preconditions: [{ type: "resource", resource: "food", op: "<", value: 1 }], effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 5 }] });
    const report = checkEligibility(w, d);
    expect(report.eligible).toBe(false);
    expect(report.blockedBy).toBe("Preconditions not met");
    expect(() => executeEvent(w, d, "s-haven", new Rng(1), { chance: 1, roll: 0 })).toThrow(EffectError);
    const phase = runNarrativePhase(w, [d], new Rng(1), { maxEventsPerTick: 3 });
    expect(phase.events).toEqual([]);
    expect(phase.state).toBe(w);
  });

  it("a food shortage event only fires when food is actually short", () => {
    const famine = seedContent.events.find((e) => e.id === "famine-council")!;
    const w = createWorld({ seed: 2 });
    expect(checkEligibility(w, famine).eligible).toBe(false);
    w.settlements[0]!.shortage.food = 1;
    expect(checkEligibility(w, famine).eligible).toBe(true);
  });

  it("technology-gated events (power grid) cannot appear before the technology exists", () => {
    const surge = seedContent.events.find((e) => e.id === "grid-surge")!;
    const w = createWorld({ seed: 3 });
    expect(checkEligibility(w, surge).eligible).toBe(false);
    w.technologies.push("salvage_tools", "solar_power", "civic_charter", "power_grid");
    expect(checkEligibility(w, surge).eligible).toBe(true);
  });

  it("cooldowns and max occurrences are enforced", () => {
    const w = createWorld({ seed: 4 });
    const d = def({ id: "once", maxOccurrences: 1, effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 1 }] });
    const r = executeEvent(w, d, "s-haven", new Rng(1), { chance: 1, roll: 0 });
    expect(checkEligibility(r.state, d).eligible).toBe(false);
    const cd = def({ id: "cool", cooldown: 3, effects: [] });
    const r2 = executeEvent(w, cd, "s-haven", new Rng(1), { chance: 1, roll: 0 });
    expect(checkEligibility(r2.state, cd).blockedBy).toMatch(/cooldown/);
  });
});

describe("characters in events", () => {
  it("an event whose only choices need unavailable roles is not eligible (no runtime rejection)", () => {
    const w = createWorld({ seed: 12 });
    for (const c of w.characters) if (c.profession === "Scout") { c.deathTick = 0; c.causeOfDeath = "test"; }
    const d = def({ id: "needs-scout-choice", roles: [{ id: "scout", profession: "Scout", optional: true }], choices: [{ id: "go", label: "Go", requiresRoles: ["scout"], effects: [] }] });
    const report = checkEligibility(w, d);
    expect(report.eligible).toBe(false);
    expect(report.blockedBy).toMatch(/choice/);
    expect(runNarrativePhase(w, [d], new Rng(1), { maxEventsPerTick: 3 }).rejections).toEqual([]);
  });

  it("dead characters are never selected for roles", () => {
    const w = createWorld({ seed: 5 });
    for (const c of w.characters) if (c.profession === "Medic") { c.deathTick = 0; c.causeOfDeath = "test"; }
    const d = def({ id: "medic-only", roles: [{ id: "medic", profession: "Medic" }], effects: [] });
    expect(checkEligibility(w, d).eligible).toBe(false);
  });

  it("effects targeting a dead character are rejected", () => {
    const w = createWorld({ seed: 6 });
    const c = w.characters[0]!;
    c.deathTick = 0;
    c.causeOfDeath = "test";
    expect(() => applyEffect(w, { type: "ADD_LIFE_EVENT", role: "x", text: "hi" }, ctx({ x: c.id }), newRecorder())).toThrow(/dead/);
  });

  it("roles are filled by distinct living characters and recorded in provenance", () => {
    const w = createWorld({ seed: 7 });
    const d = def({ id: "pair", roles: [{ id: "a", minAge: 16 }, { id: "b", minAge: 16 }], effects: [{ type: "CHANGE_RELATIONSHIP", a: "a", b: "b", delta: 10 }] });
    const r = executeEvent(w, d, "s-haven", new Rng(3), { chance: 1, roll: 0.1 });
    const roles = r.events[0]!.trigger!.roles;
    expect(roles.a).not.toBe(roles.b);
    expect(r.events[0]!.changes.some((ch) => ch.path.startsWith("relationships."))).toBe(true);
  });
});

describe("effect pipeline", () => {
  it("technology prerequisites are enforced and failed events roll back atomically", () => {
    const w = createWorld({ seed: 8 });
    const foodBefore = w.settlements[0]!.resources.food;
    const d = def({ id: "bad-unlock", effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 30 }, { type: "UNLOCK_TECHNOLOGY", tech: "irrigation" }] });
    expect(() => executeEvent(w, d, "s-haven", new Rng(1), { chance: 1, roll: 0 })).toThrow(/prerequisites/);
    expect(w.settlements[0]!.resources.food).toBe(foodBefore);
    expect(w.technologies).not.toContain("irrigation");
    const phase = runNarrativePhase(w, [d], new Rng(1), { maxEventsPerTick: 3 });
    expect(phase.rejections).toEqual([{ definitionId: "bad-unlock", reason: expect.stringMatching(/prerequisites/) }]);
  });

  it("unsupported effect types are rejected at runtime", () => {
    const w = createWorld({ seed: 9 });
    const evil = { type: "EVAL_CODE", code: "process.exit(1)" } as unknown as EffectInput;
    expect(() => applyEffect(w, evil as never, ctx(), newRecorder())).toThrow(/Unsupported effect type/);
  });

  it("secrets cannot be made public by writing flags; only REVEAL_SECRET works", () => {
    const w = createWorld({ seed: 10 });
    expect(() => applyEffect(w, { type: "ADD_WORLD_FLAG", flag: "secret.project_halcyon", value: true }, ctx(), newRecorder())).toThrow(/reserved/);
    expect(w.secrets.project_halcyon).toBeUndefined();
    applyEffect(w, { type: "REVEAL_SECRET", secret: "project_halcyon" }, ctx(), newRecorder());
    expect(w.secrets.project_halcyon).toEqual({ revealedTick: 0, historyId: "h-test" });
  });

  it("records causal links from flags set by earlier events", () => {
    const w = createWorld({ seed: 11 });
    const setter = def({ id: "setter", effects: [{ type: "ADD_WORLD_FLAG", flag: "test.cause" }] });
    const follower = def({ id: "follower", preconditions: [{ type: "flag", flag: "test.cause", present: true }], effects: [] });
    const a = executeEvent(w, setter, "s-haven", new Rng(1), { chance: 1, roll: 0 });
    const b = executeEvent(a.state, follower, "s-haven", new Rng(1), { chance: 1, roll: 0 });
    expect(b.events[0]!.causeIds).toEqual([a.events[0]!.id]);
  });
});
