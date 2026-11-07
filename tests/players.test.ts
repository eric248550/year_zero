import { describe, expect, it } from "vitest";
import { Rng, type EventDefinition, type WorldState } from "@genesis/schemas";
import { characterAge, getCharacter, relationshipKey, residents } from "@genesis/narrative";
import {
  TickContext,
  applyImmediate,
  availableOrigins,
  checkInvariants,
  createWorld,
  hashState,
  playerCharacter,
  playerUpkeep,
  stepWorld,
  successionCandidates,
} from "@genesis/simulation";
import { def, seedContent } from "./helpers";

function step(state: WorldState, actions: unknown[] = [], events: readonly EventDefinition[] = []) {
  const r = stepWorld(state, { events, actions });
  expect(r.rejectedActions).toEqual([]);
  expect(checkInvariants(r.state, r.events)).toEqual([]);
  return r;
}

const join = (playerId: string, extra: Record<string, unknown> = {}) => ({ type: "JOIN_WORLD", playerId, playerName: playerId, ...extra });

/** An event the whole settlement answers individually. */
const neighbourCall = def({
  id: "neighbour-call",
  participation: "everyone",
  maxOccurrences: 1,
  narrative: { headline: "A call from the next village", text: "Smoke rises from the next valley." },
  choices: [
    { id: "go", label: "Go and look", tags: ["bold"], memberEffects: [{ type: "ADD_LIFE_EVENT", role: "actor", text: "Walked to the next village" }] },
    { id: "stay", label: "Stay home", tags: ["cautious"], memberEffects: [{ type: "ADD_LIFE_EVENT", role: "actor", text: "Stayed behind" }] },
  ],
});

describe("joining a world", () => {
  it("in year zero only Haven Deep is open; other origins unlock as the world develops", () => {
    const w = createWorld({ seed: 1 });
    const open = availableOrigins(w).filter((o) => o.available).map((o) => o.id);
    expect(open).toEqual(["haven_deep"]);

    const later = structuredClone(w);
    later.tick = 12;
    later.settlements.push({ ...structuredClone(w.settlements[0]!), id: "s-001", name: "Ashford Crossing", kind: "settlement", locationId: "ashford_crossing", foundedTick: 5 });
    later.flags["mystery.vault12_opened"] = true;
    expect(availableOrigins(later).every((o) => o.available)).toBe(true);
    expect(availableOrigins(later).find((o) => o.id === "surface_born")!.settlementIds).toEqual(["s-001"]);
  });

  it("rejects an origin that has not unlocked yet", () => {
    const r = stepWorld(createWorld({ seed: 1 }), { events: [], actions: [join("p1", { origin: "wanderer" })] });
    expect(r.rejectedActions[0]?.reason).toMatch(/Wanderers start arriving/);
  });

  it("a player can take over a free founder, or arrive as a new resident; the world is not capped at 20", () => {
    const w = createWorld({ seed: 2 });
    const founder = w.characters.find((c) => characterAge(w, c) >= 18)!;
    const r = step(w, [join("p1", { characterId: founder.id }), join("p2", { givenName: "Mei", profession: "Medic" })]);
    expect(playerCharacter(r.state, "p1")?.id).toBe(founder.id);
    const mine = playerCharacter(r.state, "p2")!;
    expect(mine.givenName).toBe("Mei");
    expect(mine.profession).toBe("Medic");
    expect(mine.homeId).toBe("s-haven");
    expect(r.state.characters.length).toBeGreaterThan(w.characters.length);

    const taken = stepWorld(r.state, { events: [], actions: [join("p3", { characterId: founder.id })] });
    expect(taken.rejectedActions[0]?.reason).toMatch(/not available/);
  });

  it("worlds without players keep their exact previous shape", () => {
    const a = createWorld({ seed: 9 });
    let s = a;
    for (let i = 0; i < 15; i++) s = stepWorld(s, { events: seedContent.events }).state;
    expect(s.players).toBeUndefined();
    expect(s.pendingDecisions).toBeUndefined();
    expect(s.invites).toBeUndefined();
  });
});

