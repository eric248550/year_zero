import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const createdAt = () => text("created_at").notNull();

/** A simulation run: one seeded timeline of one world. */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  seed: integer("seed").notNull(),
  policy: text("policy").notNull(),
  rulesVersion: text("rules_version").notNull(),
  contentVersion: text("content_version").notNull(),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  parentRunId: text("parent_run_id"),
  forkedFromTick: integer("forked_from_tick"),
  currentTick: integer("current_tick").notNull().default(0),
  headState: json<unknown>("head_state").notNull(),
  headHash: text("head_hash").notNull(),
  /** Developer actions queued for the next tick (mutable queue, not history). */
  queuedActions: json<unknown[]>("queued_actions").notNull().default([]),
  /** Persistent developer choice overrides: definitionId -> choiceId. Logged per tick when applied. */
  choiceOverrides: json<Record<string, string>>("choice_overrides").notNull().default({}),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull(),
});

/** Frozen content bundle per run, so replays never depend on later edits or LLM calls. */
export const runContent = sqliteTable("run_content", {
  runId: text("run_id").primaryKey().references(() => runs.id),
  bundle: json<unknown>("bundle").notNull(),
});

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull().references(() => runs.id),
    tick: integer("tick").notNull(),
    state: json<unknown>("state").notNull(),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("snapshots_run_tick").on(t.runId, t.tick)],
);

/** Append-only historical event log. UPDATE/DELETE are blocked by triggers. */
export const historyEvents = sqliteTable(
  "history_events",
  {
    runId: text("run_id").notNull().references(() => runs.id),
    id: text("id").notNull(),
    tick: integer("tick").notNull(),
    year: integer("year").notNull(),
    kind: text("kind").notNull(),
    definitionId: text("definition_id"),
    category: text("category").notNull(),
    importance: text("importance").notNull(),
    title: text("title").notNull(),
    settlementIds: json<string[]>("settlement_ids").notNull(),
    characterIds: json<string[]>("character_ids").notNull(),
    storylineIds: json<string[]>("storyline_ids").notNull(),
    payload: json<unknown>("payload").notNull(),
    committedAt: text("committed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.id] }), index("history_run_tick").on(t.runId, t.tick)],
);

/** Logged developer decisions per tick — the only external input needed for replay. */
export const decisions = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull().references(() => runs.id),
    tick: integer("tick").notNull(),
    actions: json<unknown[]>("actions").notNull(),
    rejected: json<unknown[]>("rejected").notNull(),
    choiceOverrides: json<Record<string, string>>("choice_overrides").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("decisions_run_tick").on(t.runId, t.tick)],
);

export const tickMetrics = sqliteTable(
  "tick_metrics",
  {
    runId: text("run_id").notNull().references(() => runs.id),
    tick: integer("tick").notNull(),
    year: integer("year").notNull(),
    population: integer("population").notNull(),
    settlements: integer("settlements").notNull(),
    food: real("food").notNull(),
    water: real("water").notNull(),
    materials: real("materials").notNull(),
    knowledge: real("knowledge").notNull(),
    technologies: integer("technologies").notNull(),
    births: integer("births").notNull(),
    deaths: integer("deaths").notNull(),
    morale: real("morale").notNull(),
    health: real("health").notNull(),
    events: integer("events").notNull(),
    status: text("status").notNull(),
    /** Developer wall-clock execution time for this tick (NOT world time). */
    execMs: real("exec_ms").notNull(),
    rejectedEvents: json<unknown[]>("rejected_events").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.tick] })],
);

export const eventDefinitions = sqliteTable("event_definitions", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "validated", "published", "archived"] }).notNull(),
  source: text("source").notNull(),
  definition: json<unknown>("definition").notNull(),
  validation: json<{ errors: unknown[]; warnings: unknown[] } | null>("validation"),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull(),
  publishedAt: text("published_at"),
});

/** Append-only version history of event definitions. */
export const eventDefinitionVersions = sqliteTable(
  "event_definition_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    definitionId: text("definition_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    definition: json<unknown>("definition").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("def_versions_def").on(t.definitionId)],
);

export const storylines = sqliteTable("storylines", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  definition: json<unknown>("definition").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const aiGenerations = sqliteTable("ai_generations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prompt: text("prompt").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  isMock: integer("is_mock", { mode: "boolean" }).notNull(),
  rawOutput: text("raw_output"),
  definitionId: text("definition_id"),
  outcome: text("outcome", { enum: ["valid", "invalid", "error"] }).notNull(),
  errors: json<unknown[]>("errors").notNull(),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
