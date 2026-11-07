import { beforeEach, describe, expect, it } from "vitest";
import { EXCLUSIVE_FLAGS, Rng, TECH_BY_ID, type EventDefinition, type WorldState } from "@genesis/schemas";
import { personalEligible, relationshipKey, tallyVotes, tensionKey, validateBundle, validateEventDefinition, VOTING } from "@genesis/narrative";
import { TickContext, activeProjects, applyImmediate, checkInvariants, createWorld, facilities, playerCharacter, stepWorld } from "@genesis/simulation";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlayerAction, createRun, getRun, importSeedContent, migrateDb, openDb, reconstructState, stepRun, verifyReplay } from "@genesis/database";
import { closeKin } from "../packages/simulation/src/systems/demographics";
import { def, seedContent } from "./helpers";

const events = seedContent.events;
const byId = (id: string) => events.find((e) => e.id === id)!;

function played(state: WorldState, playerId: string, profession?: "Farmer" | "Engineer" | "Scientist" | "Medic" | "Scout"): WorldState {
  let s = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId, ...(profession ? { profession } : {}) }).state;
  for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId, step, choiceId }).state;
  return s;
}
const step = (s: WorldState, evs: readonly EventDefinition[] = events) => {
  const r = stepWorld(s, { events: evs, actions: [] });
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
};
function twoSettlements(seed: number): WorldState {
  let s = createWorld({ seed });
  for (let i = 0; i < 8 && s.settlements.filter((x) => x.status === "active").length < 2; i++) s = stepWorld(s, { events: [], actions: [] }).state;
  return s;
}
const eligible = (s: WorldState, id: string, playerId: string) => personalEligible(s, byId(id), s.players![playerId]!, playerCharacter(s, playerId)!);

describe("P0.1 event eligibility", () => {
  it("profession project events need the profession and a compatible project", () => {
    let s = played(createWorld({ seed: 40 }), "f", "Farmer");
    s.pendingDecisions = [];
    expect(eligible(s, "farmer-seed-plan", "f")).toBe(false); // not on a project
    s = stepWorld(s, { events: [], actions: [] }).state;
    const farm = activeProjects(s).find((p) => TECH_BY_ID[p.techId]!.branch === "farming")!;
    const other = activeProjects(s).find((p) => TECH_BY_ID[p.techId]!.branch !== "farming" && p.settlementId === farm.settlementId)!;
    s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "f", projectId: other.id }).state;
    expect(eligible(s, "farmer-seed-plan", "f")).toBe(false); // wrong branch
    s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "f", projectId: farm.id }).state;
    expect(eligible(s, "farmer-seed-plan", "f")).toBe(true);
    expect(eligible(s, "engineer-materials", "f")).toBe(false); // wrong profession
  });

  it("events about friends, old memories and schools check that those people exist", () => {
    let s = played(createWorld({ seed: 41 }), "p");
    const me = playerCharacter(s, "p")!;
    // Nobody likes the player yet: no friend to invite them to dinner.
    for (const k of Object.keys(s.relationships)) if (k.includes(me.id)) delete s.relationships[k];
    expect(eligible(s, "shared-meal", "p")).toBe(false);
    const other = s.characters.find((c) => c.id !== me.id && c.homeId === me.homeId && c.deathTick === null)!;
    s.relationships[relationshipKey(me.id, other.id)] = 30;
    expect(eligible(s, "shared-meal", "p")).toBe(true);
    // Elders who remember the bunker before the doors opened must actually be that old.
    for (const c of s.characters) if (c.birthTick < -15 && c.id !== me.id) { c.deathTick = 0; c.causeOfDeath = "test"; }
    expect(eligible(s, "elder-stories", "p")).toBe(false);
  });

  it("schools need children and someone able to teach", () => {
    const d = byId("unschooled-children");
    expect(d.preconditions.some((c) => c.type === "children")).toBe(true);
    expect(d.roles.some((r) => r.minAttributes?.knowledge)).toBe(true);
    expect(d.preconditions.some((c) => c.type === "settlement_count")).toBe(false);
    expect(byId("teach-class").preconditions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "facility", facility: "schoolhouse", working: true })]));
  });

  it("people who are away or dead take part in nothing", () => {
    let s = played(createWorld({ seed: 42 }), "p");
    const me = playerCharacter(s, "p")!;
    me.awayUntil = s.tick * 4 + 8;
    for (const d of events.filter((e) => e.roles.some((r) => r.player))) expect(personalEligible(s, d, s.players!.p!, me), d.id).toBe(false);
    expect(applyImmediate(s, { type: "START_PROJECT", playerId: "p", tech: "hydroponics" }).rejected).toMatch(/away/);
  });
});

