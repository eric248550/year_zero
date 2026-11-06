import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  advanceClock,
  applyPlayerAction,
  createRun,
  forkRun,
  getRun,
  importSeedContent,
  migrateDb,
  openDb,
  reconstructState,
  stepRun,
  verifyReplay,
  type Db,
} from "@genesis/database";
import { getCharacter, relationshipKey } from "@genesis/narrative";
import { applyImmediate, createWorld, hashState, playerCharacter } from "@genesis/simulation";
import { seedContent } from "./helpers";

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "genesis-play-"));
  db = openDb(join(dir, "test.db"));
  migrateDb(db);
  importSeedContent(db, seedContent);
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const join_ = (playerId: string, extra: Record<string, unknown> = {}) => ({ type: "JOIN_WORLD", playerId, playerName: playerId, ...extra });

describe("immediate player actions", () => {
  it("joining takes effect at once, without advancing time", () => {
    const w = createWorld({ seed: 1 });
    const r = applyImmediate(w, join_("p", { profession: "Scout", trait: "brave", givenName: "Lin" }));
    expect(r.rejected).toBeNull();
    expect(r.state.tick).toBe(0);
    const me = playerCharacter(r.state, "p")!;
    expect(me).toMatchObject({ givenName: "Lin", profession: "Scout", traits: ["brave"] });
    expect(w.players).toBeUndefined(); // input untouched
  });

  it("developer actions cannot be applied immediately", () => {
    const r = applyImmediate(createWorld({ seed: 1 }), { type: "SET_POLICY", policy: "cautious" });
    expect(r.rejected).toMatch(/Only player actions/);
  });

  it("the prologue runs in order and introduces a new person each step", () => {
    let s = applyImmediate(createWorld({ seed: 2 }), join_("p")).state;
    expect(applyImmediate(s, { type: "PROLOGUE", playerId: "p", step: "water", choiceId: "share" }).rejected).toMatch(/first_climb/);
    const a = applyImmediate(s, { type: "PROLOGUE", playerId: "p", step: "first_climb", choiceId: "repair" });
    expect(a.rejected).toBeNull();
    s = a.state;
    const partner = a.events[0]!.characterIds[1]!;
    const b = applyImmediate(s, { type: "PROLOGUE", playerId: "p", step: "water", choiceId: "refuse" });
    s = b.state;
    const asker = b.events[0]!.characterIds[1]!;
    expect(asker).not.toBe(partner);
    const me = playerCharacter(s, "p")!;
    expect(s.relationships[relationshipKey(me.id, partner)]).toBe(20);
    expect(s.relationships[relationshipKey(me.id, asker)]).toBe(-15);
    s = applyImmediate(s, { type: "PROLOGUE", playerId: "p", step: "static", choiceId: "keep" }).state;
    expect(s.players!.p!.prologue).toEqual(["first_climb", "water", "static"]);
    expect(applyImmediate(s, { type: "PROLOGUE", playerId: "p", step: "static", choiceId: "tell" }).rejected).toBeTruthy();
    expect(getCharacter(s, me.id)!.lifeEvents.at(-1)!.text).toMatch(/沒有告訴任何人/);
  });
});

describe("prologue across lives", () => {
  it("a player who continues as someone else does not redo the prologue", () => {
    let s = applyImmediate(createWorld({ seed: 3 }), join_("p")).state;
    for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) {
      s = applyImmediate(s, { type: "PROLOGUE", playerId: "p", step, choiceId }).state;
    }
    const me = playerCharacter(s, "p")!;
    const ward = s.characters.find((c) => c.id !== me.id)!;
    s = applyImmediate(s, { type: "CARE_FOR", playerId: "p", characterId: ward.id }).state;
    getCharacter(s, me.id)!.deathTick = s.tick;
    getCharacter(s, me.id)!.causeOfDeath = "test";
    s.players!.p = { ...s.players!.p!, status: "awaiting_succession", characterId: null };
    const r = applyImmediate(s, { type: "CONTINUE_AS", playerId: "p", mode: "character", characterId: ward.id });
    expect(r.rejected).toBeNull();
    expect(r.state.players!.p!.prologue).toEqual(["first_climb", "water", "static"]);
  });
});

describe("persisted play", () => {
  it("between-tick actions are logged and replay exactly, including the head", () => {
    const run = createRun(db, { name: "play", seed: 77 });
    applyPlayerAction(db, run.id, join_("a"));
    applyPlayerAction(db, run.id, { type: "PROLOGUE", playerId: "a", step: "first_climb", choiceId: "surface" });
    stepRun(db, run.id, 4);
    applyPlayerAction(db, run.id, join_("b", { profession: "Medic" }));
    stepRun(db, run.id, 8);
    applyPlayerAction(db, run.id, { type: "PROLOGUE", playerId: "b", step: "first_climb", choiceId: "repair" });

    const v = verifyReplay(db, run.id);
    expect(v.ok).toBe(true);
    expect(v.checks.at(-1)!.tick).toBe(12);

    const head = getRun(db, run.id).state;
    expect(hashState(reconstructState(db, run.id, 12).state)).toBe(hashState(head));
    expect(reconstructState(db, run.id, 3).state.players?.a).toBeDefined();
    expect(reconstructState(db, run.id, 3).state.players?.b).toBeUndefined();
  });

  it("rejected player actions throw and change nothing", () => {
    const run = createRun(db, { name: "reject", seed: 78 });
    const before = getRun(db, run.id).headHash;
    expect(() => applyPlayerAction(db, run.id, join_("x", { origin: "vault12" }))).toThrow(/Vault 12/);
    expect(getRun(db, run.id).headHash).toBe(before);
  });

  it("forks keep the players who joined before the fork point", () => {
    const run = createRun(db, { name: "fork-src", seed: 79 });
    applyPlayerAction(db, run.id, join_("a"));
    stepRun(db, run.id, 5);
    applyPlayerAction(db, run.id, join_("late"));
    stepRun(db, run.id, 5);
    const fork = forkRun(db, run.id, 5);
    const state = getRun(db, fork.id).state;
    expect(state.players?.a).toBeDefined();
    expect(state.players?.late).toBeUndefined();
    stepRun(db, fork.id, 3);
    expect(verifyReplay(db, fork.id).ok).toBe(true);
  });
});

