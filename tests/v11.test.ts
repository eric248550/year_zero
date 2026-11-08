import { describe, expect, it } from "vitest";
import { Rng, type EventDefinition, type WorldState } from "@genesis/schemas";
import { choiceAvailability, headOf, powerLevel, proposalDeciders } from "@genesis/narrative";
import { TickContext, applyImmediate, checkInvariants, createWorld, hashState, playerCharacter, stepWorld } from "@genesis/simulation";
import { materialsFrom } from "../packages/simulation/src/systems/economy";
import { def, seedContent } from "./helpers";

const events = seedContent.events;
const vote = events.find((e) => e.id === "proposal-vote")!;
const step = (s: WorldState, evs: readonly EventDefinition[] = [vote]) => {
  const r = stepWorld(s, { events: evs, actions: [] });
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
};
function played(state: WorldState, playerId: string, profession: "Farmer" | "Engineer" | "Scientist" | "Medic" | "Scout"): WorldState {
  let s = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId, profession }).state;
  for (const [st, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId, step: st, choiceId }).state;
  s.pendingDecisions = [];
  return s;
}
/** A personal event whose only choice proposes `effects`. */
const proposing = (id: string, kind: "domain" | "settlement", effects: unknown[], domain?: string) => def({
  id, scope: "settlement", maxOccurrences: 1, roles: [{ id: "you", player: true }], preconditions: [{ type: "settlement_kind", kind: "bunker" }],
  choices: [{ id: "go", label: "Propose", tags: ["growth"], effects: [{ type: "PROPOSE", kind, title: id, tags: ["growth"], effects, ...(domain ? { domain } : {}) } as never] }],
});
function propose(s: WorldState, playerId: string, d: EventDefinition): WorldState {
  const st = structuredClone(s);
  const me = playerCharacter(st, playerId)!;
  st.pendingDecisions = [{ id: `x-${d.id}`, definitionId: d.id, definitionVersion: 1, settlementId: me.homeId, roles: { you: me.id }, participants: [me.id], firedTick: st.tick, resolveTick: st.tick + 1, responses: {} }];
  const r = applyImmediate(st, { type: "CHOOSE", playerId, decisionId: `x-${d.id}`, choiceId: "go" }, [d, vote]);
  expect(r.rejected).toBeNull();
  return r.state;
}

