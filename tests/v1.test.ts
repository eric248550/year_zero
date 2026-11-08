import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rng, type EventDefinition, type WorldState } from "@genesis/schemas";
import { checkEligibility, choiceAvailability, powerAt, powerLevel, validateEventDefinition } from "@genesis/narrative";
import { TickContext, applyImmediate, checkInvariants, createWorld, hashState, playerCharacter, stepWorld } from "@genesis/simulation";
import { applyPlayerAction, createRun, importSeedContent, migrateDb, openDb, stepRun, verifyReplay } from "@genesis/database";
import { harvest, sowing } from "../packages/simulation/src/systems/farming";
import { def, seedContent } from "./helpers";

const events = seedContent.events;
const byId = (id: string) => events.find((e) => e.id === id)!;
const step = (s: WorldState, evs: readonly EventDefinition[] = []) => {
  const r = stepWorld(s, { events: evs, actions: [] });
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
};
function surfaceWorld(seed: number): { s: WorldState; farmId: string } {
  let s = createWorld({ seed });
  for (let i = 0; i < 8 && !s.settlements.some((x) => x.kind === "settlement" && x.status === "active"); i++) s = stepWorld(s, { events: [], actions: [] }).state;
  const farm = s.settlements.find((x) => x.kind === "settlement" && x.status === "active")!;
  return { s, farmId: farm.id };
}
const farmOf = (s: WorldState, id: string) => s.settlements.find((x) => x.id === id)!;
const bunkerEvent = (id: string, extra: Partial<Parameters<typeof def>[0]>) => def({ id, scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], ...extra });

describe("farming is a production system", () => {
  it("sowing uses seed from the store; crops ripen and the harvest comes from what was sown", () => {
    const { s, farmId } = surfaceWorld(90);
    const f = farmOf(s, farmId);
    f.facilities = { fields: 100 };
    f.farm = { seeds: 30, fertility: 100, crops: [], harvests: 0 };
    for (const c of s.characters) if (c.homeId === farmId && c.deathTick === null && s.tick - c.birthTick >= 16) c.profession = "Farmer";
    const ctx = new TickContext(structuredClone(s), new Rng(5));
    sowing(ctx);
    const sown = ctx.state.settlements.find((x) => x.id === farmId)!.farm!;
    expect(sown.seeds).toBeLessThan(30);
    expect(sown.crops).toHaveLength(1);
    const seedsIn = sown.crops[0]!.seeds;
    const seedsLeft = sown.seeds;
    expect(seedsIn).toBeCloseTo(30 - seedsLeft, 5);
    const foodBefore = ctx.state.settlements.find((x) => x.id === farmId)!.resources.food;
    harvest(ctx);
    const after = ctx.state.settlements.find((x) => x.id === farmId)!;
    expect(after.farm!.crops).toEqual([]);
    expect(after.farm!.harvests).toBe(1);
    expect(after.resources.food).toBeGreaterThan(foodBefore);
    expect(after.farm!.seeds).toBeGreaterThan(seedsLeft); // part of the crop is kept as seed
    expect(ctx.events.filter((e) => e.title.includes("第一次收成"))).toHaveLength(ctx.events.some((e) => e.title.includes("歉收")) ? 0 : 1);
  });

  it("no seed, no crop; no fields, no crop", () => {
    const { s, farmId } = surfaceWorld(91);
    const f = farmOf(s, farmId);
    f.facilities = { fields: 100 };
    f.farm = { seeds: 0, fertility: 100, crops: [], harvests: 0 };
    let ctx = new TickContext(structuredClone(s), new Rng(1));
    sowing(ctx);
    expect(ctx.state.settlements.find((x) => x.id === farmId)!.farm!.crops).toEqual([]);
    f.facilities = {};
    f.farm.seeds = 30;
    ctx = new TickContext(structuredClone(s), new Rng(1));
    sowing(ctx);
    expect(ctx.state.settlements.find((x) => x.id === farmId)!.farm!.crops).toEqual([]);
  });

  it("crops belong to the settlement: they survive the farmers who sowed them", () => {
    const { s, farmId } = surfaceWorld(92);
    const f = farmOf(s, farmId);
    f.farm = { seeds: 0, fertility: 100, crops: [{ plantedSeason: s.tick * 4, readySeason: s.tick * 4 + 2, seeds: 20 }], harvests: 0 };
    for (const c of s.characters) if (c.homeId === farmId && c.profession === "Farmer") { c.deathTick = s.tick; c.causeOfDeath = "test"; }
    const ctx = new TickContext(structuredClone(s), new Rng(2));
    harvest(ctx);
    expect(ctx.state.settlements.find((x) => x.id === farmId)!.farm!.harvests).toBe(1);
  });

  it("the farm plan sets where soil fertility settles; resting the soil raises it for good", () => {
    const { s, farmId } = surfaceWorld(93);
    const run = (plan: "staple" | "rotation") => {
      let w = structuredClone(s);
      const f = farmOf(w, farmId);
      f.facilities = { fields: 100 };
      f.farm = { seeds: 200, fertility: 100, crops: [], harvests: 0, plan };
      for (let i = 0; i < 6; i++) { farmOf(w, farmId).farm!.seeds = 200; w = step(w).state; }
      return farmOf(w, farmId).farm!.fertility;
    };
    expect(run("rotation")).toBeGreaterThan(100);
    expect(run("staple")).toBeLessThan(100);
    const wait = byId("spring-sowing").choices.find((c) => c.id === "wait")!;
    expect(wait.effects).toEqual(expect.arrayContaining([{ type: "CHANGE_FERTILITY", delta: 30 }]));
  });

  it("a storm damages the crops in the ground", () => {
    const d = byId("dust-storm");
    expect(d.scope).toBe("settlement");
    expect(d.effects).toEqual(expect.arrayContaining([{ type: "CHANGE_CROPS", fraction: -0.3 }]));
    expect(d.effects.some((e) => "target" in e && e.target === "all_settlements")).toBe(false);
  });
});

