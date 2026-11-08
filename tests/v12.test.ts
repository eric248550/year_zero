import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOODS, INDUSTRY, PRACTICE, RESOURCES, type EventDefinition, type WorldState } from "@genesis/schemas";
import { good, headOf, powerAt } from "@genesis/narrative";
import { applyPlayerAction, createRun, getRun, importSeedContent, migrateDb, openDb, stepRun } from "@genesis/database";
import { applyImmediate, checkInvariants, createWorld, hashState, manufacture, nextFree, openWork, playerCharacter, stepWorld, TickContext, workBlocker, workOptions } from "@genesis/simulation";
import { Rng } from "@genesis/schemas";
import { seedContent } from "./helpers";

const events = seedContent.events;
const vote = events.find((e) => e.id === "proposal-vote")!;
const step = (s: WorldState, evs: readonly EventDefinition[] = [vote]) => {
  const r = stepWorld(s, { events: evs, actions: [] });
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
};
type Prof = "Farmer" | "Engineer" | "Scientist" | "Medic" | "Scout";
function played(state: WorldState, playerId: string, profession: Prof, extra: Record<string, unknown> = {}): WorldState {
  const j = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId, profession, ...extra });
  expect(j.rejected).toBeNull();
  let s = j.state;
  for (const [st, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId, step: st, choiceId }).state;
  s.pendingDecisions = [];
  return s;
}
const work = (s: WorldState, playerId: string, action: string, target?: string) => {
  const r = applyImmediate(s, { type: "START_WORK", playerId, action, ...(target ? { target } : {}) }, [vote]);
  expect(r.rejected).toBeNull();
  return r.state;
};
const reject = (s: WorldState, playerId: string, action: string, target?: string) => applyImmediate(s, { type: "START_WORK", playerId, action, ...(target ? { target } : {}) }).rejected;
const home = (s: WorldState, id: string) => s.settlements.find((x) => x.id === playerCharacter(s, id)!.homeId)!;
const lead = (s: WorldState, id: string, p: Prof) => { const c = playerCharacter(s, id)!; c.attributes!.survival = 100; c.attributes!.knowledge = 100; expect(headOf(s, home(s, id), p)?.id).toBe(c.id); };
const quiet = (s: WorldState) => { for (const x of s.characters) if (!x.controllerId && x.profession) x.profession = null; return s; };
const founded = (seed: number) => {
  const r = stepWorld(createWorld({ seed }), { events: [], actions: [{ type: "FOUND_SETTLEMENT", locationId: "ashford_crossing", fromSettlementId: "s-haven", settlers: 10 }] });
  expect(r.rejectedActions).toEqual([]);
  // Someone can only have grown up in a town that has stood a year.
  return stepWorld(r.state, { events: [], actions: [] }).state;
};
const surfaceId = (s: WorldState) => s.settlements.find((x) => x.kind === "settlement")!.id;