describe("everyone decides for themselves", () => {
  it("players split between going and staying; each gets their own outcome", () => {
    let s = step(createWorld({ seed: 3 }), [join("a"), join("b")], [neighbourCall]).state;
    const pending = s.pendingDecisions!;
    expect(pending).toHaveLength(1);
    const a = playerCharacter(s, "a")!;
    const b = playerCharacter(s, "b")!;
    expect(pending[0]!.participants).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(pending[0]!.participants.length).toBe(residents(s, "s-haven").filter((c) => characterAge(s, c) >= 12).length);

    const r = step(s, [
      { type: "CHOOSE", playerId: "a", decisionId: pending[0]!.id, choiceId: "go" },
      { type: "CHOOSE", playerId: "b", decisionId: pending[0]!.id, choiceId: "stay" },
    ], [neighbourCall]);
    s = r.state;
    expect(s.pendingDecisions).toEqual([]);
    expect(getCharacter(s, a.id)!.lifeEvents.map((e) => e.text)).toContain("Walked to the next village");
    expect(getCharacter(s, b.id)!.lifeEvents.map((e) => e.text)).toContain("Stayed behind");
    const groups = r.events.filter((e) => e.parentId === pending[0]!.id && e.definitionId === "neighbour-call");
    expect(groups.find((e) => e.choice?.id === "go")!.characterIds).toContain(a.id);
    expect(groups.find((e) => e.choice?.id === "stay")!.characterIds).toContain(b.id);
  });

  it("a player who does not answer is decided for by autopilot, in character", () => {
    const s = step(createWorld({ seed: 4 }), [join("a")], [neighbourCall]).state;
    const r = step(s, [], [neighbourCall]);
    const mine = r.events.find((e) => e.characterIds.includes(playerCharacter(s, "a")!.id) && e.choice);
    expect(mine?.choice?.decidedBy).toMatch(/autopilot×1/);
  });

  it("role events wait for the player holding the role; NPC-only events still resolve at once", () => {
    const w = createWorld({ seed: 5 });
    for (const c of w.characters) c.profession = "Engineer";
    const medic = w.characters.find((c) => characterAge(w, c) >= 18)!;
    medic.profession = "Medic";
    const triage = def({
      id: "triage",
      maxOccurrences: 1,
      roles: [{ id: "doctor", profession: "Medic" }],
      choices: [
        { id: "save", label: "Save the child", tags: ["community"], memberEffects: [{ type: "ADD_LIFE_EVENT", role: "actor", text: "Saved a child" }] },
        { id: "rest", label: "Rest", tags: ["cautious"] },
      ],
    });
    // NPC medic: resolved in the same tick by the council, as before.
    const npc = step(w, [], [triage]);
    expect(npc.state.pendingDecisions).toBeUndefined();
    expect(npc.events.find((e) => e.definitionId === "triage")?.choice).not.toBeNull();

    // Player medic: decision waits for them.
    const opened = step(w, [join("doc", { characterId: medic.id })], [triage]);
    const d = opened.state.pendingDecisions![0]!;
    expect(d.participants).toEqual([medic.id]);
    const done = step(opened.state, [{ type: "CHOOSE", playerId: "doc", decisionId: d.id, choiceId: "save" }], [triage]);
    expect(getCharacter(done.state, medic.id)!.lifeEvents.some((e) => /Save the child/.test(e.text))).toBe(true);
    expect(getCharacter(done.state, medic.id)!.lifeEvents.map((e) => e.text)).toContain("Saved a child");
  });

  it("group size spreads the risk of a dangerous choice", () => {
    const risky = def({
      id: "risky",
      participation: "everyone",
      maxOccurrences: 1,
      choices: [{ id: "go", label: "Go", tags: ["bold"], risk: { chance: 0.8, description: "{{actor}} was hurt.", effects: [{ type: "ADD_LIFE_EVENT", role: "actor", text: "Hurt" }] } }],
    });
    const s = step(createWorld({ seed: 6 }), [join("a")], [risky]).state;
    const r = step(s, [], [risky]);
    const ev = r.events.find((e) => e.choice?.id === "go")!;
    expect(ev.choice!.risk!.chance).toBeCloseTo(0.8 / Math.sqrt(ev.characterIds.length), 2);
  });

  it("the council never relocates a player's character", () => {
    const w = createWorld({ seed: 7 });
    const adults = residents(w, "s-haven").filter((c) => characterAge(w, c) >= 18).slice(0, 6);
    const s = step(w, adults.map((c, i) => join(`p${i}`, { characterId: c.id }))).state;
    let cur = s;
    for (let i = 0; i < 40; i++) cur = stepWorld(cur, { events: seedContent.events }).state;
    for (const p of Object.values(cur.players!)) {
      const first = getCharacter(cur, p.lineage[0]!)!;
      if (first.deathTick === null) expect(first.homeId).toBe("s-haven");
    }
  });
});