describe("who may change shared things", () => {
  it("a farmer who is not the head farmer only proposes; the head decides, and it is recorded", () => {
    let s = played(createWorld({ seed: 110 }), "f", "Farmer");
    const me = playerCharacter(s, "f")!;
    const home = s.settlements.find((x) => x.id === me.homeId)!;
    me.attributes!.survival = 0; // make sure someone else heads the farmers
    const head = headOf(s, home, "Farmer")!;
    expect(head.id).not.toBe(me.id);
    const d = proposing("x-plan", "domain", [{ type: "SET_FARM_PLAN", plan: "rotation" }], "Farmer");
    s = propose(s, "f", d);
    const p = s.proposals!.at(-1)!;
    expect(p).toMatchObject({ status: "open", proposerId: me.id, deciders: [head.id] });
    expect(home.farm?.plan).not.toBe("rotation");
    s = step(s, [d, vote]).state;
    const done = s.proposals!.find((x) => x.id === p.id)!;
    expect(["executed", "rejected"]).toContain(done.status);
    expect(done.approvedBy.length + done.rejectedBy.length).toBe(1);
    expect(s.settlements.find((x) => x.id === home.id)!.farm?.plan === "rotation").toBe(done.status === "executed");
  });

  it("the head of the work decides a domain change alone", () => {
    let s = played(createWorld({ seed: 111 }), "f", "Farmer");
    const me = playerCharacter(s, "f")!;
    me.attributes!.survival = 100;
    const d = proposing("x-plan2", "domain", [{ type: "SET_FARM_PLAN", plan: "staple" }], "Farmer");
    s = propose(s, "f", d);
    const p = s.proposals!.at(-1)!;
    expect(p).toMatchObject({ status: "executed", approvedBy: [me.id] });
    expect(s.settlements.find((x) => x.id === me.homeId)!.farm?.plan).toBe("staple");
  });

  it("settlement changes go to the governing body, whoever proposes them", () => {
    const s = createWorld({ seed: 112 });
    const h = s.settlements[0]!;
    const heads = proposalDeciders(s, h, "settlement");
    expect(heads.length).toBeLessThanOrEqual(5);
    s.flags["governance.assembly"] = true;
    expect(proposalDeciders(s, h, "settlement").length).toBeGreaterThan(50);
    delete s.flags["governance.assembly"];
    s.flags["governance.elder_council"] = true;
    const elders = proposalDeciders(s, h, "settlement");
    for (const id of elders) expect(s.tick - s.characters.find((c) => c.id === id)!.birthTick).toBeGreaterThanOrEqual(60);
  });

  it("two conflicting proposals cannot be open at once", () => {
    let s = played(createWorld({ seed: 113 }), "f", "Farmer");
    playerCharacter(s, "f")!.attributes!.survival = 0;
    const a = proposing("x-a", "domain", [{ type: "SET_FARM_PLAN", plan: "rotation" }], "Farmer");
    s = propose(s, "f", a);
    const b = proposing("x-b", "domain", [{ type: "SET_FARM_PLAN", plan: "staple" }], "Farmer");
    const me = playerCharacter(s, "f")!;
    const home = s.settlements.find((x) => x.id === me.homeId)!;
    expect(choiceAvailability(s, b.choices[0]!, home, { you: me.id }).available).toBe(false);
  });

  it("an approved proposal that can no longer be paid for does nothing", () => {
    let s = played(createWorld({ seed: 114 }), "e", "Engineer");
    playerCharacter(s, "e")!.attributes!.survival = 0;
    s.settlements[0]!.facilities = { well: 40 };
    s.settlements[0]!.resources.knowledge = 1000;
    const d = proposing("x-fix", "domain", [{ type: "SPEND", costs: { knowledge: 900 } }, { type: "BUILD_FACILITY", facility: "worst", seasons: 1 }], "Engineer");
    s = propose(s, "e", d);
    const p = s.proposals!.at(-1)!;
    expect(p.status).toBe("open");
    s.settlements[0]!.resources.knowledge = 0; // spent elsewhere before the decision
    s.pendingDecisions!.find((x) => x.proposalId === p.id)!.responses = { [p.deciders[0]!]: "approve" };
    const r = step(s, [d, vote]);
    const out = r.state.proposals!.find((x) => x.id === p.id)!;
    expect(out.status).toBe("failed");
    expect(r.state.settlements[0]!.building?.well).toBeUndefined();
  });

  it("the profession events propose instead of changing shared state directly", () => {
    const shared = ["SET_FARM_PLAN", "PRIORITIZE_BRANCH", "CLAIM_SITE", "ENACT_LAW"];
    for (const id of ["farmer-crop-plan", "scientist-priorities", "medic-allocation", "scout-outpost", "engineer-repair-or-strip"]) {
      const d = events.find((e) => e.id === id)!;
      for (const c of d.choices) expect(c.effects.some((e) => shared.includes(e.type)), `${id}.${c.id}`).toBe(false);
    }
  });
});