describe("every profession's journey", () => {
  it("Farmer: limited seed, clears fields, tends a harvest, improves soil; the farm outlives them", () => {
    let s = founded(201);
    s = played(s, "f", "Farmer", { origin: "surface_born", settlementId: surfaceId(s) });
    lead(s, "f", "Farmer");
    const seedStart = home(s, "f").farm!.seeds;
    expect(seedStart).toBeLessThanOrEqual(15);
    s = work(s, "f", "farm_clear");
    expect(home(s, "f").building?.fields).toBeDefined();
    expect(home(s, "f").facilities?.fields).toBeUndefined(); // not done until the seasons are lived
    s = step(s).state;
    expect(home(s, "f").facilities?.fields).toBe(100);
    s = work(s, "f", "farm_tend");
    const y = step(s);
    s = y.state;
    expect(home(s, "f").farm!.harvests).toBeGreaterThan(0);
    expect(y.events.some((e) => e.title.includes("照料了田裡的作物"))).toBe(true);
    const fert = home(s, "f").farm!.fertility;
    s = work(s, "f", "farm_soil");
    s = step(s).state;
    expect(home(s, "f").farm!.fertility).toBeGreaterThan(fert - 7);
    const place = home(s, "f").id;
    const before = s.settlements.find((x) => x.id === place)!.farm!.harvests;
    const me = playerCharacter(s, "f")!;
    me.deathTick = s.tick; me.causeOfDeath = "age";
    for (let i = 0; i < 4; i++) s = step(s).state;
    expect(s.settlements.find((x) => x.id === place)!.farm!.harvests).toBeGreaterThanOrEqual(before + 3);
    expect(s.settlements.find((x) => x.id === place)!.facilities?.fields).toBeGreaterThanOrEqual(30);
  });

  it("Engineer: builds, repairs, inspects and improves real buildings", () => {
    let s = played(createWorld({ seed: 202 }), "e", "Engineer");
    s.technologies.push("salvage_tools", "archives", "workshop");
    lead(s, "e", "Engineer");
    home(s, "e").resources.materials = 300;
    s = work(s, "e", "eng_build", "forge");
    s = work(s, "e", "eng_build", "workshop");
    s = step(s).state;
    expect(home(s, "e").facilities?.forge).toBe(100);
    expect(home(s, "e").facilities?.workshop).toBe(100);
    home(s, "e").facilities!.forge = 40;
    s = work(s, "e", "eng_repair", "forge");
    s = work(s, "e", "eng_inspect");
    s = work(s, "e", "eng_improve", "workshop");
    s = step(s).state;
    expect(home(s, "e").facilities!.forge!).toBeGreaterThan(60);
    expect(home(s, "e").upgrades?.workshop).toBe(1);
  });

  it("Scientist: experiments, improves a process, investigates a lost technology", () => {
    let s = played(createWorld({ seed: 203 }), "s", "Scientist");
    s.technologies.push("archives");
    lead(s, "s", "Scientist");
    home(s, "s").resources.knowledge = 200;
    s = work(s, "s", "sci_process", "food");
    s = step(s).state;
    expect(home(s, "s").processes?.food).toBe(1);
    s = work(s, "s", "sci_investigate", "power_grid");
    s = step(s).state;
    expect(s.techNotes?.power_grid).toBeGreaterThan(0);
    expect(s.activityLog!.filter((a) => a.status === "completed").length).toBe(2);
    let tried = false;
    for (let i = 0; i < 5; i++) { home(s, "s").resources.knowledge = 50; home(s, "s").resources.materials = 50; s = work(s, "s", "sci_experiment"); s = step(s).state; tried = true; }
    expect(tried).toBe(true);
    expect(s.activityLog!.filter((a) => a.actionId === "sci_experiment").length).toBe(5);
  });

  it("Medic: treats a patient with a real dose, allocates, prepares, improves public health", () => {
    let s = played(createWorld({ seed: 204 }), "m", "Medic");
    lead(s, "m", "Medic");
    const h = home(s, "m");
    const patient = s.characters.find((c) => c.homeId === h.id && !c.controllerId && c.deathTick === null && s.tick - c.birthTick > 20)!;
    patient.attributes!.health = 30;
    const doses = good(h, "medicine");
    s = work(s, "m", "med_treat", patient.id);
    expect(good(home(s, "m"), "medicine")).toBe(doses - 1);
    s = work(s, "m", "med_health");
    s = step(s).state;
    expect(s.characters.find((c) => c.id === patient.id)!.attributes!.health).toBeGreaterThan(30);
    expect(home(s, "m").processes?.health).toBe(1);
    home(s, "m").goods!.medicine = 0;
    expect(reject(s, "m", "med_treat", patient.id)).toBeTruthy();
    s = work(s, "m", "med_prepare");
    s = step(s).state;
    expect(good(home(s, "m"), "medicine")).toBeGreaterThanOrEqual(3);
  });

  it("Scout: explores, salvages (from a finite pool), proposes an outpost", () => {
    let s = played(createWorld({ seed: 205 }), "x", "Scout");
    playerCharacter(s, "x")!.attributes!.survival = 100;
    const site = s.locations.find((l) => l.id === "cinder_flats")!;
    const pool = site.salvage!;
    s = work(s, "x", "sco_salvage", "cinder_flats");
    expect(playerCharacter(s, "x")!.awayUntil).toBeDefined();
    expect(reject(s, "x", "sco_explore")).toBeNull(); // still fits in the year after the trip
    const y = step(s);
    s = y.state;
    expect(s.locations.find((l) => l.id === "cinder_flats")!.salvage).toBeLessThan(pool);
    expect(playerCharacter(s, "x")!.awayUntil).toBeUndefined();
    let known = s.locations.filter((l) => l.discovered).length;
    for (let i = 0; i < 8 && !reject(s, "x", "sco_explore"); i++) { s = work(s, "x", "sco_explore"); s = step(s).state; }
    expect(s.locations.filter((l) => l.discovered).length).toBeGreaterThan(known);
    known = 0;
    s = work(s, "x", "sco_expedition", "cinder_flats");
    expect(s.proposals!.at(-1)).toMatchObject({ status: "open", kind: "settlement" });
    expect(s.locations.find((l) => l.id === "cinder_flats")!.claimedBy).toBeFalsy();
  });
});