describe("P0.2 event effects", () => {
  it("repairing the greenhouse restores it; the storm is what damages it", () => {
    const d = byId("storm-glass");
    expect(d.effects).toEqual([{ type: "CHANGE_FACILITY", facility: "greenhouse", delta: -40 }]);
    const repair = d.choices.find((c) => c.id === "repair")!;
    expect(repair.effects.every((e) => e.type !== "CHANGE_FACILITY" || e.delta > 0)).toBe(true);
  });

  it("the water council and engineer control are different governments with different consequences", () => {
    const d = byId("water-rationing-council");
    const flags = d.choices.map((c) => c.effects.find((e) => e.type === "ADD_WORLD_FLAG")).map((e) => (e as { flag: string }).flag);
    expect(new Set(flags)).toEqual(new Set(["governance.water_council", "governance.engineer_control"]));
    expect(EXCLUSIVE_FLAGS.some((g) => g.includes("governance.water_council") && g.includes("governance.engineer_control"))).toBe(true);
    // Engineers make water go further; an elected council keeps people happier.
    const base = createWorld({ seed: 43 });
    const a = structuredClone(base); a.flags["governance.water_council"] = true;
    const b = structuredClone(base); b.flags["governance.engineer_control"] = true;
    const ra = step(a, []).state.settlements[0]!;
    const rb = step(b, []).state.settlements[0]!;
    expect(rb.resources.water).toBeGreaterThan(ra.resources.water);
    expect(ra.morale).toBeGreaterThan(rb.morale);
  });

  it("the first outdoor harvest needs sowing on fertile land, saved seed, and two seasons", () => {
    const harvest = byId("first-surface-harvest");
    const sowing = byId("spring-sowing");
    expect(harvest.scheduledOnly).toBe(true);
    expect(sowing.preconditions.some((c) => c.type === "technology")).toBe(false);
    expect(sowing.preconditions).toEqual(expect.arrayContaining([{ type: "farmable", present: true }]));
    const sow = sowing.choices.find((c) => c.id === "sow_all")!;
    expect(sow.costs?.food).toBeGreaterThan(0);
    expect(sow.effects).toEqual(expect.arrayContaining([expect.objectContaining({ type: "SCHEDULE_EVENT", event: "first-surface-harvest", seasons: 2 })]));
  });

  it("the whole content set has no unreachable follow-ups, unset flags or broken references", () => {
    const r = validateBundle(events);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(seedContent.problems).toEqual([]);
  });
});

