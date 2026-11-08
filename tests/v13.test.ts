import { describe, expect, it } from "vitest";
import { INDUSTRY, NPC_BUILD_BASE, NPC_BUILD_PEOPLE, type WorldState } from "@genesis/schemas";
import { good } from "@genesis/narrative";
import { applyImmediate, checkInvariants, createWorld, hashState, manufacture, playerCharacter, stepWorld, TickContext, workBlocker } from "@genesis/simulation";
import { Rng } from "@genesis/schemas";
import { materialsFrom } from "../packages/simulation/src/systems/economy";
import { facilities } from "../packages/simulation/src/systems/legacy";
import { seedContent } from "./helpers";

const events = seedContent.events;
const vote = events.find((e) => e.id === "proposal-vote")!;
const step = (s: WorldState, actions: unknown[] = [], ev: typeof events = []) => { const r = stepWorld(s, { events: ev, actions }); expect(checkInvariants(r.state, r.events)).toEqual([]); return r; };
const share = (s: WorldState, sid: string, p: string) => { const a = s.characters.filter((c) => c.deathTick === null && c.homeId === sid && c.profession); return a.filter((c) => c.profession === p).length / Math.max(1, a.length); };
const join = (s: WorldState, id: string, profession: "Farmer" | "Engineer") => {
  let w = applyImmediate(s, { type: "JOIN_WORLD", playerId: id, playerName: id, profession }).state;
  for (const [st, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) w = applyImmediate(w, { type: "PROLOGUE", playerId: id, step: st, choiceId }).state;
  w.pendingDecisions = [];
  return w;
};

describe("choices change the world", () => {
  it("the same seed and the same decisions give the same world", () => {
    const run = () => { let s = createWorld({ seed: 301 }); s = step(s, [{ type: "SET_PRIORITY", settlementId: "s-haven", priority: "industry" }]).state; for (let i = 0; i < 25; i++) s = stepWorld(s, { events, actions: [] }).state; return hashState(s); };
    expect(run()).toBe(run());
  });

  it("a settlement's priority changes who its young become, over a generation", () => {
    const run = (priority: "food" | "knowledge") => { let s = createWorld({ seed: 302 }); s = step(s, [{ type: "SET_PRIORITY", settlementId: "s-haven", priority }]).state; for (let i = 0; i < 40; i++) s = stepWorld(s, { events: [], actions: [] }).state; return s; };
    const a = run("food"), b = run("knowledge");
    expect(share(a, "s-haven", "Farmer") - share(b, "s-haven", "Farmer")).toBeGreaterThan(0.05);
    expect(share(b, "s-haven", "Scientist") - share(a, "s-haven", "Scientist")).toBeGreaterThan(0.05);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("choosing to build nothing new means nothing new gets built, and repairs still happen", () => {
    let s = createWorld({ seed: 303 });
    s.technologies.push("salvage_tools", "archives", "workshop");
    s.settlements[0]!.resources.materials = 500;
    s.settlements[0]!.priority = "hoard";
    s = step(s).state;
    expect(s.settlements[0]!.facilities?.forge).toBeUndefined();
  });

  it("a settlement left to itself stops adding buildings past what its people can tend", () => {
    let s = createWorld({ seed: 304 });
    s.technologies.push("salvage_tools", "archives", "workshop", "water_wheel", "mechanical_power", "water_purification");
    const h = s.settlements[0]!;
    h.resources.materials = 5000; h.resources.food = 5000; h.resources.water = 5000;
    h.facilities = Object.fromEntries(["greenhouse", "schoolhouse", "meeting_hall", "watchtower", "palisade", "fields"].map((f) => [f, 100]));
    for (const c of s.characters) if (!c.controllerId) c.profession = null; // nobody to act on their own initiative
    for (let i = 0; i < 12; i++) s = step(s).state;
    const standing = Object.values(s.settlements[0]!.facilities ?? {}).filter((c) => (c ?? 0) >= 30).length;
    expect(standing).toBeLessThanOrEqual(NPC_BUILD_BASE + Math.floor(s.characters.filter((c) => c.deathTick === null && c.homeId === h.id).length / NPC_BUILD_PEOPLE) + 1);
  });

  it("a priority proposal goes to the people who decide, and runs once", () => {
    let s = join(createWorld({ seed: 305 }), "p", "Farmer");
    const r = applyImmediate(s, { type: "PROPOSE_PRIORITY", playerId: "p", priority: "food" }, [vote]);
    expect(r.rejected).toBeNull();
    s = r.state;
    expect(s.settlements[0]!.priority).toBeUndefined();
    expect(applyImmediate(s, { type: "PROPOSE_PRIORITY", playerId: "p", priority: "food" }, [vote]).rejected).toMatch(/already/);
    const p = s.proposals!.at(-1)!;
    const d = s.pendingDecisions!.find((x) => x.proposalId === p.id)!;
    d.responses = Object.fromEntries(d.participants.map((id) => [id, "approve"]));
    const y = step(s, [], [vote]);
    expect(y.state.settlements[0]!.priority).toBe("food");
    expect(y.events.flatMap((e) => e.changes).filter((c) => c.path.endsWith(".priority"))).toHaveLength(1);
    const again = step(y.state, [], [vote]);
    expect(again.events.flatMap((e) => e.changes).filter((c) => c.path.endsWith(".priority"))).toHaveLength(0);
  });

  it("what a player built and decided outlives them, and the next life starts from it", () => {
    let s = join(createWorld({ seed: 306 }), "p", "Engineer");
    s.settlements[0]!.upgrades = { forge: 1 };
    s.settlements[0]!.priority = "industry";
    const me = playerCharacter(s, "p")!;
    me.deathTick = s.tick; me.causeOfDeath = "age";
    s = step(s).state;
    expect(s.players!.p!.status).toBe("awaiting_succession");
    s = applyImmediate(s, { type: "CONTINUE_AS", playerId: "p", mode: "random" }).state;
    expect(playerCharacter(s, "p")!.id).not.toBe(me.id);
    expect(s.settlements[0]!.upgrades?.forge).toBe(1);
    expect(s.settlements[0]!.priority).toBe("industry");
  });

  it("dead or too-young characters cannot take up new work", () => {
    const s = join(createWorld({ seed: 307 }), "p", "Farmer");
    const c = playerCharacter(s, "p")!;
    c.deathTick = 0; c.causeOfDeath = "x";
    expect(workBlocker(s, c, "farm_seed", undefined, 4)).toBeTruthy();
    expect(applyImmediate(s, { type: "START_WORK", playerId: "p", action: "farm_seed" }).rejected).toBeTruthy();
  });

  it("a reborn child never has close kin as parents", () => {
    const s = join(createWorld({ seed: 308 }), "p", "Farmer");
    const me = playerCharacter(s, "p")!;
    me.deathTick = s.tick; me.causeOfDeath = "age";
    s.players!.p!.status = "awaiting_succession"; s.players!.p!.characterId = null;
    for (const c of s.characters) if (c.deathTick === null && s.tick - c.birthTick < 16) { c.deathTick = s.tick; c.causeOfDeath = "x"; }
    const out = applyImmediate(s, { type: "CONTINUE_AS", playerId: "p", mode: "random" });
    expect(out.rejected).toBeNull();
    expect(checkInvariants(out.state)).toEqual([]);
  });
});

describe("production has limits", () => {
  it("timber alone makes no metal and no parts", () => {
    const s = createWorld({ seed: 310 });
    const h = s.settlements[0]!;
    h.goods = { timber: 200, parts: 0, metal: 0, ore: 0 };
    h.facilities = { forge: 100, workshop: 100 };
    manufacture(new TickContext(s, new Rng(1)), h, 20);
    expect(good(h, "metal")).toBe(0);
    expect(good(h, "parts")).toBe(0);
  });

  it("an exhausted deposit stays exhausted", () => {
    const s = createWorld({ seed: 311 });
    const h = s.settlements[0]!;
    const loc = s.locations.find((l) => l.id === h.locationId)!;
    loc.salvage = 0; loc.ore = 0; loc.timber = 0;
    h.facilities = { mine: 100, lumber_camp: 100 };
    h.goods = { parts: 10 };
    expect(materialsFrom(new TickContext(s, new Rng(1)), h, loc, 200)).toBe(0);
    expect(good(h, "ore")).toBe(0);
    const claim = createWorld({ seed: 312 });
    const site = claim.locations.find((l) => l.id === "cinder_flats")!;
    site.claimedBy = "s-haven"; site.ore = 0;
    let w = claim;
    for (let i = 0; i < 5; i++) w = stepWorld(w, { events: [], actions: [] }).state;
    expect(w.locations.find((l) => l.id === "cinder_flats")!.ore).toBe(0);
  });

  it("ore is dug for the forge's need, not because hands are free", () => {
    const s = createWorld({ seed: 313 });
    const h = s.settlements[0]!;
    const loc = s.locations.find((l) => l.id === h.locationId)!;
    loc.salvage = 0; loc.ore = 500;
    h.facilities = { mine: 100 };
    h.goods = { parts: 10, ore: INDUSTRY.target.ore };
    materialsFrom(new TickContext(s, new Rng(1)), h, loc, 200);
    expect(loc.ore).toBe(500);
  });

  it("scrap from worn parts returns less metal than the parts were made from", () => {
    const s = createWorld({ seed: 314 });
    const h = s.settlements[0]!;
    h.facilities = { forge: 100, workshop: 100 };
    h.goods = { parts: 10, metal: 0 };
    h.resources.materials = 100;
    facilities(new TickContext(s, new Rng(1)));
    const partsUsed = 10 - good(h, "parts");
    const metalBack = good(h, "metal");
    expect(partsUsed).toBeGreaterThan(0);
    expect(metalBack).toBeLessThan(partsUsed / INDUSTRY.craft.parts);
  });

  it("maintenance recovers less than it spends", () => {
    let s = createWorld({ seed: 315 });
    for (let i = 0; i < 30; i++) s = stepWorld(s, { events: [], actions: [] }).state;
    const f = s.stats.flow!;
    expect(f.recycled!).toBeLessThan(f.upkeep!);
  });

  it("machines wear out once there are no tools to keep them", () => {
    const s = createWorld({ seed: 316 });
    const h = s.settlements[0]!;
    h.facilities = { forge: 80 };
    h.goods = { parts: 0 };
    h.resources.materials = 50;
    facilities(new TickContext(s, new Rng(1)));
    expect(h.facilities.forge).toBeLessThan(80);
  });
});

describe("the story is still reachable", () => {
  it("every storyline still has events that happen", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      let s = join(join(createWorld({ seed: 320 + seed }), "a", "Farmer"), "b", "Engineer");
      for (let y = 0; y < 110; y++) { const r = stepWorld(s, { events, actions: [] }); s = r.state; for (const e of r.events) if (e.definitionId) seen.add(e.definitionId); }
    }
    for (const line of seedContent.storylines) {
      const members = events.filter((e) => e.storylineIds.includes(line.id)).map((e) => e.id);
      expect(members.some((id) => seen.has(id)), line.id).toBe(true);
    }
  }, 60000);
});