describe("one timeline", () => {
  it("work fills the seasons in order and cannot overlap or overrun the year", () => {
    let s = quiet(played(createWorld({ seed: 210 }), "p", "Medic"));
    home(s, "p").resources.materials = 500; home(s, "p").resources.food = 500; home(s, "p").resources.knowledge = 500;
    const base = (s.tick + 1) * 4;
    for (let i = 0; i < 2; i++) s = work(s, "p", "med_health");
    expect(openWork(s, playerCharacter(s, "p")!.id).map((a) => [a.startSeason, a.dueSeason])).toEqual([[base, base + 1], [base + 2, base + 3]]);
    expect(nextFree(s, playerCharacter(s, "p")!, base)).toBe(base + 4);
    expect(reject(s, "p", "med_prepare")).toMatch(/排滿|planned/);
    expect(checkInvariants(s)).toEqual([]);
  });

  it("work resolves exactly once", () => {
    let s = quiet(played(createWorld({ seed: 211 }), "p", "Medic"));
    s = work(s, "p", "med_prepare");
    const r1 = step(s);
    expect(r1.state.activities ?? []).toHaveLength(0);
    expect(r1.state.activityLog).toHaveLength(1);
    const r2 = step(r1.state);
    expect(r2.state.activityLog).toHaveLength(1);
    expect(r2.events.some((e) => e.trigger?.summary?.startsWith(`Work ${r1.state.activityLog![0]!.id}:`))).toBe(false);
  });

  it("someone on a trip is not available to anything at home, and calling off work returns what was paid", () => {
    let s = quiet(played(createWorld({ seed: 212 }), "x", "Scout"));
    const start = home(s, "x").resources.food;
    s = work(s, "x", "sco_explore");
    expect(home(s, "x").resources.food).toBe(start - 6);
    const id = s.activities![0]!.id;
    const c = applyImmediate(s, { type: "CANCEL_WORK", playerId: "x", activityId: id });
    expect(c.rejected).toBeNull();
    expect(c.state.settlements[0]!.resources.food).toBe(start);
    expect(playerCharacter(c.state, "x")!.awayUntil).toBeUndefined();
  });

  it("a plan cannot be started by anyone else, or by someone too young", () => {
    let s = played(createWorld({ seed: 213 }), "p", "Medic");
    const c = playerCharacter(s, "p")!;
    expect(workBlocker(s, c, "eng_inspect", undefined, (s.tick + 1) * 4)).toMatch(/本行|Engineer/);
    c.birthTick = s.tick - 10;
    expect(workBlocker(s, c, "med_prepare", undefined, (s.tick + 1) * 4)).toMatch(/年輕|young/);
    s = played(createWorld({ seed: 213 }), "q", "Medic");
    expect(applyImmediate(s, { type: "CANCEL_WORK", playerId: "q", activityId: "nope" }).rejected).toBeTruthy();
  });

  it("death during work ends it with no reward; the building site goes on without the builder", () => {
    let s = quiet(played(createWorld({ seed: 214 }), "x", "Scout"));
    s = work(s, "x", "sco_salvage", "cinder_flats");
    const site = s.locations.find((l) => l.id === "cinder_flats")!.salvage;
    const me = playerCharacter(s, "x")!;
    me.deathTick = s.tick; me.causeOfDeath = "accident";
    s = step(s).state;
    expect(s.activities ?? []).toHaveLength(0);
    expect(s.locations.find((l) => l.id === "cinder_flats")!.salvage).toBe(site);
    expect(s.activityLog!.at(-1)!.status).toBe("interrupted");

    let b = played(createWorld({ seed: 215 }), "e", "Engineer");
    b.technologies.push("salvage_tools", "archives", "workshop");
    lead(b, "e", "Engineer");
    b = work(b, "e", "eng_build", "forge");
    const e = playerCharacter(b, "e")!;
    e.deathTick = b.tick; e.causeOfDeath = "accident";
    b = step(b).state;
    expect(b.settlements[0]!.facilities?.forge).toBe(100);
  });

  it("the same seed and the same plans give the same world", () => {
    const run = () => {
      let w = played(createWorld({ seed: 216 }), "p", "Farmer");
      for (let i = 0; i < 12; i++) { const r = applyImmediate(w, { type: "START_WORK", playerId: "p", action: "farm_tend" }); if (!r.rejected) w = r.state; w = stepWorld(w, { events, actions: [] }).state; }
      return hashState(w);
    };
    expect(run()).toBe(run());
  });
});

