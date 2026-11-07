import { describe, expect, it } from "vitest";
import { TECH_BY_ID, type WorldState } from "@genesis/schemas";
import { tensionKey, validateEventDefinition } from "@genesis/narrative";
import { activeProjects, applyImmediate, createWorld, playerCharacter, stepWorld } from "@genesis/simulation";
import { def, seedContent } from "./helpers";

function played(state: WorldState, playerId: string, profession?: "Farmer" | "Engineer" | "Scientist" | "Medic" | "Scout"): WorldState {
  let s = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId, ...(profession ? { profession } : {}) }).state;
  for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId, step, choiceId }).state;
  return s;
}

const camps = def({
  id: "camps-test", scope: "settlement", participation: "everyone", resolution: "vote", maxOccurrences: 1,
  preconditions: [{ type: "settlement_kind", kind: "bunker" }],
  choices: [
    { id: "up", label: "Up", tags: ["bold"], effects: [{ type: "ADD_WORLD_FLAG", flag: "test.up" }] },
    { id: "down", label: "Down", tags: ["cautious"], effects: [{ type: "ADD_WORLD_FLAG", flag: "test.down" }] },
  ],
});

describe("collective votes", () => {
  it("collect every answer and apply only the winner, once", () => {
    let s = played(played(createWorld({ seed: 31 }), "a"), "b");
    s = stepWorld(s, { events: [camps], actions: [] }).state;
    const p = s.pendingDecisions?.find((x) => x.definitionId === "camps-test");
    expect(p).toBeDefined();
    for (const id of ["a", "b"]) s = applyImmediate(s, { type: "CHOOSE", playerId: id, decisionId: p!.id, choiceId: "down" }).state;
    for (let i = 0; i < 3 && s.pendingDecisions?.some((x) => x.id === p!.id); i++) s = stepWorld(s, { events: [camps], actions: [] }).state;
    const both = !!s.flags["test.up"] && !!s.flags["test.down"];
    expect(both).toBe(false);
    expect(!!s.flags["test.up"] || !!s.flags["test.down"]).toBe(true);
  });

  it("are required when everyone decides and choices set world flags", () => {
    const r = validateEventDefinition({ ...camps, resolution: undefined }, { knownEventIds: new Set(), knownStorylineIds: new Set() } as never);
    expect(r.errors.map((e) => e.code)).toContain("decision.conflict");
  });
});

describe("goods come from somewhere", () => {
  it("EXCHANGE moves goods between two settlements and creates nothing", () => {
    let s = createWorld({ seed: 5 });
    for (let i = 0; i < 8 && s.settlements.filter((x) => x.status === "active").length < 2; i++) s = stepWorld(s, { events: [], actions: [] }).state;
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    s.tensions = { [tensionKey(a!.id, b!.id)]: 1 };
    const trade = def({ id: "trade-test", scope: "settlement", preconditions: [{ type: "settlement_kind", kind: "bunker" }], choices: [{ id: "go", label: "Go", effects: [{ type: "EXCHANGE", get: { resource: "materials", amount: 20 }, give: { resource: "food", amount: 10 } }] }] });
    const r = stepWorld(s, { events: [trade], actions: [] });
    const e = r.events.find((x) => x.definitionId === "trade-test")!;
    expect(e).toBeDefined();
    const sum = (r0: string) => e.changes.filter((c) => c.path.endsWith(`.resources.${r0}`)).reduce((n, c) => n + (Number(c.after) - Number(c.before)), 0);
    expect(Math.abs(sum("materials"))).toBeLessThan(0.05);
    expect(Math.abs(sum("food"))).toBeLessThan(0.05);
  });

  it("no seeded event unlocks a technology outright", () => {
    for (const d of seedContent.events) {
      const all = [...d.effects, ...d.choices.flatMap((c) => [...c.effects, ...(c.memberEffects ?? []), ...(c.risk?.effects ?? [])])];
      expect(all.some((x) => x.type === "UNLOCK_TECHNOLOGY"), d.id).toBe(false);
    }
  });
});

describe("professions", () => {
  it("can only propose projects in their own trade, and the lead decides how it is run", () => {
    let s = played(createWorld({ seed: 12 }), "f", "Farmer");
    const farm = Object.values(TECH_BY_ID).find((t) => t.branch === "farming" && t.tier === 1)!;
    const industry = Object.values(TECH_BY_ID).find((t) => t.branch === "industry" && t.tier === 1)!;
    expect(applyImmediate(s, { type: "START_PROJECT", playerId: "f", tech: industry.id }).rejected).toMatch(/Only a Engineer/);
    if (!activeProjects(s).some((p) => p.techId === farm.id)) {
      const r = applyImmediate(s, { type: "START_PROJECT", playerId: "f", tech: farm.id });
      expect(r.rejected).toBeNull();
      s = r.state;
      const me = playerCharacter(s, "f")!;
      expect(applyImmediate(s, { type: "PROJECT_APPROACH", playerId: "f", approach: "bold" }).rejected).toBeNull();
      s = applyImmediate(s, { type: "PROJECT_APPROACH", playerId: "f", approach: "bold" }).state;
      expect(activeProjects(s).find((p) => p.leadId === me.id)?.approach).toBe("bold");
    }
  });

  it("get decisions about their own project, and those decisions change it", () => {
    let s = played(createWorld({ seed: 14 }), "f", "Farmer");
    s = stepWorld(s, { events: seedContent.events, actions: [] }).state;
    const farm = activeProjects(s).find((p) => TECH_BY_ID[p.techId]!.branch === "farming");
    expect(farm).toBeDefined();
    s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "f", projectId: farm!.id }).state;
    const only = seedContent.events.filter((d) => d.id === "farmer-seed-plan").map((d) => ({ ...d, chance: 1 }));
    s = stepWorld(s, { events: only, actions: [] }).state;
    const p = s.pendingDecisions?.find((x) => x.definitionId === "farmer-seed-plan");
    expect(p).toBeDefined();
    const before = activeProjects(s).find((x) => x.id === farm!.id)!;
    const r = applyImmediate(s, { type: "CHOOSE", playerId: "f", decisionId: p!.id, choiceId: "rotate" }, only);
    expect(r.rejected).toBeNull();
    const after = activeProjects(r.state).find((x) => x.id === farm!.id)!;
    expect(after.approach).toBe("careful");
    expect(after.progress).toBeGreaterThan(before.progress);
  });
});