describe("death and succession", () => {
  function worldWithFamily() {
    const w = createWorld({ seed: 8 });
    const parent = w.characters.find((c) => characterAge(w, c) >= 30)!;
    const [kid, ward, friend, stranger] = w.characters.filter((c) => c.id !== parent.id && !c.parentIds.includes(parent.id)).slice(0, 4);
    kid!.parentIds = [parent.id];
    ward!.caretakerIds = [parent.id];
    w.relationships[relationshipKey(parent.id, friend!.id)] = 70;
    return { w, parent, kid: kid!, ward: ward!, friend: friend!, stranger: stranger! };
  }

  it("when a character dies the player may continue as a child, ward or close companion — never a stranger", () => {
    const { w, parent, kid, ward, friend, stranger } = worldWithFamily();
    let s = step(w, [join("p", { characterId: parent.id })]).state;
    getCharacter(s, parent.id)!.deathTick = s.tick;
    getCharacter(s, parent.id)!.causeOfDeath = "test";
    s = step(s).state;
    expect(s.players!.p!.status).toBe("awaiting_succession");
    const ids = successionCandidates(s, "p").map((c) => c.characterId);
    expect(ids).toEqual(expect.arrayContaining([kid.id, ward.id, friend.id]));
    expect(ids).not.toContain(stranger.id);

    const bad = stepWorld(s, { events: [], actions: [{ type: "CONTINUE_AS", playerId: "p", mode: "character", characterId: stranger.id }] });
    expect(bad.rejectedActions).toHaveLength(1);
    const r = step(s, [{ type: "CONTINUE_AS", playerId: "p", mode: "character", characterId: ward.id }]);
    expect(playerCharacter(r.state, "p")?.id).toBe(ward.id);
    expect(r.state.players!.p!.lineage).toEqual([parent.id, ward.id]);
  });

  it("a child someone else already plays cannot be chosen", () => {
    const { w, parent, kid } = worldWithFamily();
    let s = step(w, [join("p", { characterId: parent.id }), join("q", { characterId: kid.id })]).state;
    getCharacter(s, parent.id)!.deathTick = s.tick;
    getCharacter(s, parent.id)!.causeOfDeath = "test";
    s = step(s).state;
    expect(successionCandidates(s, "p").map((c) => c.characterId)).not.toContain(kid.id);
  });

  it("random rebirth puts the player into a free child somewhere in the world", () => {
    const { w, parent } = worldWithFamily();
    let s = step(w, [join("p", { characterId: parent.id })]).state;
    getCharacter(s, parent.id)!.deathTick = s.tick;
    getCharacter(s, parent.id)!.causeOfDeath = "test";
    s = step(s).state;
    const r = step(s, [{ type: "CONTINUE_AS", playerId: "p", mode: "random" }]);
    const reborn = playerCharacter(r.state, "p")!;
    expect(reborn.id).not.toBe(parent.id);
    expect(characterAge(r.state, reborn)).toBeLessThanOrEqual(15);
  });

  it("caring for someone makes them a succession candidate", () => {
    const w = createWorld({ seed: 10 });
    const [me, orphan] = w.characters.filter((c) => characterAge(w, c) >= 20 && characterAge(w, c) <= 45);
    const s = step(w, [join("p", { characterId: me!.id })]).state;
    const r = step(s, [{ type: "CARE_FOR", playerId: "p", characterId: orphan!.id }]);
    expect(getCharacter(r.state, orphan!.id)!.caretakerIds).toEqual([me!.id]);
    getCharacter(r.state, me!.id)!.deathTick = r.state.tick;
    getCharacter(r.state, me!.id)!.causeOfDeath = "test";
    const after = step(r.state).state;
    expect(successionCandidates(after, "p").find((c) => c.characterId === orphan!.id)?.kind).toBe("ward");
  });
});

describe("inviting friends", () => {
  it("a friend can join as your ward through an invite code", () => {
    const w = createWorld({ seed: 11 });
    const [me, ward] = w.characters.filter((c) => characterAge(w, c) >= 20 && characterAge(w, c) <= 45);
    let s = step(w, [join("p", { characterId: me!.id })]).state;
    s = step(s, [{ type: "CARE_FOR", playerId: "p", characterId: ward!.id }]).state;
    s = step(s, [{ type: "INVITE", playerId: "p", code: "WARD-01", characterId: ward!.id }]).state;
    // Reserved: nobody else can take the invited character meanwhile.
    expect(s.invites!["WARD-01"]!.kind).toBe("ward");
    s = step(s, [join("friend", { inviteCode: "WARD-01" })]).state;
    expect(playerCharacter(s, "friend")?.id).toBe(ward!.id);
    expect(s.invites!["WARD-01"]).toBeUndefined();
  });

  it("a friend invited as your next child is born into your family", () => {
    const w = createWorld({ seed: 12 });
    const me = w.characters.find((c) => characterAge(w, c) >= 20 && characterAge(w, c) <= 40)!;
    let s = step(w, [join("p", { characterId: me.id })]).state;
    s = step(s, [{ type: "INVITE", playerId: "p", code: "BABY-01" }]).state;
    s = step(s, [join("friend", { inviteCode: "BABY-01" })]).state;
    expect(s.players!.friend!.status).toBe("awaiting_birth");

    // Simulate a birth to the inviter this tick, then run end-of-tick upkeep.
    const next = structuredClone(s);
    next.tick += 1;
    next.characters.push({
      id: "c9999", givenName: "Baby", familyName: me.familyName, birthTick: next.tick, deathTick: null, causeOfDeath: null,
      profession: null, homeId: me.homeId, parentIds: [me.id], traits: ["curious"], lifeEvents: [],
    });
    const ctx = new TickContext(next, new Rng(1));
    playerUpkeep(ctx);
    expect(playerCharacter(ctx.state, "friend")?.id).toBe("c9999");
    expect(ctx.state.invites!["BABY-01"]).toBeUndefined();
    expect(checkInvariants(ctx.state)).toEqual([]);
  });

  it("unused invites expire", () => {
    const w = createWorld({ seed: 13 });
    const [me, ward] = w.characters.filter((c) => characterAge(w, c) >= 20 && characterAge(w, c) <= 45);
    let s = step(w, [join("p", { characterId: me!.id })]).state;
    s = step(s, [{ type: "CARE_FOR", playerId: "p", characterId: ward!.id }]).state;
    s = step(s, [{ type: "INVITE", playerId: "p", code: "LATE-01", characterId: ward!.id }]).state;
    for (let i = 0; i < 9; i++) s = stepWorld(s, { events: [] }).state;
    expect(s.invites!["LATE-01"]).toBeUndefined();
  });
});

