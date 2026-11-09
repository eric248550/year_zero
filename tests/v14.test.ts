import { describe, expect, it } from "vitest";
import { INFRASTRUCTURE, MAJOR_WORKS, Rng, TECHNOLOGIES, TECH_IDS, type FacilityId, type WorldState } from "@genesis/schemas";
import { applyImmediate, checkInvariants, civilization, createWorld, hashState, infrastructure, leadership, milestoneBlockers, nextPlanStep, playerCharacter, stepWorld, TickContext, goalPlans } from "@genesis/simulation";
import { seedContent } from "./helpers";

const events = seedContent.events;
const vote = events.find((e) => e.id === "proposal-vote")!;
const light = (s: WorldState) => civilization(s).stages.find((x) => x.id === "renewal")!.milestones.find((m) => m.id === "light")!.done;
const grid = (s: WorldState) => civilization(s).stages.find((x) => x.id === "renewal")!.milestones.find((m) => m.id === "grid")!.done;
const allTech = (s: WorldState) => { s.technologies = [...TECH_IDS]; return s; };

/** A settlement that knows everything and can afford anything, with someone able to lead it. */
function ready(seed: number): WorldState {
  const s = allTech(createWorld({ seed }));
  const h = s.settlements[0]!;
  Object.assign(h.resources, { materials: 900, food: 900, water: 900, knowledge: 900 });
  h.goods = { parts: 200, metal: 50, timber: 50 };
  h.morale = 80; h.priority = "knowledge";
  const eng = s.characters.filter((c) => c.deathTick === null && c.profession === "Engineer");
  for (const c of eng) c.attributes!.knowledge = 80;
  return s;
}
const lead = (s: WorldState, seed = 1) => { const ctx = new TickContext(s, new Rng(seed)); ctx.inTick = true; leadership(ctx); return ctx.state; };
const leadUntilProposal = (s: WorldState) => { for (let i = 1; i <= 40 && !(s.proposals ?? []).some((p) => p.status === "open"); i++) s = lead(s, i); return s; };

describe("NPC leaders plan major works", () => {
  it("propose late-game infrastructure when its prerequisites are met", () => {
    const s = leadUntilProposal(ready(401));
    const p = s.proposals!.find((x) => x.status === "open" && x.key.startsWith("facility:"))!;
    expect(MAJOR_WORKS).toContain(p.key.split(":")[1] as FacilityId);
    expect(p.kind).toBe("settlement");
    expect(p.deciders.length).toBeGreaterThan(0);
  });

  it("cannot bypass the vote: nothing is built or paid for by proposing", () => {
    const s = leadUntilProposal(ready(402));
    const h = s.settlements[0]!;
    expect(h.resources.materials).toBe(900);
    expect(Object.keys(h.building ?? {})).toHaveLength(0);
    expect(MAJOR_WORKS.every((f) => (h.facilities?.[f] ?? 0) === 0)).toBe(true);
  });

  it("a rejected proposal builds nothing and is not put forward again straight away", () => {
    let s = leadUntilProposal(ready(403));
    const p = s.proposals!.find((x) => x.status === "open")!;
    const d = s.pendingDecisions!.find((x) => x.proposalId === p.id)!;
    d.responses = Object.fromEntries(d.participants.map((id) => [id, "reject"]));
    s = stepWorld(s, { events: [vote], actions: [] }).state;
    const f = p.key.split(":")[1] as FacilityId;
    expect(s.proposals!.find((x) => x.id === p.id)!.status).toBe("rejected");
    expect(s.settlements[0]!.facilities?.[f]).toBeUndefined();
    expect(s.settlements[0]!.building?.[f]).toBeUndefined();
    for (let i = 1; i < 12; i++) s = lead(s, 500 + i);
    expect(s.proposals!.filter((x) => x.status === "open" && x.key === p.key)).toHaveLength(0);
  });

  it("wait while they cannot afford it, are hungry, or have chosen not to build", () => {
    const cases: ((s: WorldState) => void)[] = [
      (s) => { s.settlements[0]!.resources.materials = 30; },
      (s) => { s.settlements[0]!.goods = { parts: 1 }; },
      (s) => { s.settlements[0]!.shortage.food = 1; },
      (s) => { s.settlements[0]!.priority = "hoard"; },
      (s) => { for (const c of s.characters) if (c.profession === "Engineer") c.attributes!.knowledge = 20; },
    ];
    for (const [i, change] of cases.entries()) {
      let s = ready(410 + i);
      change(s);
      for (let y = 1; y < 15; y++) s = lead(s, y);
      expect((s.proposals ?? []).filter((p) => p.key.startsWith("facility:")), String(i)).toHaveLength(0);
    }
  });

  it("an approved work that can no longer be paid for fails, and nothing of it happens", () => {
    let s = leadUntilProposal(ready(420));
    const p = s.proposals!.find((x) => x.status === "open")!;
    const d = s.pendingDecisions!.find((x) => x.proposalId === p.id)!;
    d.responses = Object.fromEntries(d.participants.map((id) => [id, "approve"]));
    s.settlements[0]!.resources.materials = 5;
    s = stepWorld(s, { events: [vote], actions: [] }).state;
    const f = p.key.split(":")[1] as FacilityId;
    expect(s.proposals!.find((x) => x.id === p.id)!.status).toBe("failed");
    expect(s.settlements[0]!.building?.[f]).toBeUndefined();
  });

  it("run a work only once: no second proposal while one waits, one payment when it passes", () => {
    let s = leadUntilProposal(ready(430));
    const p = s.proposals!.find((x) => x.status === "open")!;
    for (let y = 1; y < 10; y++) s = lead(s, 800 + y);
    expect(s.proposals!.filter((x) => x.status === "open" && x.key === p.key)).toHaveLength(1);
    const d = s.pendingDecisions!.find((x) => x.proposalId === p.id)!;
    d.responses = Object.fromEntries(d.participants.map((id) => [id, "approve"]));
    const f = p.key.split(":")[1] as FacilityId;
    const out = stepWorld(s, { events: [vote], actions: [] });
    expect(out.state.proposals!.find((x) => x.id === p.id)!.status).toBe("executed");
    const site = out.state.settlements[0]!;
    expect(site.building?.[f] !== undefined || (site.facilities?.[f] ?? 0) > 0).toBe(true);
    expect(out.events.flatMap((e) => e.changes).filter((c) => c.path === `settlements.s-haven.building.${f}`)).toHaveLength(1);
    expect(checkInvariants(out.state, out.events)).toEqual([]);
  });

  it("the settlement's own routine never starts a major work", () => {
    const s = ready(440);
    const ctx = new TickContext(s, new Rng(1));
    infrastructure(ctx);
    expect(Object.keys(ctx.state.settlements[0]!.building ?? {}).filter((f) => MAJOR_WORKS.includes(f as FacilityId))).toHaveLength(0);
  });
});

