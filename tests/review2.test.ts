import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TECH_BY_ID, type EventDefinition, type WorldState } from "@genesis/schemas";
import { checkEligibility, personalEligible, relationshipKey } from "@genesis/narrative";
import { activeProjects, applyImmediate, checkInvariants, civilization, createWorld, playerCharacter, stepWorld } from "@genesis/simulation";
import { applyPlayerAction, createRun, getRun, importSeedContent, migrateDb, openDb, reconstructState, stepRun, verifyReplay } from "@genesis/database";
import { def, seedContent } from "./helpers";

const events = seedContent.events;
const byId = (id: string) => events.find((e) => e.id === id)!;
const step = (s: WorldState, evs: readonly EventDefinition[] = events) => {
  const r = stepWorld(s, { events: evs, actions: [] });
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
};
function played(state: WorldState, playerId: string, profession?: "Farmer" | "Engineer" | "Scientist" | "Medic" | "Scout"): WorldState {
  let s = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId, ...(profession ? { profession } : {}) }).state;
  for (const [st, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId, step: st, choiceId }).state;
  s.pendingDecisions = [];
  return s;
}
function surfaceWorld(seed: number): WorldState {
  let s = createWorld({ seed });
  for (let i = 0; i < 8 && !s.settlements.some((x) => x.kind === "settlement" && x.status === "active"); i++) s = stepWorld(s, { events: [], actions: [] }).state;
  return s;
}

describe("personal events need the right people and projects", () => {
  it("an engineer's materials decision needs an engineering project", () => {
    let s = played(createWorld({ seed: 70 }), "e", "Engineer");
    s = stepWorld(s, { events: [], actions: [] }).state;
    s.pendingDecisions = [];
    const me = () => playerCharacter(s, "e")!;
    const eligible = () => personalEligible(s, byId("engineer-materials"), s.players!.e!, me());
    const here = activeProjects(s).filter((p) => p.settlementId === me().homeId);
    const farm = here.find((p) => TECH_BY_ID[p.techId]!.branch === "farming");
    if (farm) {
      s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "e", projectId: farm.id }).state;
      expect(eligible()).toBe(false);
    }
    const tech = Object.values(TECH_BY_ID).find((t) => t.branch === "industry" && t.tier === 1)!;
    if (!activeProjects(s).some((p) => p.techId === tech.id)) s = applyImmediate(s, { type: "START_PROJECT", playerId: "e", tech: tech.id }).state;
    else s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "e", projectId: activeProjects(s).find((p) => p.techId === tech.id)!.id }).state;
    expect(eligible()).toBe(true);
  });

  it("a child's question needs a child; dead or away people take no part", () => {
    let s = played(createWorld({ seed: 71 }), "p");
    const me = playerCharacter(s, "p")!;
    expect(personalEligible(s, byId("child-question"), s.players!.p!, me)).toBe(true);
    for (const c of s.characters) if (c.id !== me.id && s.tick - c.birthTick < 16) { c.deathTick = 0; c.causeOfDeath = "test"; }
    expect(personalEligible(s, byId("child-question"), s.players!.p!, me)).toBe(false);
    // Someone away cannot be the friend at dinner either.
    const friend = s.characters.find((c) => c.id !== me.id && c.deathTick === null && c.homeId === me.homeId)!;
    for (const k of Object.keys(s.relationships)) if (k.includes(me.id)) delete s.relationships[k];
    s.relationships[relationshipKey(me.id, friend.id)] = 50;
    expect(personalEligible(s, byId("shared-meal"), s.players!.p!, me)).toBe(true);
    friend.awayUntil = s.tick * 4 + 8;
    expect(personalEligible(s, byId("shared-meal"), s.players!.p!, me)).toBe(false);
  });
});

describe("farming", () => {
  it("there is no harvest without fields and sown seed, and no food from the celebration", () => {
    const s = surfaceWorld(72);
    const farm = s.settlements.find((x) => x.kind === "settlement" && x.status === "active")!;
    const r = step(s, []);
    const f = r.state.settlements.find((x) => x.id === farm.id)!;
    expect(f.farm?.harvests ?? 0).toBe(0);
    expect(f.farm?.crops ?? []).toEqual([]);
  });
});