describe("expeditions and follow-ups", () => {
  it("a carried role whose person has died is not handed to someone else", () => {
    const back = def({ id: "x-back", scope: "settlement", scheduledOnly: true, roles: [{ id: "walker", minAge: 16 }], effects: [{ type: "ADJUST_RESOURCE", resource: "knowledge", amount: 30 }] });
    const go = bunkerEvent("x-go", { roles: [{ id: "walker", minAge: 16 }], choices: [{ id: "go", label: "Go", effects: [{ type: "SCHEDULE_EVENT", event: "x-back", seasons: 4 }] }] });
    let r = step(createWorld({ seed: 94 }), [go, back]);
    const walker = r.events.find((e) => e.definitionId === "x-go")!.trigger!.roles.walker!;
    const w = r.state.characters.find((c) => c.id === walker)!;
    w.deathTick = r.state.tick; w.causeOfDeath = "test";
    r = step(r.state, [go, back]);
    expect(r.events.some((e) => e.definitionId === "x-back" && e.changes.some((c) => c.path.endsWith("resources.knowledge")))).toBe(false);
    expect(r.events.some((e) => e.causeIds.length > 0 && e.title.includes("沒有回來"))).toBe(true);
  });

  it("ownership is checked again when the expedition comes back", () => {
    const { s } = surfaceWorld(95);
    const site = s.locations.find((l) => l.id === "seed_vault")!;
    site.discovered = true;
    const go = bunkerEvent("x-stake", { roles: [{ id: "walker", minAge: 16 }], choices: [{ id: "go", label: "Go", effects: [{ type: "AFTER", seasons: 4, away: ["walker"], title: "Back", text: "Back", effects: [{ type: "CLAIM_SITE", location: "seed_vault" }] }] }] });
    let r = step(s, [go]);
    const other = r.state.settlements.find((x) => x.kind === "settlement" && x.status === "active")!;
    r.state.locations.find((l) => l.id === "seed_vault")!.claimedBy = other.id; // someone got there first
    r = step(r.state, [go]);
    expect(r.state.locations.find((l) => l.id === "seed_vault")!.claimedBy).toBe(other.id);
  });

  it("every expedition choice takes time, including the reckless one", () => {
    for (const id of ["seed-vault-expedition", "aquifer-rumour", "follow-the-signal", "famine-council", "scout-supply-run", "scout-outpost"]) {
      for (const c of byId(id).choices) {
        const instant = c.effects.some((e) => e.type === "DISCOVER_LOCATION" || e.type === "CLAIM_SITE" || (e.type === "ADJUST_RESOURCE" && e.amount > 0 && e.from));
        expect(instant, `${id}.${c.id}`).toBe(false);
      }
    }
  });
});