describe("P0.3 resource consistency", () => {
  it("an exchange moves goods in the agreed proportion and creates nothing, even when one side is short", () => {
    const s = twoSettlements(44);
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    s.tensions = { [tensionKey(a!.id, b!.id)]: 1 };
    s.settlements.find((x) => x.id === a!.id)!.resources.materials = 5; // can only pay a quarter
    const trade = def({ id: "x-trade", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], choices: [{ id: "go", label: "Go", effects: [{ type: "EXCHANGE", get: { resource: "food", amount: 20 }, give: { resource: "materials", amount: 20 } }] }] });
    const e = step(s, [trade]).events.find((x) => x.definitionId === "x-trade")!;
    const net = (r: string) => e.changes.filter((c) => c.path.endsWith(`resources.${r}`)).reduce((n, c) => n + Number(c.after) - Number(c.before), 0);
    expect(Math.abs(net("food"))).toBeLessThan(0.01);
    expect(Math.abs(net("materials"))).toBeLessThan(0.01);
    // This year's work adds a little before the trade happens; what matters is the 1:1 rate and that both sides were capped.
    const got = e.changes.find((c) => c.path === `settlements.${a!.id}.resources.food`)!;
    const paid = e.changes.find((c) => c.path === `settlements.${a!.id}.resources.materials`)!;
    expect(Number(got.after) - Number(got.before)).toBeCloseTo(Number(paid.before) - Number(paid.after), 1);
    expect(Number(got.after) - Number(got.before)).toBeLessThan(20);
  });

  it("a choice that can no longer be afforded changes nothing", () => {
    let s = played(createWorld({ seed: 45 }), "p");
    const costly = def({ id: "x-costly", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], roles: [{ id: "you", player: true }], choices: [{ id: "buy", label: "Buy", costs: { materials: 50 }, effects: [{ type: "ADD_WORLD_FLAG", flag: "x.bought" }] }, { id: "no", label: "No", effects: [] }] });
    s = stepWorld(s, { events: [costly], actions: [] }).state;
    const p = s.pendingDecisions!.find((x) => x.definitionId === "x-costly")!;
    for (const x of s.settlements) x.resources.materials = 0;
    const before = structuredClone(s);
    const r = applyImmediate(s, { type: "CHOOSE", playerId: "p", decisionId: p.id, choiceId: "buy" }, [costly]);
    expect(r.state.flags["x.bought"]).toBeUndefined();
    expect(r.state.settlements.map((x) => x.resources)).toEqual(before.settlements.map((x) => x.resources));
  });

  it("a shared reward is paid once, however many players chose it", () => {
    let s = played(played(createWorld({ seed: 46 }), "a"), "b");
    const gift = def({ id: "x-gift", scope: "settlement", participation: "everyone", resolution: "each", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], choices: [{ id: "take", label: "Take", tags: ["growth"], effects: [{ type: "ADJUST_RESOURCE", resource: "knowledge", amount: 10 }] }] });
    s = stepWorld(s, { events: [gift], actions: [] }).state;
    const p = s.pendingDecisions!.find((x) => x.definitionId === "x-gift")!;
    for (const id of ["a", "b"]) s = applyImmediate(s, { type: "CHOOSE", playerId: id, decisionId: p.id, choiceId: "take" }, [gift]).state;
    const r = stepWorld(s, { events: [gift], actions: [] });
    const resolved = r.events.filter((e) => e.definitionId === "x-gift");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.changes.filter((c) => c.path.endsWith("resources.knowledge"))).toHaveLength(1);
  });
});

describe("P0.4 multiplayer voting", () => {
  const choices = [{ id: "a", label: "A" }, { id: "b", label: "B" }] as never;
  it("weights are configurable; absent players count like NPCs", () => {
    const picks = [{ choiceId: "a", decidedBy: "player" }, { choiceId: "b", decidedBy: "npc" }, { choiceId: "b", decidedBy: "autopilot" }];
    expect(tallyVotes(choices, picks).map((x) => x.votes)).toEqual([VOTING.player, VOTING.npc + VOTING.absentPlayer]);
    expect(tallyVotes(choices, picks, { player: 1, absentPlayer: 1, npc: 1 }).map((x) => x.votes)).toEqual([1, 2]);
  });

  it("rival flags never hold together, whichever event sets them", () => {
    let s = createWorld({ seed: 47 });
    const set = (flag: string) => def({ id: `x-${flag.replace(/\./g, "-").replace(/_/g, "-")}`, scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], effects: [{ type: "ADD_WORLD_FLAG", flag }] });
    s = step(s, [set("society.surface_first")]).state;
    s = step(s, [set("society.bunker_first")]).state;
    expect(s.flags["society.bunker_first"]).toBe(true);
    expect(s.flags["society.surface_first"]).toBeUndefined();
  });

  it("everyone-decides events that set world flags must be votes", () => {
    const r = validateEventDefinition({ ...byId("two-camps"), resolution: undefined }, { knownEventIds: new Set(), knownStorylineIds: new Set() } as never);
    expect(r.errors.map((e) => e.code)).toContain("decision.conflict");
  });
});

