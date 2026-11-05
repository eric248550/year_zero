import { and, asc, desc, eq, gt, gte, lte } from "drizzle-orm";
import {
  PlayerActionSchema,
  Rng,
  WorldStateSchema,
  seedToState,
  type ContentBundle,
  type HistoricalEvent,
  type PlayerAction,
  type PolicyId,
  type WorldState,
} from "@genesis/schemas";
import { checkEligibility, currentYear, population } from "@genesis/narrative";
import {
  TickContext,
  computeMetrics,
  createWorld,
  hashState,
  replay,
  stepWorld,
  validateAction,
  type TickDecisions,
  type TickMetrics,
} from "@genesis/simulation";
import { nowIso, type Db } from "../client";
import { decisions, historyEvents, runContent, runs, settings, snapshots, tickMetrics } from "../schema";
import { currentPublishedBundle } from "./content";

export const SNAPSHOT_INTERVAL = 10;
export const MAX_TICKS_PER_CALL = 50;

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export interface RunSummary {
  id: string;
  name: string;
  seed: number;
  policy: string;
  status: "active" | "archived";
  currentTick: number;
  year: number;
  population: number;
  settlements: number;
  technologies: number;
  parentRunId: string | null;
  forkedFromTick: number | null;
  rulesVersion: string;
  contentVersion: string;
  createdAt: string;
  updatedAt: string;
}