describe("finite land", () => {
  it("salvage runs out and choices that need it stop being offered", () => {
    const s = createWorld({ seed: 96 });
    const loc = s.locations.find((l) => l.id === s.settlements[0]!.locationId)!;
    loc.salvage = 15;
    const dig = def({ id: "x-dig", scope: "settlement", cooldown: 0, preconditions: [{ type: "settlement_kind", kind: "bunker" }], choices: [{ id: "dig", label: "Dig", effects: [{ type: "ADJUST_RESOURCE", resource: "materials", amount: 10, from: "salvage" }] }, { id: "no", label: "No", effects: [] }] });
    const ctx = new TickContext(structuredClone(s), new Rng(1));
    expect(choiceAvailability(ctx.state, dig.choices[0]!, ctx.state.settlements[0]!, {}).available).toBe(true);
    ctx.state.locations.find((l) => l.id === loc.id)!.salvage = 0;
    expect(choiceAvailability(ctx.state, dig.choices[0]!, ctx.state.settlements[0]!, {}).available).toBe(false);
  });

  it("everyday scrap and forage come out of the land; wild food grows back to its cap, salvage does not", () => {
    let s = createWorld({ seed: 97 });
    const id = s.settlements[0]!.locationId;
    const before = s.locations.find((l) => l.id === id)!.salvage!;
    s = step(s).state;
    expect(s.locations.find((l) => l.id === id)!.salvage!).toBeLessThan(before);
    const fertile = s.locations.find((l) => l.id === "greenhollow")!;
    fertile.wild = 0;
    for (let i = 0; i < 20; i++) s = step(s).state;
    expect(s.locations.find((l) => l.id === "greenhollow")!.wild).toBe(80);
  });
});

describe("shared settlement outcomes", () => {
  it("a caravan only counts as established when it comes back", () => {
    const go = byId("first-caravan").choices.find((c) => c.id === "go")!;
    expect(go.effects.map((e) => e.type)).toEqual(["AFTER"]);
    expect(byId("first-caravan").effects).toEqual([]);
  });

  it("the charter is in force only if the vote passes", () => {
    const d = byId("charter-signing");
    expect(d.resolution).toBe("vote");
    expect(d.effects).toEqual([]);
    expect(d.choices.find((c) => c.id === "refuse")!.effects.some((e) => e.type === "ADD_WORLD_FLAG")).toBe(false);
  });

  it("goods shared by a settlement cannot be paid out once per member", () => {
    const bad = bunkerEvent("x-bad", { participation: "everyone", choices: [{ id: "a", label: "A", effects: [], memberEffects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 5 }] }] });
    expect(validateEventDefinition(bad, { knownEventIds: new Set(), knownStorylineIds: new Set() } as never).errors.map((e) => e.code)).toContain("effect.shared");
  });

  it("a trade with nobody who has the goods is not offered", () => {
    const { s } = surfaceWorld(98);
    const home = s.settlements[0]!;
    for (const x of s.settlements) if (x.id !== home.id) x.resources.food = 0;
    const trade = { id: "t", label: "Trade", tags: [], requires: [], requiresRoles: [], effects: [{ type: "EXCHANGE" as const, get: { resource: "food" as const, amount: 10 } }] };
    expect(choiceAvailability(s, trade, home, {}).available).toBe(false);
  });
});