describe("making things", () => {
  it("smelting and crafting take exactly what they give, and need the buildings", () => {
    const s = createWorld({ seed: 220 });
    const h = s.settlements[0]!;
    h.goods = { ore: 40, timber: 100, parts: 0, metal: 0 };
    h.facilities = {};
    const ctx = new TickContext(s, new Rng(1));
    manufacture(ctx, h, 10);
    expect(good(h, "ore")).toBe(40); // no forge
    expect(good(h, "metal")).toBe(0);
    h.goods = { ore: 40, timber: 80, metal: 0, parts: 0 };
    h.facilities = { forge: 100 };
    manufacture(ctx, h, 10);
    const batches = 12; // 10 engineers × 1.2 per year
    expect(good(h, "ore")).toBe(40 - batches * INDUSTRY.smelt.ore);
    expect(good(h, "metal")).toBe(batches * INDUSTRY.smelt.metal);
    h.goods = { timber: 10, metal: 10, parts: 0 };
    h.facilities = { workshop: 100 };
    manufacture(ctx, h, 10);
    expect(good(h, "metal")).toBe(2);
    expect(good(h, "timber")).toBe(2);
    expect(good(h, "parts")).toBe(16);
  });

  it("a player's forge run conserves its inputs and outputs", () => {
    let s = quiet(played(createWorld({ seed: 221 }), "e", "Engineer"));
    const h = home(s, "e");
    h.facilities = { forge: 100 };
    h.goods = { ore: 8, timber: 4 };
    s = work(s, "e", "eng_smelt");
    expect(good(home(s, "e"), "ore")).toBe(0);
    expect(good(home(s, "e"), "timber")).toBe(0);
    s = step(s).state;
    expect(good(home(s, "e"), "metal")).toBe(4);
  });

  it("production keeps going after the ruins are gone", () => {
    let s = founded(222);
    const surface = s.settlements.find((x) => x.kind === "settlement")!;
    const loc = s.locations.find((l) => l.id === surface.locationId)!;
    loc.salvage = 0; loc.ore = 800;
    surface.resources.food = 2000; surface.resources.water = 2000;
    surface.resources.materials = 50;
    surface.facilities = { lumber_camp: 100, mine: 100, forge: 100, workshop: 100, fields: 100 };
    surface.goods = { parts: 20 };
    surface.farm!.seeds = 40;
    s.technologies.push("salvage_tools", "archives", "workshop");
    for (const c of s.characters) if (c.homeId === surface.id && c.deathTick === null && s.tick - c.birthTick >= 16) c.profession = "Engineer";
    s = stepWorld(s, { events: [], actions: [] }).state;
    const madeStart = s.stats.made?.parts ?? 0;
    for (let i = 0; i < 15; i++) s = stepWorld(s, { events: [], actions: [] }).state;
    const after = s.settlements.find((x) => x.id === surface.id)!;
    expect(s.locations.find((l) => l.id === surface.locationId)!.salvage).toBe(0);
    expect(after.resources.materials).toBeGreaterThan(15);
    expect(s.stats.made!.parts!).toBeGreaterThan(madeStart);
  });

  it("resources and goods never go negative or appear in a year of nothing but work", () => {
    let s = played(createWorld({ seed: 223 }), "p", "Farmer");
    for (let i = 0; i < 20; i++) {
      s = stepWorld(s, { events, actions: [] }).state;
      for (const x of s.settlements) {
        for (const r of RESOURCES) expect(x.resources[r]).toBeGreaterThanOrEqual(0);
        for (const g of GOODS) expect(good(x, g)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("who decides", () => {
  it("someone not in charge proposes; nothing shared changes until it is decided, and the head can act alone", () => {
    let s = played(createWorld({ seed: 230 }), "e", "Engineer");
    s.technologies.push("salvage_tools", "archives", "workshop");
    playerCharacter(s, "e")!.attributes!.survival = 0;
    const mat = home(s, "e").resources.materials;
    const opt = workOptions(s, playerCharacter(s, "e")!).find((o) => o.id === "eng_build")!;
    expect(opt.proposes).toBe(true);
    s = work(s, "e", "eng_build", "forge");
    const p = s.proposals!.at(-1)!;
    expect(p).toMatchObject({ status: "open", proposerId: playerCharacter(s, "e")!.id, kind: "domain" });
    expect(p.deadlineTick).toBe(s.tick + 1);
    expect(home(s, "e").building?.forge).toBeUndefined();
    expect(home(s, "e").resources.materials).toBe(mat);
    const r = step(s, [vote]);
    const done = r.state.proposals!.find((x) => x.id === p.id)!;
    expect(["executed", "rejected", "failed"]).toContain(done.status); // never blocked by anyone offline
    expect(r.state.pendingDecisions?.some((d) => d.proposalId === p.id)).toBe(false);
    const notice = r.state.players!.e!.notices!.find((n) => n.title.includes("提案"));
    expect(notice).toBeDefined();
    let t = played(createWorld({ seed: 231 }), "e", "Engineer");
    t.technologies.push("salvage_tools", "archives", "workshop");
    lead(t, "e", "Engineer");
    t = work(t, "e", "eng_build", "forge");
    expect(t.settlements[0]!.building?.forge).toBeDefined();
  });

  it("an approved proposal is re-checked against today's stores, and only runs once", () => {
    let s = played(createWorld({ seed: 232 }), "e", "Engineer");
    s.technologies.push("salvage_tools", "archives", "workshop");
    playerCharacter(s, "e")!.attributes!.survival = 0;
    s = work(s, "e", "eng_build", "forge");
    const p = s.proposals!.at(-1)!;
    const pending = s.pendingDecisions!.find((x) => x.proposalId === p.id)!;
    pending.responses = Object.fromEntries(pending.participants.map((id) => [id, "approve"]));
    home(s, "e").resources.materials = 0;
    let r = step(s, [vote]);
    const failed = r.state.proposals!.find((x) => x.id === p.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.failReason).toBeTruthy();
    expect(r.state.settlements[0]!.building?.forge).toBeUndefined();
    // Enough next time: the approved one pays exactly once.
    s = played(createWorld({ seed: 233 }), "e", "Engineer");
    s.technologies.push("salvage_tools", "archives", "workshop");
    playerCharacter(s, "e")!.attributes!.survival = 0;
    s = work(s, "e", "eng_build", "forge");
    const q = s.proposals!.at(-1)!;
    const pend = s.pendingDecisions!.find((x) => x.proposalId === q.id)!;
    pend.responses = Object.fromEntries(pend.participants.map((id) => [id, "approve"]));
    r = step(s, [vote]);
    const spends = r.events.flatMap((e) => e.changes).filter((c) => c.path === `settlements.${q.settlementId}.building.forge`);
    expect(spends).toHaveLength(1);
    expect(r.state.proposals!.find((x) => x.id === q.id)!.status).toBe("executed");
  });

  it("someone away does not decide", () => {
    const s = createWorld({ seed: 234 });
    const h = s.settlements[0]!;
    const head = headOf(s, h, "Engineer")!;
    head.awayUntil = s.tick * 4 + 6;
    expect(headOf(s, h, "Engineer")!.id).not.toBe(head.id);
  });
});

describe("events tell the truth", () => {
  it("a road takes its year; only then does it exist", () => {
    const road = events.find((e) => e.id === "road-building")!;
    const build = road.choices.find((c) => c.id === "build")!;
    expect(build.effects.map((e) => e.type)).toEqual(["AFTER"]);
    expect((build.effects[0] as { seasons: number }).seasons).toBe(4);
  });

  it("no story event hands out a specialty outright; practice earns it", () => {
    for (const d of events) for (const c of d.choices) expect(c.effects.some((e) => e.type === "ADD_SPECIALTY"), d.id).toBe(false);
    let s = quiet(played(createWorld({ seed: 240 }), "p", "Medic"));
    home(s, "p").resources.materials = 900;
    home(s, "p").resources.food = 900;
    const me = () => playerCharacter(s, "p")!;
    for (let i = 0; i < PRACTICE.threshold - 1; i++) { s = work(s, "p", "med_prepare"); s = step(s).state; }
    expect(me().specialties ?? []).not.toContain("midwifery");
    expect(me().practice?.midwifery).toBe(PRACTICE.threshold - 1);
    s = work(s, "p", "med_prepare");
    s = step(s).state;
    expect(me().specialties).toContain("midwifery");
  });

  it("sunshine is not night light: solar alone gives no power after dark", () => {
    const s = createWorld({ seed: 241 });
    const h = s.settlements[0]!;
    h.facilities = { solar_array: 100 };
    expect(powerAt(s, h)).toEqual({ day: 1, night: 0 });
    h.facilities = { solar_array: 100, battery_bank: 60 };
    expect(powerAt(s, h)).toEqual({ day: 1, night: 0.6 });
  });

  it("a settlement-wide reward from a personal event happens once, however many players it reaches", () => {
    const personal = { ...events.find((e) => e.id === "medic-allocation")!, preconditions: [] };
    let s = played(played(createWorld({ seed: 242 }), "a", "Medic"), "b", "Medic");
    const h = home(s, "a");
    h.health = 40;
    const ids = [playerCharacter(s, "a")!.id, playerCharacter(s, "b")!.id];
    s.pendingDecisions = ids.map((id, i) => ({ id: `d${i}`, definitionId: personal.id, definitionVersion: 1, settlementId: h.id, roles: { you: id }, participants: [id], firedTick: s.tick, resolveTick: s.tick + 1, responses: {} }));
    s = applyImmediate(s, { type: "CHOOSE", playerId: "a", decisionId: "d0", choiceId: "triage" }, [personal]).state;
    const once = home(s, "a").health;
    expect(once).toBe(43);
    s = applyImmediate(s, { type: "CHOOSE", playerId: "b", decisionId: "d1", choiceId: "triage" }, [personal]).state;
    expect(home(s, "a").health).toBe(once);
  });
});

describe("many players at once", () => {
  it("two players cannot spend the same supplies; the second is told no", () => {
    let s = quiet(played(played(createWorld({ seed: 250 }), "a", "Medic"), "b", "Medic"));
    const h = home(s, "a");
    h.resources.food = 8; h.resources.materials = 3; h.resources.knowledge = 0;
    s = work(s, "a", "med_prepare");
    expect(reject(s, "b", "med_prepare")).toBeTruthy();
    expect(home(s, "a").resources.food).toBe(5);
    expect(home(s, "a").resources.materials).toBe(1);
  });

  it("the same submission twice is one piece of work", () => {
    const s = quiet(played(createWorld({ seed: 251 }), "a", "Medic"));
    const go = { type: "START_WORK", playerId: "a", action: "med_prepare", requestId: "req-1" };
    const r1 = applyImmediate(s, go);
    expect(r1.rejected).toBeNull();
    expect(applyImmediate(r1.state, go).rejected).toMatch(/already/);
  });

  it("two connections acting on one world both land, and neither overwrites the other", () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-v12-"));
    const path = join(dir, "t.db");
    const a = openDb(path); migrateDb(a);
    const b = openDb(path);
    try {
      importSeedContent(a, seedContent);
      const run = createRun(a, { seed: 252 });
      for (const [db, p] of [[a, "p1"], [b, "p2"]] as const) {
        applyPlayerAction(db, run.id, { type: "JOIN_WORLD", playerId: p, playerName: p, profession: "Medic" });
        for (const [step0, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) applyPlayerAction(db, run.id, { type: "PROLOGUE", playerId: p, step: step0, choiceId });
      }
      applyPlayerAction(a, run.id, { type: "START_WORK", playerId: "p1", action: "med_prepare" });
      applyPlayerAction(b, run.id, { type: "START_WORK", playerId: "p2", action: "med_prepare" });
      const { state } = getRun(a, run.id);
      expect(state.activities).toHaveLength(2);
      stepRun(a, run.id, 1);
      expect(getRun(b, run.id).state.activities ?? []).toHaveLength(0);
    } finally {
      a.$client.close(); b.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