describe("real-time clock", () => {
  it("is manual unless minutes are configured", () => {
    const run = createRun(db, { name: "clock-off", seed: 80 });
    expect(advanceClock(db, run.id, Date.now(), null)).toMatchObject({ enabled: false, stepped: 0 });
  });

  it("advances one tick per interval and caps catch-up", () => {
    const run = createRun(db, { name: "clock", seed: 81 });
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    expect(advanceClock(db, run.id, t0, 60).stepped).toBe(0);
    expect(advanceClock(db, run.id, t0 + 59 * 60_000, 60).stepped).toBe(0);
    const s = advanceClock(db, run.id, t0 + 61 * 60_000, 60);
    expect(s.stepped).toBe(1);
    expect(s.nextTickAt).toBe(new Date(t0 + 120 * 60_000).toISOString());
    expect(getRun(db, run.id).state.tick).toBe(1);
    expect(advanceClock(db, run.id, t0 + 100 * 3_600_000, 60).stepped).toBe(10);
    expect(getRun(db, run.id).state.tick).toBe(11);
  });

  it("accepts sub-minute years for local testing", () => {
    const run = createRun(db, { name: "clock-fast", seed: 82 });
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    advanceClock(db, run.id, t0, 0.5);
    expect(advanceClock(db, run.id, t0 + 29_000, 0.5).stepped).toBe(0);
    const s = advanceClock(db, run.id, t0 + 31_000, 0.5);
    expect(s.stepped).toBe(1);
    expect(s.nextTickAt).toBe(new Date(t0 + 60_000).toISOString());
  });
});

describe("renaming", () => {
  it("a player can rename their own character, and everyone sees it", () => {
    let s = applyImmediate(createWorld({ seed: 4 }), join_("p", { familyName: "林", givenName: "曉晴" })).state;
    const me = playerCharacter(s, "p")!;
    expect(me.familyName + me.givenName).toBe("林曉晴");
    const r = applyImmediate(s, { type: "RENAME", playerId: "p", givenName: "若水", familyName: "陳" });
    expect(r.rejected).toBeNull();
    s = r.state;
    expect(playerCharacter(s, "p")).toMatchObject({ givenName: "若水", familyName: "陳" });
    expect(r.events[0]!.title).toBe("林曉晴改名為陳若水");
    expect(applyImmediate(s, { type: "RENAME", playerId: "p", givenName: "若水", familyName: "陳" }).rejected).toMatch(/already/);
    expect(applyImmediate(s, { type: "RENAME", playerId: "p", givenName: "   ", familyName: "陳" }).rejected).toMatch(/Malformed/);
    expect(applyImmediate(s, { type: "RENAME", playerId: "nobody", givenName: "A", familyName: "" }).rejected).toBeTruthy();
  });
});

describe("yearly actions", () => {
  const ACTIONS = ["scavenge", "work", "study", "rest"] as const;

  it("every action gives an immediate, recorded result, once per year", () => {
    for (const action of ACTIONS) {
      const s = applyImmediate(createWorld({ seed: 30 }), join_("p", { profession: "Scout" })).state;
      const r = applyImmediate(s, { type: "YEAR_ACTION", playerId: "p", action });
      expect(r.rejected, action).toBeNull();
      expect(r.events).toHaveLength(1);
      expect(r.state.players!.p!.yearAction).toMatchObject({ tick: 0, action, title: r.events[0]!.title });
      expect(playerCharacter(r.state, "p")!.lifeEvents.at(-1)!.text).toBe(r.events[0]!.title);
      expect(applyImmediate(r.state, { type: "YEAR_ACTION", playerId: "p", action: "rest" }).rejected).toMatch(/already/);
    }
  });

  it("spending time with someone grows that bond", () => {
    const s = applyImmediate(createWorld({ seed: 31 }), join_("p")).state;
    const me = playerCharacter(s, "p")!;
    const other = s.characters.find((c) => c.id !== me.id && c.homeId === me.homeId && c.deathTick === null)!;
    const key = relationshipKey(me.id, other.id);
    const r = applyImmediate(s, { type: "YEAR_ACTION", playerId: "p", action: "visit", characterId: other.id });
    expect(r.rejected).toBeNull();
    expect(r.state.relationships[key] ?? 0).toBeGreaterThan(s.relationships[key] ?? 0);
    expect(applyImmediate(s, { type: "YEAR_ACTION", playerId: "p", action: "visit" }).rejected).toMatch(/Choose/);
  });

  it("opens again after the year turns, and replays exactly", () => {
    const run = createRun(db, { name: "year-actions", seed: 32 });
    applyPlayerAction(db, run.id, join_("p"));
    applyPlayerAction(db, run.id, { type: "YEAR_ACTION", playerId: "p", action: "study" });
    expect(() => applyPlayerAction(db, run.id, { type: "YEAR_ACTION", playerId: "p", action: "rest" })).toThrow(/already/);
    stepRun(db, run.id, 1);
    applyPlayerAction(db, run.id, { type: "YEAR_ACTION", playerId: "p", action: "rest" });
    expect(verifyReplay(db, run.id).ok).toBe(true);
  });
});