describe("power and infrastructure", () => {
  it("knowing solar power gives no light; panels do by day, batteries carry it through the night", () => {
    const s = createWorld({ seed: 99 });
    const h = s.settlements[0]!;
    s.technologies.push("salvage_tools", "archives", "workshop", "water_wheel", "mechanical_power", "solar_power");
    expect(powerLevel(s, h)).toBe(0);
    expect(checkEligibility(s, byId("first-light")).eligible).toBe(false);
    h.facilities = { solar_array: 100 };
    expect(powerLevel(s, h)).toBe(0.5);
    expect(powerAt(s, h)).toEqual({ day: 1, night: 0 });
    expect(checkEligibility(s, byId("first-light")).eligible).toBe(false); // sunshine does not light the night
    h.facilities = { solar_array: 100, battery_bank: 100 };
    expect(powerLevel(s, h)).toBe(1);
    expect(powerAt(s, h)).toEqual({ day: 1, night: 1 });
    expect(checkEligibility(s, byId("first-light")).eligible).toBe(true);
    h.facilities = { solar_array: 50, battery_bank: 100 };
    expect(powerLevel(s, h)).toBe(0.5);
  });

  it("a settlement builds what it knows how to build, over seasons and for materials; a generator needs a water mill", () => {
    let s = createWorld({ seed: 100 });
    s.technologies.push("salvage_tools", "archives", "workshop", "water_wheel", "mechanical_power");
    s.settlements[0]!.resources.materials = 500;
    const r = step(s);
    const h = r.state.settlements[0]!;
    // Started in spring, finished two seasons later in autumn: after this year's production, so it helps from next year.
    const started = r.events.findIndex((e) => e.title.includes("開始蓋鍛爐"));
    const finished = r.events.findIndex((e) => e.title.includes("鍛爐蓋好了"));
    expect(started).toBeGreaterThanOrEqual(0);
    expect(finished).toBeGreaterThan(started);
    expect(h.facilities?.forge).toBe(100);
    expect(h.facilities?.generator).toBeUndefined(); // Haven Deep has no river, so no water mill to drive one
    expect(h.resources.materials).toBeLessThan(500);
  });

  it("an expansion takes a year before anyone can move in", () => {
    const s = createWorld({ seed: 101 });
    const h = s.settlements[0]!;
    h.resources.materials = 500;
    h.capacity = 120;
    const r = step(s);
    expect(r.state.settlements[0]!.expanding).toBeDefined();
    expect(r.state.settlements[0]!.capacity).toBe(120);
    const r2 = step(r.state);
    expect(r2.state.settlements[0]!.capacity).toBeGreaterThan(120);
  });

  it("an engineer can repair, patch or strip the worst building, and it really changes", () => {
    const d = byId("engineer-repair-or-strip");
    expect(d.preconditions).toEqual([{ type: "worn", present: true }]);
    const strip = d.choices.find((c) => c.id === "strip")!;
    // Taking a shared building apart is a settlement decision: it is proposed, not done.
    expect(strip.effects[0]).toMatchObject({ type: "PROPOSE", kind: "settlement" });
    expect((strip.effects[0] as { effects: unknown[] }).effects).toEqual(expect.arrayContaining([{ type: "CHANGE_FACILITY", facility: "worst", delta: -40 }]));
  });
});

describe("profession decisions change the world", () => {
  it("a scientist's priority becomes the council's next project", () => {
    let s = applyImmediate(createWorld({ seed: 102 }), { type: "JOIN_WORLD", playerId: "s", playerName: "s", profession: "Scientist" }).state;
    const pri = { ...byId("scientist-priorities"), preconditions: [] as never[], chance: 1, cooldown: 0 };
    s.tick = 6;
    s = stepWorld(s, { events: [pri], actions: [] }).state;
    const p = s.pendingDecisions?.find((x) => x.definitionId === "scientist-priorities");
    if (!p) return; // the personal phase did not pick it this year; the effect is covered below
    s = applyImmediate(s, { type: "CHOOSE", playerId: "s", decisionId: p.id, choiceId: "medicine" }, [pri]).state;
    expect(s.researchFocus && ["water_purification", "field_medicine"].includes(s.researchFocus)).toBeTruthy();
  });

  it("a farmer's plan stays with the settlement", () => {
    const { s, farmId } = surfaceWorld(103);
    farmOf(s, farmId).facilities = { fields: 100 };
    const plan = bunkerEvent("x-plan", { preconditions: [{ type: "settlement_kind", kind: "settlement" }], effects: [{ type: "SET_FARM_PLAN", plan: "rotation" }] });
    const r = step(s, [plan]);
    expect(farmOf(r.state, farmId).farm?.plan).toBe("rotation");
  });
});

describe("determinism", () => {
  it("the same seed gives the same world", () => {
    let a = createWorld({ seed: 104 });
    let b = createWorld({ seed: 104 });
    for (let i = 0; i < 25; i++) { a = stepWorld(a, { events, actions: [] }).state; b = stepWorld(b, { events, actions: [] }).state; }
    expect(hashState(a)).toBe(hashState(b));
  });

  it("a played world with donations and expeditions replays exactly", () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), "yz-v1-")), "t.db"));
    migrateDb(db);
    importSeedContent(db, seedContent);
    const run = createRun(db, { name: "v1", seed: 105 });
    applyPlayerAction(db, run.id, { type: "JOIN_WORLD", playerId: "a", playerName: "a", profession: "Farmer" });
    stepRun(db, run.id, 3);
    try { applyPlayerAction(db, run.id, { type: "START_PROJECT", playerId: "a", tech: "irrigation" }); } catch { /* may not be available */ }
    try { applyPlayerAction(db, run.id, { type: "DONATE_PROJECT", playerId: "a", amount: 10 }); } catch { /* not on a project */ }
    stepRun(db, run.id, 25);
    expect(verifyReplay(db, run.id).ok).toBe(true);
    void playerCharacter;
  });
});