function runId(): string {
  return `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function summarize(row: typeof runs.$inferSelect): RunSummary {
  const state = row.headState as WorldState;
  return {
    id: row.id,
    name: row.name,
    seed: row.seed,
    policy: state.policy,
    status: row.status,
    currentTick: row.currentTick,
    year: currentYear(state),
    population: population(state),
    settlements: state.settlements.filter((s) => s.status === "active").length,
    technologies: state.technologies.length,
    parentRunId: row.parentRunId,
    forkedFromTick: row.forkedFromTick,
    rulesVersion: row.rulesVersion,
    contentVersion: row.contentVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function listRuns(db: Db): RunSummary[] {
  return db.select().from(runs).orderBy(desc(runs.updatedAt)).all().map(summarize);
}

export function getRunRow(db: Db, id: string) {
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  if (!row) throw new NotFoundError(`Run ${id}`);
  return row;
}

export function getRun(db: Db, id: string) {
  const row = getRunRow(db, id);
  return {
    summary: summarize(row),
    state: row.headState as WorldState,
    headHash: row.headHash,
    queuedActions: row.queuedActions as PlayerAction[],
    choiceOverrides: row.choiceOverrides,
  };
}

export function getRunContent(db: Db, id: string): ContentBundle {
  const row = db.select().from(runContent).where(eq(runContent.runId, id)).get();
  if (!row) throw new NotFoundError(`Content for run ${id}`);
  return row.bundle as ContentBundle;
}

export function getActiveRunId(db: Db): string | null {
  const row = db.select().from(settings).where(eq(settings.key, "activeRunId")).get();
  if (row) {
    const exists = db.select({ id: runs.id }).from(runs).where(eq(runs.id, row.value)).get();
    if (exists) return row.value;
  }
  const latest = db.select({ id: runs.id }).from(runs).where(eq(runs.status, "active")).orderBy(desc(runs.updatedAt)).get();
  return latest?.id ?? null;
}

export function setActiveRunId(db: Db, id: string): void {
  getRunRow(db, id);
  db.insert(settings).values({ key: "activeRunId", value: id }).onConflictDoUpdate({ target: settings.key, set: { value: id } }).run();
}

export function getMetrics(db: Db, id: string) {
  return db.select().from(tickMetrics).where(eq(tickMetrics.runId, id)).orderBy(asc(tickMetrics.tick)).all();
}

export function listSnapshots(db: Db, id: string) {
  return db.select({ tick: snapshots.tick, hash: snapshots.hash, createdAt: snapshots.createdAt }).from(snapshots).where(eq(snapshots.runId, id)).orderBy(asc(snapshots.tick)).all();
}

export function listDecisions(db: Db, id: string) {
  return db.select().from(decisions).where(eq(decisions.runId, id)).orderBy(asc(decisions.tick)).all();
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function insertMetrics(db: Db, id: string, m: TickMetrics, execMs: number, rejected: unknown[]) {
  db.insert(tickMetrics).values({ runId: id, ...m, execMs, rejectedEvents: rejected }).run();
}

function insertHistory(db: Db, id: string, events: readonly HistoricalEvent[]) {
  const at = nowIso();
  for (const e of events) {
    db.insert(historyEvents).values({
      runId: id,
      id: e.id,
      tick: e.tick,
      year: e.year,
      kind: e.kind,
      definitionId: e.definitionId,
      category: e.category,
      importance: e.importance,
      title: e.title,
      settlementIds: e.settlementIds,
      characterIds: e.characterIds,
      storylineIds: e.storylineIds,
      payload: e,
      committedAt: at,
    }).run();
  }
}

function insertSnapshot(db: Db, id: string, state: WorldState) {
  db.insert(snapshots).values({ runId: id, tick: state.tick, state, hash: hashState(state), createdAt: nowIso() }).onConflictDoNothing().run();
}

export interface CreateRunInput {
  name?: string;
  seed: number;
  policy?: PolicyId;
  content?: ContentBundle;
  activate?: boolean;
}

export function createRun(db: Db, input: CreateRunInput): RunSummary {
  const content = input.content ?? currentPublishedBundle(db);
  const state = createWorld({ seed: input.seed, policy: input.policy ?? "balanced" });
  const id = runId();
  const at = nowIso();
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    t.insert(runs).values({
      id,
      name: input.name?.trim() || `Seed ${input.seed} · ${state.policy}`,
      seed: input.seed,
      policy: state.policy,
      rulesVersion: state.rulesVersion,
      contentVersion: content.version,
      currentTick: 0,
      headState: state,
      headHash: hashState(state),
      queuedActions: [],
      choiceOverrides: {},
      createdAt: at,
      updatedAt: at,
    }).run();
    t.insert(runContent).values({ runId: id, bundle: content }).run();
    insertSnapshot(t, id, state);
    insertMetrics(t, id, computeMetrics(state, { births: 0, deaths: 0, events: 0 }), 0, []);
  });
  if (input.activate !== false) setActiveRunId(db, id);
  return summarize(getRunRow(db, id));
}

export interface StepResult {
  fromTick: number;
  toTick: number;
  events: number;
  highlights: { id: string; tick: number; title: string; importance: string }[];
  rejectedActions: { action: unknown; reason: string }[];
  rejectedEvents: { tick: number; definitionId: string; reason: string }[];
  population: number;
  status: string;
  execMs: number;
}

/**
 * Advance a run by `ticks` (bounded). Everything for the batch commits in one
 * transaction: history, metrics, decision log, periodic snapshots and the head.
 */
export function stepRun(db: Db, id: string, ticks: number): StepResult {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS_PER_CALL) {
    throw new RangeError(`ticks must be an integer between 1 and ${MAX_TICKS_PER_CALL}`);
  }
  const row = getRunRow(db, id);
  if (row.status !== "active") throw new ConflictError("Archived runs are read-only. Fork or reset to continue.");
  const content = getRunContent(db, id);
  let state = row.headState as WorldState;
  const fromTick = state.tick;
  const out: StepResult = { fromTick, toTick: fromTick, events: 0, highlights: [], rejectedActions: [], rejectedEvents: [], population: 0, status: "", execMs: 0 };
  const started = performance.now();

  db.transaction((tx) => {
    const t = tx as unknown as Db;
    let queued = row.queuedActions as unknown[];
    for (let i = 0; i < ticks; i++) {
      const t0 = performance.now();
      const overrides = row.choiceOverrides;
      const result = stepWorld(state, { events: content.events, actions: queued, choiceOverrides: overrides });
      const execMs = performance.now() - t0;
      state = result.state;
      insertHistory(t, id, result.events);
      insertMetrics(t, id, result.metrics, Math.round(execMs * 100) / 100, result.rejectedEvents);
      if (queued.length > 0 || Object.keys(overrides).length > 0) {
        t.insert(decisions).values({
          runId: id,
          tick: state.tick,
          actions: result.acceptedActions,
          rejected: result.rejectedActions,
          choiceOverrides: overrides,
          createdAt: nowIso(),
        }).run();
      }
      if (state.tick % SNAPSHOT_INTERVAL === 0) insertSnapshot(t, id, state);
      out.events += result.events.length;
      out.highlights.push(...result.events.filter((e) => e.importance === "major" || e.importance === "critical").map((e) => ({ id: e.id, tick: e.tick, title: e.title, importance: e.importance })));
      out.rejectedActions.push(...result.rejectedActions);
      out.rejectedEvents.push(...result.rejectedEvents.map((r) => ({ tick: state.tick, ...r })));
      queued = [];
    }
    t.update(runs).set({ headState: state, headHash: hashState(state), currentTick: state.tick, queuedActions: [], updatedAt: nowIso() }).where(eq(runs.id, id)).run();
  });

  out.toTick = state.tick;
  out.population = population(state);
  out.status = computeMetrics(state, { births: 0, deaths: 0, events: 0 }).status;
  out.execMs = Math.round(performance.now() - started);
  return out;
}

/** Validate and queue a developer action for the next tick. */
export function queueAction(db: Db, id: string, raw: unknown): PlayerAction[] {
  const row = getRunRow(db, id);
  if (row.status !== "active") throw new ConflictError("Archived runs are read-only");
  const action = PlayerActionSchema.parse(raw);
  const probe = structuredClone(row.headState as WorldState);
  const reason = validateAction(new TickContext(probe, new Rng(0)), action);
  if (reason) throw new ConflictError(reason);
  const queue = [...(row.queuedActions as PlayerAction[]), action];
  db.update(runs).set({ queuedActions: queue, updatedAt: nowIso() }).where(eq(runs.id, id)).run();
  return queue;
}

export function clearQueuedActions(db: Db, id: string): void {
  db.update(runs).set({ queuedActions: [] }).where(eq(runs.id, id)).run();
}

export function setChoiceOverride(db: Db, id: string, definitionId: string, choiceId: string | null): Record<string, string> {
  const row = getRunRow(db, id);
  const content = getRunContent(db, id);
  const def = content.events.find((e) => e.id === definitionId);
  if (!def) throw new NotFoundError(`Event ${definitionId} in this run's content`);
  const next = { ...row.choiceOverrides };
  if (choiceId === null) delete next[definitionId];
  else {
    if (!def.choices.some((c) => c.id === choiceId)) throw new ConflictError(`Event ${definitionId} has no choice ${choiceId}`);
    next[definitionId] = choiceId;
  }
  db.update(runs).set({ choiceOverrides: next, updatedAt: nowIso() }).where(eq(runs.id, id)).run();
  return next;
}

