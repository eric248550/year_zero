import { describe, expect, it } from "vitest";
import type { WorldState } from "@genesis/schemas";
import { getCharacter, isPersonalEvent } from "@genesis/narrative";
import { applyImmediate, checkInvariants, createWorld, hashState, playerCharacter, stepWorld } from "@genesis/simulation";
import { seedContent } from "./helpers";

const events = seedContent.events;

/** Join and finish the prologue, the way the app does on day one. */
function played(state: WorldState, playerId: string): WorldState {
  let s = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId }).state;
  for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) {
    const r = applyImmediate(s, { type: "PROLOGUE", playerId, step, choiceId });
    expect(r.rejected).toBeNull();
    s = r.state;
  }
  return s;
}

function run(state: WorldState, years: number) {
  const fired: { tick: number; id: string; characterIds: string[] }[] = [];
  let s = state;
  for (let i = 0; i < years; i++) {
    const r = stepWorld(s, { events, actions: [] });
    expect(checkInvariants(r.state, r.events)).toEqual([]);
    // Count openings only (the resolution next year shares the definition id).
    for (const e of r.events) if (r.state.pendingDecisions?.some((p) => p.id === e.id) && events.find((d) => d.id === e.definitionId && isPersonalEvent(d))) fired.push({ tick: e.tick, id: e.definitionId!, characterIds: e.characterIds });
    s = r.state;
  }
  return { state: s, fired };
}

describe("personal events", () => {
  it("find each player on their own, about once a year", () => {
    const start = played(played(createWorld({ seed: 50 }), "a"), "b");
    const a = playerCharacter(start, "a")!.id;
    const b = playerCharacter(start, "b")!.id;
    const { state, fired } = run(start, 20);
    for (const id of [a, b]) {
      const mine = fired.filter((f) => f.characterIds.includes(id));
      if (getCharacter(state, id)!.deathTick === null) expect(mine.length).toBeGreaterThanOrEqual(12);
      // Per-player cooldowns: the same scene never repeats within its cooldown.
      for (const f of mine) {
        const cd = events.find((d) => d.id === f.id)!.cooldown;
        expect(mine.some((g) => g !== f && g.id === f.id && g.tick > f.tick && g.tick - f.tick < Math.max(1, cd))).toBe(false);
      }
    }
    // Personal events are always about a player.
    expect(fired.every((f) => f.characterIds.includes(a) || f.characterIds.includes(b))).toBe(true);
  });

});

describe("instant decisions", () => {
  function firstPersonal(seed: number) {
    const w = createWorld({ seed });
    let s = played(w, "p");
    for (let i = 0; i < 10; i++) {
      const me = playerCharacter(s, "p")!;
      const d = s.pendingDecisions?.find((x) => x.participants.length === 1 && x.participants[0] === me.id);
      if (d) return { s, d };
      s = stepWorld(s, { events, actions: [] }).state;
    }
    throw new Error("no personal event in 10 years");
  }

  it("a personal event resolves the moment the player chooses", () => {
    const { s, d } = firstPersonal(60);
    const def = events.find((e) => e.id === d.definitionId)!;
    const r = applyImmediate(s, { type: "CHOOSE", playerId: "p", decisionId: d.id, choiceId: def.choices[0]!.id }, events);
    expect(r.rejected).toBeNull();
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events[0]!.choice?.id).toBe(def.choices[0]!.id);
    expect(r.state.pendingDecisions?.some((x) => x.id === d.id)).toBe(false);
    expect(checkInvariants(r.state, r.events)).toEqual([]);
  });

});

describe("shared scenes", () => {
  it("players turn up in each other's scenes, and only the lead decides", () => {
    let s = played(played(played(createWorld({ seed: 70 }), "a"), "b"), "c");
    const ids = ["a", "b", "c"].map((p) => playerCharacter(s, p)!.id);
    let crossed = 0;
    let opened = 0;
    for (let i = 0; i < 20; i++) {
      const r = stepWorld(s, { events, actions: [] });
      expect(checkInvariants(r.state, r.events)).toEqual([]);
      for (const p of r.state.pendingDecisions ?? []) {
        if (p.firedTick !== r.state.tick - 1 && p.firedTick !== r.state.tick) continue;
        const def = events.find((d) => d.id === p.definitionId)!;
        if (!isPersonalEvent(def)) continue;
        opened++;
        const lead = def.roles.find((x) => x.player)!.id;
        expect(p.participants).toEqual([p.roles[lead]]);
        if (Object.entries(p.roles).some(([role, id]) => role !== lead && ids.includes(id))) crossed++;
      }
      s = r.state;
    }
    expect(opened).toBeGreaterThan(30);
    expect(crossed).toBeGreaterThan(3);
  });
});

describe("civilization", () => {
  it("advances through its stages as the world rebuilds", async () => {
    const { civilization } = await import("@genesis/simulation");
    let s = createWorld({ seed: 4 });
    const start = civilization(s);
    expect(start.stage).toBe(0);
    for (let i = 0; i < 60; i++) s = stepWorld(s, { events, actions: [] }).state;
    const later = civilization(s);
    expect(later.done).toBeGreaterThan(start.done);
    expect(later.stage).toBeGreaterThanOrEqual(1);
  });
});