describe("determinism with players", () => {
  it("the same players making the same choices produce the same world", () => {
    const run = () => {
      let s = createWorld({ seed: 21 });
      s = stepWorld(s, { events: seedContent.events, actions: [join("a"), join("b", { profession: "Scout" })] }).state;
      for (let i = 0; i < 30; i++) {
        const actions = (s.pendingDecisions ?? []).flatMap((d) =>
          Object.values(s.players!).filter((p) => p.characterId && d.participants.includes(p.characterId)).map((p) => ({
            type: "CHOOSE", playerId: p.id, decisionId: d.id, choiceId: seedContent.events.find((e) => e.id === d.definitionId)!.choices[0]!.id,
          })),
        );
        const r = stepWorld(s, { events: seedContent.events, actions });
        expect(checkInvariants(r.state, r.events)).toEqual([]);
        s = r.state;
      }
      return hashState(s);
    };
    expect(run()).toBe(run());
  });
});

describe("attributes and bonds", () => {
  it("new worlds give everyone attributes shaped by profession", () => {
    const w = createWorld({ seed: 30 });
    for (const c of w.characters) {
      for (const v of Object.values(c.attributes!)) expect(v).toBeGreaterThanOrEqual(0);
    }
    const scouts = w.characters.filter((c) => c.profession === "Scout");
    const others = w.characters.filter((c) => c.profession === "Scientist");
    const avg = (cs: typeof scouts, k: "survival" | "knowledge") => cs.reduce((s, c) => s + c.attributes![k], 0) / Math.max(1, cs.length);
    if (scouts.length && others.length) expect(avg(scouts, "survival")).toBeGreaterThan(avg(others, "survival"));
  });

  it("an orphan scene lets a player take a child in, which makes them a ward", () => {
    let w = createWorld({ seed: 32 });
    const orphan = w.characters.find((c) => characterAge(w, c) < 14)!;
    for (const pid of orphan.parentIds) { const p = getCharacter(w, pid)!; p.deathTick = 0; p.causeOfDeath = "test"; }
    const adult = w.characters.find((c) => characterAge(w, c) >= 25 && !orphan.parentIds.includes(c.id) && c.homeId === orphan.homeId)!;
    w = applyImmediate(w, join("p", { characterId: adult.id })).state;
    for (const [stepId, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) w = applyImmediate(w, { type: "PROLOGUE", playerId: "p", step: stepId, choiceId }).state;
    const orphanEvent = { ...seedContent.events.find((e) => e.id === "orphan-child")!, chance: 1 };
    let d;
    for (let i = 0; i < 8 && !d; i++) {
      w = step(w, [], [orphanEvent]).state;
      d = w.pendingDecisions?.find((x) => x.definitionId === "orphan-child");
    }
    const child = d!.roles.child!;
    const done = applyImmediate(w, { type: "CHOOSE", playerId: "p", decisionId: d!.id, choiceId: "adopt" }, [orphanEvent]);
    expect(getCharacter(done.state, child)!.caretakerIds).toContain(adult.id);
    expect(done.state.relationships[relationshipKey(adult.id, child)]).toBeGreaterThan(20);
  });

  it("personal scenes only ever fall on players", () => {
    const watch = { ...seedContent.events.find((e) => e.id === "night-watch")!, chance: 1, cooldown: 0 };
    const npcOnly = step(createWorld({ seed: 33 }), [], [watch]);
    expect(npcOnly.events.some((e) => e.definitionId === "night-watch")).toBe(false);
  });
});