describe("knowing is not having", () => {
  it("complete technology creates no facility and earns no power milestone", () => {
    const s = allTech(createWorld({ seed: 450 }));
    expect(s.settlements[0]!.facilities?.solar_array).toBeUndefined();
    expect(light(s)).toBe(false);
    expect(grid(s)).toBe(false);
  });

  it("every plan names what is missing and follows the world as it changes", () => {
    const s = ready(451);
    const h = s.settlements[0]!;
    const before = goalPlans(s, h)[0]!;
    expect(before.goal).toBe("night_power");
    expect(before.steps.map((x) => x.id)).toEqual(expect.arrayContaining(["facility:solar_array", "facility:battery_bank", "people:engineer", "decision:proposal"]));
    h.facilities = { ...h.facilities, solar_array: 100 };
    expect(nextPlanStep(s, h)).toBe("battery_bank");
    h.resources.materials = 3;
    const step = goalPlans(s, h)[0]!.steps.find((x) => x.id === "facility:battery_bank")!;
    expect(step.status).toBe("blocked");
    expect(step.detail).toBeTruthy();
  });

  it("the technology tree has no circular or unknown prerequisites, and no facility waits on itself", () => {
    const known = new Set<string>();
    let moved = true;
    while (moved) { moved = false; for (const t of TECHNOLOGIES) if (!known.has(t.id) && t.prerequisites.every((p) => known.has(p))) { known.add(t.id); moved = true; } }
    expect(known.size).toBe(TECHNOLOGIES.length);
    for (const [f, i] of Object.entries(INFRASTRUCTURE)) { expect(TECH_IDS).toContain(i!.tech); expect(i!.after).not.toBe(f); }
  });

  it("every open milestone in a new world says what it needs", () => {
    const s = createWorld({ seed: 452 });
    const list = milestoneBlockers(s, s.settlements[0]!);
    expect(list.length).toBeGreaterThan(0);
    for (const b of list) expect(b.steps.length, b.milestone).toBeGreaterThan(0);
  });
});

