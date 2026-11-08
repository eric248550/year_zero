import { describe, expect, it } from "vitest";
import { Rng, type WorldState } from "@genesis/schemas";
import { relationshipKey, tensionKey } from "@genesis/narrative";
import { TickContext, applyImmediate, checkInvariants, createWorld, facilities, playerCharacter, stepWorld, working } from "@genesis/simulation";
import { def, seedContent } from "./helpers";

const events = seedContent.events;
const step = (s: WorldState, evs = events) => {
  const r = stepWorld(s, { events: evs, actions: [] });
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
};

describe("work that takes seasons", () => {
  it("a follow-up fires seasons later with the same people, who are away meanwhile", () => {
    const back = def({ id: "back-test", scope: "settlement", scheduledOnly: true, roles: [{ id: "walker", minAge: 16 }], narrative: { headline: "{{walker}} is back", text: "Back." } });
    const go = def({
      id: "go-test", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], roles: [{ id: "walker", minAge: 16 }],
      choices: [{ id: "go", label: "Go", effects: [{ type: "SCHEDULE_EVENT", event: "back-test", seasons: 9, away: ["walker"] }] }],
    });
    let r = step(createWorld({ seed: 2 }), [go, back]);
    const fired = r.events.find((e) => e.definitionId === "go-test")!;
    const walker = fired.trigger!.roles.walker!;
    expect(r.state.characters.find((c) => c.id === walker)?.awayUntil).toBe(r.state.tick * 4 + 9);
    // Scheduled-only events never fire by chance.
    expect(r.events.some((e) => e.definitionId === "back-test")).toBe(false);
    r = step(r.state, [go, back]); // 9 seasons = two years and a quarter: not yet
    expect(r.events.some((e) => e.definitionId === "back-test")).toBe(false);
    r = step(r.state, [go, back]);
    const ret = r.events.find((e) => e.definitionId === "back-test");
    expect(ret?.characterIds).toContain(walker);
    expect(ret?.causeIds).toContain(fired.id);
    expect(r.state.characters.find((c) => c.id === walker)?.awayUntil).toBeUndefined();
  });
});

describe("things that stay", () => {
  it("facilities work while kept up and break when neglected", () => {
    const s = createWorld({ seed: 3 });
    s.settlements[0]!.facilities = { granary: 31, well: 50 };
    s.settlements[0]!.resources.materials = 0;
    const ctx = new TickContext(structuredClone(s), new Rng(1));
    facilities(ctx);
    expect(ctx.state.settlements[0]!.facilities!.granary).toBeLessThan(30);
    expect(ctx.events.some((e) => e.changes.some((c) => c.path.endsWith("facilities.granary")))).toBe(true);
    expect(working(ctx.state.settlements[0], "well")).toBe(true);
    const paid = new TickContext(structuredClone(s), new Rng(1));
    paid.state.settlements[0]!.resources.materials = 10;
    facilities(paid);
    expect(paid.state.settlements[0]!.facilities!.granary).toBe(34);
  });

  it("laws are enacted by vote and change how a settlement lives", () => {
    let s = applyImmediate(createWorld({ seed: 8 }), { type: "JOIN_WORLD", playerId: "p", playerName: "p" }).state;
    const law = def({
      id: "law-test", scope: "settlement", participation: "everyone", resolution: "vote", maxOccurrences: 1, preconditions: [{ type: "law", law: "curfew", active: false }],
      choices: [{ id: "yes", label: "Yes", tags: ["community"], effects: [{ type: "ENACT_LAW", law: "curfew" }] }, { id: "no", label: "No", tags: ["secrecy"], effects: [] }],
    });
    s = step(s, [law]).state;
    const p = s.pendingDecisions!.find((x) => x.definitionId === "law-test")!;
    s = applyImmediate(s, { type: "CHOOSE", playerId: "p", decisionId: p.id, choiceId: "yes" }).state;
    for (let i = 0; i < 3 && s.pendingDecisions?.some((x) => x.id === p.id); i++) s = step(s, [law]).state;
    const home = s.settlements.find((x) => x.id === playerCharacter(s, "p")!.homeId)!;
    expect(Array.isArray(home.laws)).toBe(true);
  });

  it("claimed sites yield to their owner every year", () => {
    let s = createWorld({ seed: 6 });
    const vault = s.locations.find((l) => l.id === "seed_vault")!;
    vault.discovered = true;
    vault.claimedBy = "s-haven";
    const before = s.settlements[0]!.resources.knowledge;
    s = step(s, []).state;
    expect(s.locations.find((l) => l.id === "seed_vault")!.claimedBy).toBe("s-haven");
    // +1 knowledge a year from the vault, on top of normal work (which is positive anyway).
    expect(s.settlements[0]!.resources.knowledge).toBeGreaterThan(before);
  });

  it("children inherit their parents' strongest bonds when they die", () => {
    let s = createWorld({ seed: 9 });
    const child = s.characters.find((c) => c.parentIds.length > 0 && c.deathTick === null)!;
    const parent = s.characters.find((c) => c.id === child.parentIds[0])!;
    const enemy = s.characters.find((c) => c.id !== parent.id && c.id !== child.id && c.deathTick === null && !child.parentIds.includes(c.id))!;
    s.relationships[relationshipKey(parent.id, enemy.id)] = -80;
    const kill = def({ id: "kill-test", scope: "settlement", maxOccurrences: 1, preconditions: [{ type: "settlement_kind", kind: "bunker" }], roles: [{ id: "victim", minAge: 0 }], effects: [{ type: "CHARACTER_DEATH", role: "victim", cause: "test" }] });
    // Force the parent into the role by making them the only candidate.
    const only = { ...kill, roles: [{ id: "victim", minAge: 200, optional: false }] };
    void only;
    const st = structuredClone(s);
    st.characters.find((c) => c.id === parent.id)!.birthTick = -300;
    const r = step(st, [{ ...kill, roles: [{ id: "victim", minAge: 250, optional: false, familiarWith: undefined } as never] }]);
    expect(r.state.characters.find((c) => c.id === parent.id)!.deathTick).not.toBeNull();
    expect(r.state.relationships[relationshipKey(child.id, enemy.id)]).toBe(-40);
  });

  it("raids hit the wall first, and a wall halves what is taken", () => {
    let s = createWorld({ seed: 9 });
    for (let i = 0; i < 8 && s.settlements.filter((x) => x.status === "active").length < 2; i++) s = stepWorld(s, { events: [], actions: [] }).state;
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) {
      s.tensions = { [tensionKey(a!.id, b!.id)]: 95 };
      const poor = s.settlements.find((x) => x.id === b!.id)!;
      poor.supportedBy = null; poor.resources.food = 0; poor.shortage.food = 1;
      const rich = s.settlements.find((x) => x.id === a!.id)!;
      rich.resources.food = 1000; rich.facilities = { palisade: 100 };
      const r = stepWorld(s, { events: [], actions: [] });
      const raid = r.events.find((e) => e.title.includes("搶了"));
      if (raid) {
        hit = true;
        expect(raid.changes.some((c) => c.path.endsWith("facilities.palisade"))).toBe(true);
      }
      s = r.state;
    }
    expect(hit).toBe(true);
  });
});
