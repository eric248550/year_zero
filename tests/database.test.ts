import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareRuns,
  createRun,
  forkRun,
  getHistoryEventDetail,
  getMetrics,
  getRun,
  importSeedContent,
  migrateDb,
  openDb,
  publishDefinition,
  queryHistory,
  queueAction,
  reconstructState,
  resetRun,
  saveEventDefinition,
  stepRun,
  validateStoredDefinition,
  verifyReplay,
  type Db,
} from "@genesis/database";
import { hashState } from "@genesis/simulation";
import { seedContent } from "./helpers";

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "genesis-test-"));
  db = openDb(join(dir, "test.db"));
  migrateDb(db);
  importSeedContent(db, seedContent);
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("persistence", () => {
  it("persists runs, history, metrics and snapshots as the simulation advances", () => {
    const run = createRun(db, { seed: 9, name: "persist" });
    const r = stepRun(db, run.id, 25);
    expect(r.toTick).toBe(25);
    const { state } = getRun(db, run.id);
    expect(state.tick).toBe(25);
    expect(getMetrics(db, run.id)).toHaveLength(26);
    expect(queryHistory(db, run.id, { limit: 500 }).total).toBeGreaterThan(0);
  });

  it("historical events are immutable at the database level", () => {
    const run = createRun(db, { seed: 10 });
    stepRun(db, run.id, 10);
    expect(() => db.$client.prepare("update history_events set title = 'rewritten' where run_id = ?").run(run.id)).toThrow(/immutable/);
    expect(() => db.$client.prepare("delete from history_events where run_id = ?").run(run.id)).toThrow(/cannot be deleted/);
  });

  it("verifies replay of a persisted run with developer decisions and reconstructs past states", () => {
    const run = createRun(db, { seed: 11 });
    stepRun(db, run.id, 5);
    queueAction(db, run.id, { type: "SET_RESEARCH_FOCUS", tech: "field_medicine" });
    stepRun(db, run.id, 20);
    queueAction(db, run.id, { type: "SET_POLICY", policy: "cautious" });
    stepRun(db, run.id, 12);
    const v = verifyReplay(db, run.id);
    expect(v.ok).toBe(true);
    expect(v.checks.length).toBeGreaterThanOrEqual(4);
    const past = reconstructState(db, run.id, 17);
    expect(past.state.tick).toBe(17);
    expect(past.fromSnapshot).toBe(10);
  });

  it("rejects invalid developer actions before queueing", () => {
    const run = createRun(db, { seed: 12 });
    expect(() => queueAction(db, run.id, { type: "FOUND_SETTLEMENT", locationId: "vault_12", fromSettlementId: "s-haven", settlers: 6 })).toThrow();
  });

  it("reset with the same seed reproduces the same history", () => {
    const run = createRun(db, { seed: 13 });
    stepRun(db, run.id, 30);
    const original = getRun(db, run.id).headHash;
    const fresh = resetRun(db, run.id);
    stepRun(db, fresh.id, 30);
    expect(getRun(db, fresh.id).headHash).toBe(original);
    expect(getRun(db, run.id).summary.status).toBe("archived");
  });

  it("forks from a snapshot: same policy continues identically, reseeded fork diverges", () => {
    const run = createRun(db, { seed: 14 });
    stepRun(db, run.id, 40);
    const same = forkRun(db, run.id, 20);
    stepRun(db, same.id, 20);
    expect(getRun(db, same.id).headHash).toBe(getRun(db, run.id).headHash);
    expect(queryHistory(db, same.id, { limit: 500 }).total).toBe(queryHistory(db, run.id, { limit: 500 }).total);
    const diverged = forkRun(db, run.id, 20, { reseed: 999 });
    stepRun(db, diverged.id, 20);
    expect(getRun(db, diverged.id).headHash).not.toBe(getRun(db, run.id).headHash);
    expect(verifyReplay(db, diverged.id).ok).toBe(true);
    const cmp = compareRuns(db, run.id, diverged.id);
    expect(cmp.series.length).toBe(41);
  });

  it("resolves causes and consequences for an event", () => {
    const run = createRun(db, { seed: 15 });
    stepRun(db, run.id, 50);
    const items = queryHistory(db, run.id, { limit: 500 }).items;
    const withCause = items.find((e) => e.causeIds.length > 0);
    if (withCause) {
      const detail = getHistoryEventDetail(db, run.id, withCause.id)!;
      expect(detail.causes.length).toBeGreaterThan(0);
      const cause = getHistoryEventDetail(db, run.id, withCause.causeIds[0]!)!;
      expect(cause.consequences.map((c) => c.id)).toContain(withCause.id);
    }
  });

  it("content workflow: draft → validated → published; invalid drafts cannot be published", () => {
    const draft = {
      id: "test-flood", title: "Flood", scope: "settlement", category: "environment", description: "A flood.",
      narrative: { headline: "Flood in {{settlement}}", text: "Water rises." }, effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: -5 }],
    };
    const saved = saveEventDefinition(db, draft);
    expect(saved.row?.status).toBe("draft");
    expect(() => publishDefinition(db, "test-flood")).toThrow(/validated/);
    expect(validateStoredDefinition(db, "test-flood").row.status).toBe("validated");
    expect(publishDefinition(db, "test-flood").status).toBe("published");
    const bad = saveEventDefinition(db, { ...draft, id: "test-bad", effects: [{ type: "DROP_TABLE" }] });
    expect(bad.row).toBeNull();
    expect(bad.validation.valid).toBe(false);
  });

  it("existing runs keep their frozen content when definitions change", () => {
    const run = createRun(db, { seed: 16 });
    const before = hashState(getRun(db, run.id).state);
    saveEventDefinition(db, { id: "dust-storm", title: "Changed", scope: "world", category: "environment", description: "x", narrative: { headline: "h", text: "t" } });
    expect(hashState(getRun(db, run.id).state)).toBe(before);
    stepRun(db, run.id, 5);
    expect(verifyReplay(db, run.id).ok).toBe(true);
  });
});