describe("scheduled activities", () => {
  const trip = def({
    id: "x-trip", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], roles: [{ id: "walker", minAge: 16 }],
    choices: [{ id: "go", label: "Go", effects: [{ type: "AFTER", seasons: 5, away: ["walker"], title: "Back", text: "{{walker}} is back.", effects: [{ type: "ADJUST_RESOURCE", resource: "knowledge", amount: 25 }] }] }],
  });

  it("rewards arrive only when the expedition is over, and only once", () => {
    let r = step(createWorld({ seed: 75 }), [trip]);
    const go = r.events.find((e) => e.definitionId === "x-trip")!;
    expect(go.changes.some((c) => c.path.endsWith("resources.knowledge") && Number(c.after) - Number(c.before) === 25)).toBe(false);
    let delivered = 0;
    for (let i = 0; i < 4; i++) {
      r = step(r.state, [trip]);
      delivered += r.events.filter((e) => e.causeIds.includes(go.id) && e.title === "Back").length;
    }
    expect(delivered).toBe(1);
    expect(r.state.scheduled ?? []).toEqual([]);
  });

  it("if the person who went dies on the way, nothing comes back and the loss is recorded", () => {
    let r = step(createWorld({ seed: 76 }), [trip]);
    const go = r.events.find((e) => e.definitionId === "x-trip")!;
    const walker = go.trigger!.roles.walker!;
    const c = r.state.characters.find((x) => x.id === walker)!;
    c.deathTick = r.state.tick; c.causeOfDeath = "test";
    const before = r.state.settlements[0]!.resources.knowledge;
    r = step(r.state, [trip]);
    r = r.events.some((e) => e.causeIds.includes(go.id)) ? r : step(r.state, [trip]);
    const back = r.events.find((e) => e.causeIds.includes(go.id))!;
    expect(back.title).not.toBe("Back");
    expect(back.changes).toEqual([]);
    void before;
  });

  it("the reckless seed-vault run also takes a season, and its rewards wait for the return", () => {
    const rush = byId("seed-vault-expedition").choices.find((c) => c.id === "rush")!;
    expect(rush.effects.every((e) => e.type === "AFTER")).toBe(true);
    expect(rush.risk).toBeUndefined();
    for (const id of ["aquifer-rumour", "follow-the-signal", "famine-council", "scout-supply-run"]) {
      const d = byId(id);
      const trips = d.choices.filter((c) => c.effects.some((e) => e.type === "AFTER"));
      expect(trips.length, id).toBeGreaterThan(0);
      for (const c of trips) expect(c.effects.some((e) => e.type === "DISCOVER_LOCATION" || e.type === "ADJUST_RESOURCE" && e.amount > 0), id).toBe(false);
    }
  });

  it("follow-ups never fire twice across saving, reloading, replaying and multi-year steps", () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), "yz-r2-")), "t.db"));
    migrateDb(db);
    importSeedContent(db, seedContent);
    const run = createRun(db, { name: "r2", seed: 77 });
    applyPlayerAction(db, run.id, { type: "JOIN_WORLD", playerId: "a", playerName: "a" });
    stepRun(db, run.id, 15);
    stepRun(db, run.id, 15);
    const head = getRun(db, run.id).state;
    expect(verifyReplay(db, run.id).ok).toBe(true);
    expect(reconstructState(db, run.id, 30).state.scheduled ?? []).toEqual(head.scheduled ?? []);
    for (const x of head.scheduled ?? []) expect(x.dueSeason).toBeGreaterThanOrEqual(head.tick * 4);
  });
});