export function renameRun(db: Db, id: string, name: string): void {
  getRunRow(db, id);
  db.update(runs).set({ name: name.trim().slice(0, 80) || "Untitled run", updatedAt: nowIso() }).where(eq(runs.id, id)).run();
}

export function archiveRun(db: Db, id: string): void {
  getRunRow(db, id);
  db.update(runs).set({ status: "archived", updatedAt: nowIso() }).where(eq(runs.id, id)).run();
}

/**
 * Reset = archive this run (its history stays immutable) and start a fresh run
 * with the same seed, policy and frozen content. Stepping it again reproduces
 * the same history unless different decisions are made.
 */
export function resetRun(db: Db, id: string): RunSummary {
  const row = getRunRow(db, id);
  const initial = db.select().from(snapshots).where(and(eq(snapshots.runId, id), eq(snapshots.tick, row.forkedFromTick ?? 0))).get();
  const initialPolicy = (initial?.state as WorldState | undefined)?.policy ?? (row.policy as PolicyId);
  archiveRun(db, id);
  const baseName = row.name.replace(/ \(replay( \d+)?\)$/, "");
  return createRun(db, { name: `${baseName} (replay)`, seed: row.seed, policy: initialPolicy, content: getRunContent(db, id) });
}

/* ------------------------------------------------------------------ */
/* Replay, reconstruction and forking                                  */
/* ------------------------------------------------------------------ */

function decisionLookup(db: Db, id: string): (tick: number) => TickDecisions | undefined {
  const rows = listDecisions(db, id);
  const map = new Map(rows.map((r) => [r.tick, { actions: r.actions as PlayerAction[], choiceOverrides: r.choiceOverrides }]));
  return (tick) => map.get(tick);
}

/** Rebuild the exact world state at any past tick from the nearest snapshot + logged decisions. */
export function reconstructState(db: Db, id: string, tick: number) {
  const row = getRunRow(db, id);
  if (tick < 0 || tick > row.currentTick) throw new RangeError(`Tick must be between 0 and ${row.currentTick}`);
  const snap = db.select().from(snapshots).where(and(eq(snapshots.runId, id), lte(snapshots.tick, tick))).orderBy(desc(snapshots.tick)).get();
  if (!snap) throw new NotFoundError(`Snapshot at or before tick ${tick}`);
  const from = WorldStateSchema.parse(snap.state) as WorldState;
  const content = getRunContent(db, id);
  const { state } = replay({ from, toTick: tick, events: content.events, decisions: decisionLookup(db, id) });
  return { state, fromSnapshot: snap.tick, replayedTicks: tick - snap.tick };
}

export interface ReplayVerification {
  ok: boolean;
  checks: { tick: number; expected: string; actual: string; ok: boolean }[];
  durationMs: number;
}