describe("materials come from somewhere", () => {
  it("salvage gives materials; timber and ore go to the store and are not materials yet", () => {
    const s = createWorld({ seed: 115 });
    const h = s.settlements[0]!;
    const loc = s.locations.find((l) => l.id === h.locationId)!;
    loc.salvage = 0; loc.timber = 10; loc.ore = 100;
    h.facilities = { lumber_camp: 100, mine: 100 };
    h.goods = { parts: 10 };
    const ctx = new TickContext(s, new Rng(1));
    expect(materialsFrom(ctx, h, loc, 40)).toBe(0); // no salvage left, so no materials directly
    expect(h.goods.timber).toBe(10);
    expect(loc.timber).toBe(0);
    expect(h.goods.ore).toBe(20);
    expect(loc.ore).toBe(80);
  });

  it("with nothing left to dig or cut, work makes no materials", () => {
    const s = createWorld({ seed: 116 });
    const h = s.settlements[0]!;
    const loc = s.locations.find((l) => l.id === h.locationId)!;
    loc.salvage = 0; loc.timber = 0; loc.ore = 0;
    expect(materialsFrom(new TickContext(s, new Rng(1)), h, loc, 100)).toBe(0);
  });

  it("forests grow back; ore does not", () => {
    let s = createWorld({ seed: 117 });
    const g = s.locations.find((l) => l.id === "greenhollow")!;
    g.timber = 0; g.ore = 10;
    for (let i = 0; i < 12; i++) s = step(s, []).state;
    expect(s.locations.find((l) => l.id === "greenhollow")!.timber).toBe(400);
    expect(s.locations.find((l) => l.id === "greenhollow")!.ore).toBe(10);
  });
});

describe("one timeline", () => {
  it("a trip decided between years counts its seasons from the coming spring", () => {
    let s = played(createWorld({ seed: 118 }), "p", "Scout");
    const trip = def({ id: "x-trip", scope: "settlement", maxOccurrences: 1, roles: [{ id: "you", player: true }], preconditions: [{ type: "settlement_kind", kind: "bunker" }],
      choices: [{ id: "go", label: "Go", effects: [{ type: "AFTER", seasons: 4, away: ["you"], title: "Back", text: "Back", effects: [{ type: "ADJUST_RESOURCE", resource: "knowledge", amount: 5 }] }] }] });
    const me = playerCharacter(s, "p")!;
    s.pendingDecisions = [{ id: "x1", definitionId: "x-trip", definitionVersion: 1, settlementId: me.homeId, roles: { you: me.id }, participants: [me.id], firedTick: s.tick, resolveTick: s.tick + 1, responses: {} }];
    s = applyImmediate(s, { type: "CHOOSE", playerId: "p", decisionId: "x1", choiceId: "go" }, [trip]).state;
    expect(s.scheduled![0]!.dueSeason).toBe((s.tick + 1) * 4 + 4);
    let r = step(s, [trip]);
    expect(r.events.some((e) => e.title === "Back")).toBe(false); // the coming year is the trip
    r = step(r.state, [trip]);
    expect(r.events.filter((e) => e.title === "Back")).toHaveLength(1);
  });

  it("nobody can go on two trips at once", () => {
    const s = createWorld({ seed: 119 });
    const c = s.characters.find((x) => x.deathTick === null && s.tick - x.birthTick > 20)!;
    c.awayUntil = s.tick * 4 + 6;
    const choice = { id: "go", label: "Go", tags: [], requires: [], requiresRoles: [], effects: [{ type: "AFTER" as const, seasons: 1, away: ["walker"], title: "t", text: "t", effects: [] }] };
    expect(choiceAvailability(s, choice, s.settlements[0]!, { walker: c.id }).available).toBe(false);
  });

  it("the same seed and actions give the same world, season by season", () => {
    const run = () => { let w = played(createWorld({ seed: 120 }), "p", "Farmer"); for (let i = 0; i < 20; i++) w = stepWorld(w, { events, actions: [] }).state; return hashState(w); };
    expect(run()).toBe(run());
  });
});

describe("infrastructure holds up", () => {
  it("a generator gives no power at night once its water mill stops", () => {
    const s = createWorld({ seed: 121 });
    const h = s.settlements[0]!;
    h.facilities = { generator: 100, watermill: 100 };
    expect(powerLevel(s, h)).toBe(1);
    h.facilities = { generator: 100, watermill: 10 };
    expect(powerLevel(s, h)).toBe(0);
  });

  it("an expansion is not started without food to feed the new people", () => {
    const s = createWorld({ seed: 122 });
    const h = s.settlements[0]!;
    h.resources.materials = 500; h.resources.food = 10; h.capacity = 120;
    expect(step(s, []).state.settlements[0]!.expanding).toBeUndefined();
  });
});