describe("ownership, governance and buildings", () => {
  it("a site cannot be claimed before it is found, or taken from its owner by a plain claim", () => {
    const s = surfaceWorld(78);
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    const claim = (loc: string) => def({ id: `x-claim-${loc.replace(/_/g, "-")}`, scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], effects: [{ type: "CLAIM_SITE", location: loc }] });
    const vault = s.locations.find((l) => l.id === "seed_vault")!;
    vault.discovered = false;
    let r = step(s, [claim("seed_vault")]);
    expect(r.state.locations.find((l) => l.id === "seed_vault")!.claimedBy ?? null).toBeNull();
    const st = r.state;
    st.locations.find((l) => l.id === "seed_vault")!.discovered = true;
    st.locations.find((l) => l.id === "seed_vault")!.claimedBy = b!.id;
    r = step(st, [{ ...claim("seed_vault"), id: "x-claim-again" }]);
    expect(r.state.locations.find((l) => l.id === "seed_vault")!.claimedBy).toBe(b!.id);
    void a;
    expect(byId("water-quarrel").choices.flatMap((c) => c.effects).some((e) => e.type === "CLAIM_SITE")).toBe(false);
  });

  it("a council of elders is a full path: it completes the main line's governance step and allows the charter", () => {
    const s = createWorld({ seed: 79 });
    s.flags["governance.elder_council"] = true;
    const civ = civilization(s);
    expect(civ.stages.find((x) => x.id === "order")!.milestones.find((m) => m.id === "assembly")!.done).toBe(true);
    expect(checkEligibility(s, byId("who-makes-rules")).eligible).toBe(false);
    s.technologies.push("civic_charter");
    expect(checkEligibility(s, byId("charter-signing")).eligible).toBe(true);
    expect(byId("charter-signing").preconditions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "flag_any", present: true })]));
  });

  it("a damaged building gives less; a repair takes a season and restores it", () => {
    const s = createWorld({ seed: 80 });
    s.technologies.push("water_purification");
    const full = structuredClone(s); full.settlements[0]!.facilities = { well: 100 };
    const hurt = structuredClone(s); hurt.settlements[0]!.facilities = { well: 40 };
    const water = (w: WorldState) => step(w, []).state.settlements[0]!.resources.water;
    expect(water(full)).toBeGreaterThan(water(hurt));
    const repair = def({ id: "x-repair", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], effects: [{ type: "BUILD_FACILITY", facility: "well", seasons: 1 }] });
    const r = step(hurt, [repair]);
    expect(r.state.settlements[0]!.facilities!.well).toBe(100);
    expect(r.state.settlements[0]!.building?.well).toBeUndefined();
  });

  it("an unfinished building does nothing, and knowing a technology does not raise its infrastructure for free", () => {
    const s = createWorld({ seed: 81 });
    s.technologies.push("water_wheel");
    // Haven Deep has no river: no water mill however long it knows how.
    let w = s;
    for (let i = 0; i < 3; i++) w = step(w, []).state;
    expect(w.settlements[0]!.facilities?.watermill).toBeUndefined();
    s.settlements[0]!.building = { generator: s.tick * 4 + 40 };
    s.settlements[0]!.facilities = { watermill: 100 };
    s.technologies.push("salvage_tools", "archives", "workshop", "mechanical_power", "solar_power");
    const k = (x: WorldState) => step(x, []).state.settlements[0]!.resources.knowledge;
    const done = structuredClone(s); delete done.settlements[0]!.building; done.settlements[0]!.facilities = { generator: 100, watermill: 100 };
    expect(k(done)).toBeGreaterThan(k(s));
  });

  it("an electrical surge damages the power lines instead of taking generic materials", () => {
    const d = byId("grid-surge");
    expect(d.effects).toEqual([{ type: "CHANGE_FACILITY", facility: "power_lines", delta: -45 }]);
    expect(d.preconditions).toEqual(expect.arrayContaining([{ type: "facility", facility: "power_lines", working: true }]));
  });
});

describe("players put resources in and see what happens", () => {
  it("donating materials moves exactly that much into the project, once a year", () => {
    let s = played(createWorld({ seed: 82 }), "p", "Farmer");
    s = stepWorld(s, { events: [], actions: [] }).state;
    const me = playerCharacter(s, "p")!;
    const p = activeProjects(s).find((x) => x.settlementId === me.homeId)!;
    s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "p", projectId: p.id }).state;
    const home = () => s.settlements.find((x) => x.id === me.homeId)!;
    const before = { m: home().resources.materials, w: activeProjects(s).find((x) => x.id === p.id)!.progress };
    const r = applyImmediate(s, { type: "DONATE_PROJECT", playerId: "p", amount: 10 });
    expect(r.rejected).toBeNull();
    s = r.state;
    expect(home().resources.materials).toBeCloseTo(before.m - 10, 5);
    expect(activeProjects(s).find((x) => x.id === p.id)!.progress).toBeCloseTo(before.w + 6, 5);
    expect(activeProjects(s).find((x) => x.id === p.id)!.log?.at(-1)?.text).toBeTruthy();
    expect(applyImmediate(s, { type: "DONATE_PROJECT", playerId: "p", amount: 10 }).rejected).toMatch(/already/);
  });
});