/** Replay the whole run from its first snapshot and compare every snapshot hash and the head. */
export function verifyReplay(db: Db, id: string): ReplayVerification {
  const row = getRunRow(db, id);
  const started = performance.now();
  // A fork's state at its fork point may be deliberately modified (policy change, reseed),
  // so its own timeline is verified from the fork-point snapshot onward.
  const origin = row.forkedFromTick ?? 0;
  const snaps = db.select().from(snapshots).where(and(eq(snapshots.runId, id), gte(snapshots.tick, origin))).orderBy(asc(snapshots.tick)).all();
  const first = snaps[0];
  if (!first) throw new NotFoundError("Initial snapshot");
  const content = getRunContent(db, id);
  const expectedByTick = new Map(snaps.map((s) => [s.tick, s.hash]));
  expectedByTick.set(row.currentTick, row.headHash);
  const checks: ReplayVerification["checks"] = [];
  replay({
    from: WorldStateSchema.parse(first.state) as WorldState,
    toTick: row.currentTick,
    events: content.events,
    decisions: decisionLookup(db, id),
    onTick: (r) => {
      const expected = expectedByTick.get(r.state.tick);
      if (expected) {
        const actual = hashState(r.state);
        checks.push({ tick: r.state.tick, expected, actual, ok: actual === expected });
      }
    },
  });
  return { ok: checks.every((c) => c.ok), checks, durationMs: Math.round(performance.now() - started) };
}

export interface ForkOptions {
  name?: string;
  policy?: PolicyId;
  /** When set, the random stream diverges from the parent from the fork point onward. */
  reseed?: number;
}

/**
 * Clone a run at `tick` into a new run. History, metrics, decisions and
 * snapshots up to the fork point are copied; the new run continues independently.
 */
export function forkRun(db: Db, id: string, tick: number, options: ForkOptions = {}): RunSummary {
  const parent = getRunRow(db, id);
  const { state } = reconstructState(db, id, tick);
  const forked = structuredClone(state);
  if (options.policy) forked.policy = options.policy;
  if (options.reseed !== undefined) forked.rng = seedToState(options.reseed * 7919 + tick);
  const newId = runId();
  const at = nowIso();
  const content = getRunContent(db, id);
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    t.insert(runs).values({
      id: newId,
      name: options.name?.trim() || `${parent.name} ⑂ t${tick}`,
      seed: parent.seed,
      policy: forked.policy,
      rulesVersion: parent.rulesVersion,
      contentVersion: parent.contentVersion,
      parentRunId: id,
      forkedFromTick: tick,
      currentTick: tick,
      headState: forked,
      headHash: hashState(forked),
      queuedActions: [],
      choiceOverrides: parent.choiceOverrides,
      notes: options.reseed !== undefined ? `Reseeded with ${options.reseed} at fork` : null,
      createdAt: at,
      updatedAt: at,
    }).run();
    t.insert(runContent).values({ runId: newId, bundle: content }).run();
    for (const h of t.select().from(historyEvents).where(and(eq(historyEvents.runId, id), lte(historyEvents.tick, tick))).all()) {
      t.insert(historyEvents).values({ ...h, runId: newId }).run();
    }
    for (const m of t.select().from(tickMetrics).where(and(eq(tickMetrics.runId, id), lte(tickMetrics.tick, tick))).all()) {
      t.insert(tickMetrics).values({ ...m, runId: newId }).run();
    }
    for (const d of t.select().from(decisions).where(and(eq(decisions.runId, id), lte(decisions.tick, tick))).all()) {
      t.insert(decisions).values({ runId: newId, tick: d.tick, actions: d.actions, rejected: d.rejected, choiceOverrides: d.choiceOverrides, createdAt: at }).run();
    }
    // Snapshots before the fork point are shared truth; the fork point gets the (possibly modified) state.
    for (const s of t.select().from(snapshots).where(and(eq(snapshots.runId, id), lte(snapshots.tick, tick))).all()) {
      if (s.tick === tick) continue;
      t.insert(snapshots).values({ runId: newId, tick: s.tick, state: s.state, hash: s.hash, createdAt: at }).run();
    }
    insertSnapshot(t, newId, forked);
  });
  setActiveRunId(db, newId);
  return summarize(getRunRow(db, newId));
}

/** Developer debugging: why each event in the run's content can or cannot fire right now. */
export function eligibilityForRun(db: Db, id: string) {
  const { state } = getRun(db, id);
  const content = getRunContent(db, id);
  return content.events.map((def) => ({ definition: { id: def.id, title: def.title, priority: def.priority, chance: def.chance, category: def.category }, report: checkEligibility(state, def) }));
}

export function metricsAfter(db: Db, id: string, tick: number) {
  return db.select().from(tickMetrics).where(and(eq(tickMetrics.runId, id), gt(tickMetrics.tick, tick))).orderBy(asc(tickMetrics.tick)).all();
}
