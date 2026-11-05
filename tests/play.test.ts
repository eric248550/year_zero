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
    expect(getCharacter(s, me.id)!.lifeEvents.at(-1)!.text).toMatch(/told no one/);
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
});