describe("P1 time, projects and persistence", () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(join(mkdtempSync(join(tmpdir(), "yz-review-")), "t.db"));
    migrateDb(db);
    importSeedContent(db, seedContent);
  });

  it("scheduled follow-ups survive saving, reloading and replay", () => {
    const run = createRun(db, { name: "sched", seed: 61 });
    applyPlayerAction(db, run.id, { type: "JOIN_WORLD", playerId: "a", playerName: "a" });
    stepRun(db, run.id, 30);
    const st = getRun(db, run.id).state;
    const v = verifyReplay(db, run.id);
    expect(v.ok).toBe(true);
    for (const t of [10, 20, 30]) expect(reconstructState(db, run.id, t).state.scheduled ?? []).toEqual(expect.any(Array));
    expect(reconstructState(db, run.id, 30).state.scheduled ?? []).toEqual(st.scheduled ?? []);
  });

  it("construction takes its seasons before the building works", () => {
    const s = createWorld({ seed: 62 });
    const build = def({ id: "x-build", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], effects: [{ type: "BUILD_FACILITY", facility: "granary", seasons: 6 }] });
    let r = step(s, [build]);
    expect(r.state.settlements[0]!.facilities?.granary).toBeUndefined();
    expect(r.state.settlements[0]!.building?.granary).toBe(r.state.tick * 4 + 6);
    r = step(r.state, [build]);
    expect(r.state.settlements[0]!.facilities?.granary).toBe(100);
    expect(r.state.settlements[0]!.building?.granary).toBeUndefined();
  });

  it("upkeep keeps buildings standing; neglect breaks them", () => {
    const s = createWorld({ seed: 63 });
    s.settlements[0]!.facilities = { granary: 31 };
    s.settlements[0]!.resources.materials = 0;
    const ctx = new TickContext(structuredClone(s), new Rng(1));
    facilities(ctx);
    expect(ctx.state.settlements[0]!.facilities!.granary).toBeLessThan(30);
  });

  it("everyone who worked on a project is credited when it is done", () => {
    let s = createWorld({ seed: 64 });
    let done = null as null | { characterIds: string[] };
    let contributors: string[] = [];
    for (let i = 0; i < 20 && !done; i++) {
      const first = activeProjects(s)[0];
      if (first) contributors = Object.keys(first.contributions ?? {});
      const r = step(s, []);
      done = r.events.find((e) => first && e.changes.some((c) => c.path === `technologies.${first.techId}`)) ?? null;
      s = r.state;
    }
    expect(done).not.toBeNull();
    expect(done!.characterIds).toEqual(expect.arrayContaining(contributors.filter((id) => s.characters.some((c) => c.id === id))));
  });

  it("a settlement can die without resetting the world", () => {
    let s = twoSettlements(65);
    const techs = s.technologies.length;
    const doomed = s.settlements.find((x) => x.kind === "settlement" && x.status === "active")!;
    for (const c of s.characters) if (c.homeId === doomed.id && c.deathTick === null) { c.deathTick = s.tick; c.causeOfDeath = "test"; }
    s = step(s, []).state;
    expect(s.settlements.find((x) => x.id === doomed.id)!.status).toBe("abandoned");
    expect(s.settlements.some((x) => x.status === "active")).toBe(true);
    expect(s.technologies.length).toBeGreaterThanOrEqual(techs);
    expect(s.tick).toBeGreaterThan(0);
  });

  it("no child is born to close kin", () => {
    const w = createWorld({ seed: 66 });
    const parent = w.characters.find((c) => c.parentIds.length > 0)!;
    const p = w.characters.find((c) => c.id === parent.parentIds[0])!;
    expect(closeKin(parent, p)).toBe(true);
    const sib = { ...parent, id: "x", parentIds: [...parent.parentIds] };
    expect(closeKin(parent, sib)).toBe(true);
  });
});

describe("AI drafts cannot override the simulation", () => {
  it("generated events cannot unlock technology, reveal secrets, claim sites or schedule follow-ups", () => {
    const draft = { ...def({ id: "ai-x", scope: "settlement" }), source: "ai:anthropic:x", status: "draft", effects: [{ type: "UNLOCK_TECHNOLOGY", tech: "hydroponics" }, { type: "ADJUST_RESOURCE", resource: "food", amount: 200, target: "settlement" }] };
    const r = validateEventDefinition(draft, { knownEventIds: new Set(), knownStorylineIds: new Set() } as never);
    expect(r.errors.filter((e) => e.code === "ai.restricted").length).toBeGreaterThanOrEqual(2);
  });
});