describe("equivalent ways of having the same thing", () => {
  const riverSite = (s: WorldState) => { const h = s.settlements[0]!; const a = s.locations.find((l) => l.id === "ashford_crossing")!; h.locationId = a.id; return h; };
  it("sun and batteries light the night", () => { const s = allTech(createWorld({ seed: 460 })); s.settlements[0]!.facilities = { solar_array: 100, battery_bank: 100 }; expect(light(s)).toBe(true); });
  it("a generator on a water mill lights the night", () => { const s = allTech(createWorld({ seed: 461 })); riverSite(s).facilities = { watermill: 100, generator: 100 }; expect(light(s)).toBe(true); });
  it("sun alone does not, and a generator without its mill does not", () => {
    const a = allTech(createWorld({ seed: 462 })); a.settlements[0]!.facilities = { solar_array: 100 }; expect(light(a)).toBe(false);
    const b = allTech(createWorld({ seed: 463 })); b.settlements[0]!.facilities = { generator: 100 }; expect(light(b)).toBe(false);
  });
  it("a river settlement is offered the cheaper water route; a dry one is not", () => {
    const wet = allTech(createWorld({ seed: 464 })); expect(goalPlans(wet, riverSite(wet))[0]!.route).toBe("water");
    const dry = allTech(createWorld({ seed: 465 })); expect(goalPlans(dry, dry.settlements[0]!)[0]!.route).toBe("solar");
  });
  it("a live line between two settlements counts as a grid; a line with no source does not", () => {
    let s = allTech(createWorld({ seed: 466 }));
    for (let i = 0; i < 8 && s.settlements.filter((x) => x.status === "active").length < 2; i++) { s = stepWorld(s, { events: [], actions: [] }).state; s.technologies = [...TECH_IDS]; }
    const [a, b] = s.settlements.filter((x) => x.status === "active") as [WorldState["settlements"][number], WorldState["settlements"][number]];
    a.facilities = { power_lines: 100 }; b.facilities = { power_lines: 100 };
    expect(grid(s)).toBe(false);
    a.facilities = { power_lines: 100, solar_array: 100 };
    expect(grid(s)).toBe(true);
  });
  it("a governing charter stands in for a vote that never came", () => {
    const s = createWorld({ seed: 467 });
    const assembly = () => civilization(s).stages.find((x) => x.id === "order")!.milestones.find((m) => m.id === "assembly")!.done;
    expect(assembly()).toBe(false);
    s.technologies.push("civic_charter");
    expect(assembly()).toBe(true);
  });
});

describe("players steer", () => {
  const withHead = (seed: number) => {
    let s = applyImmediate(ready(seed), { type: "JOIN_WORLD", playerId: "p", playerName: "p", profession: "Engineer" }).state;
    for (const [st, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId: "p", step: st, choiceId }).state;
    s.pendingDecisions = [];
    const me = playerCharacter(s, "p")!;
    me.attributes!.survival = 100;
    return s;
  };
  it("a player in charge can build what NPC leaders would still be saving up for, paying the real cost", () => {
    const s = withHead(470);
    const h = s.settlements[0]!;
    h.resources.materials = INFRASTRUCTURE.solar_array!.materials + 2; // less than any reserve
    expect(nextPlanStep(s, h)).toBe("solar_array");
    const r = applyImmediate(s, { type: "START_WORK", playerId: "p", action: "eng_build", target: "solar_array" });
    expect(r.rejected).toBeNull();
    expect(r.state.settlements[0]!.resources.materials).toBe(2);
    expect(r.state.settlements[0]!.building?.solar_array).toBeDefined();
  });
  it("a player cannot spend what is not there", () => {
    const s = withHead(471);
    s.settlements[0]!.resources.materials = 2;
    expect(applyImmediate(s, { type: "START_WORK", playerId: "p", action: "eng_build", target: "solar_array" }).rejected).toBeTruthy();
  });
  it("a settlement's chosen direction changes what it makes and what it keeps", () => {
    const run = (priority: "food" | "industry") => { let s = createWorld({ seed: 472 }); s = stepWorld(s, { events: [], actions: [{ type: "SET_PRIORITY", settlementId: "s-haven", priority }] }).state; for (let i = 0; i < 30; i++) s = stepWorld(s, { events: [], actions: [] }).state; return s; };
    expect(hashState(run("food"))).not.toBe(hashState(run("industry")));
    const food = run("food"), industry = run("industry");
    expect(food.settlements[0]!.resources.food).toBeGreaterThan(industry.settlements[0]!.resources.food);
  });
});

describe("the world still runs as one", () => {
  it("the same seed and the same actions give the same world, with NPC proposals in it", () => {
    const run = () => { let s = createWorld({ seed: 480 }); const seen: string[] = []; for (let i = 0; i < 70; i++) { const r = stepWorld(s, { events, actions: [] }); s = r.state; seen.push(...r.events.map((e) => e.id)); } return `${hashState(s)}|${seen.length}`; };
    expect(run()).toBe(run());
  }, 60000);
  it("farming, manufacturing, trades and events all still happen over a long run", () => {
    let s = applyImmediate(createWorld({ seed: 481 }), { type: "JOIN_WORLD", playerId: "p", playerName: "p", profession: "Engineer" }).state;
    let story = 0;
    for (let i = 0; i < 120; i++) { const r = stepWorld(s, { events, actions: [] }); s = r.state; story += r.events.filter((e) => e.kind === "narrative").length; expect(checkInvariants(r.state, r.events)).toEqual([]); }
    expect(story).toBeGreaterThan(5);
    expect(s.settlements.some((x) => (x.farm?.harvests ?? 0) > 0)).toBe(true);
    expect((s.stats.made?.parts ?? 0)).toBeGreaterThan(0);
  }, 120000);
});
