import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { IMPORTANCE, TECH_BY_ID, type HistoricalEvent, type Importance, type WorldState } from "@genesis/schemas";
import type { Db } from "../client";
import { historyEvents, tickMetrics } from "../schema";
import { getRun, getRunContent } from "./runs";

export interface HistoryFilters {
  fromYear?: number;
  toYear?: number;
  category?: string;
  settlementId?: string;
  characterId?: string;
  storylineId?: string;
  definitionId?: string;
  minImportance?: Importance;
  kind?: "narrative" | "system";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

function whereFor(runId: string, f: HistoryFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [eq(historyEvents.runId, runId)];
  if (f.fromYear !== undefined) clauses.push(gte(historyEvents.year, f.fromYear));
  if (f.toYear !== undefined) clauses.push(lte(historyEvents.year, f.toYear));
  if (f.category) clauses.push(eq(historyEvents.category, f.category));
  if (f.kind) clauses.push(eq(historyEvents.kind, f.kind));
  if (f.definitionId) clauses.push(eq(historyEvents.definitionId, f.definitionId));
  if (f.minImportance) {
    const allowed = IMPORTANCE.slice(IMPORTANCE.indexOf(f.minImportance));
    clauses.push(inArray(historyEvents.importance, [...allowed]));
  }
  if (f.settlementId) clauses.push(sql`exists (select 1 from json_each(${historyEvents.settlementIds}) where value = ${f.settlementId})`);
  if (f.characterId) clauses.push(sql`exists (select 1 from json_each(${historyEvents.characterIds}) where value = ${f.characterId})`);
  if (f.storylineId) clauses.push(sql`exists (select 1 from json_each(${historyEvents.storylineIds}) where value = ${f.storylineId})`);
  return and(...clauses);
}

export function queryHistory(db: Db, runId: string, f: HistoryFilters = {}) {
  const where = whereFor(runId, f);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  const order = f.order === "asc" ? [asc(historyEvents.tick), asc(historyEvents.id)] : [desc(historyEvents.tick), desc(historyEvents.id)];
  const rows = db.select({ payload: historyEvents.payload }).from(historyEvents).where(where).orderBy(...order).limit(limit).offset(f.offset ?? 0).all();
  const total = db.select({ n: sql<number>`count(*)` }).from(historyEvents).where(where).get()?.n ?? 0;
  return { items: rows.map((r) => r.payload as HistoricalEvent), total };
}

export function historyCategoryCounts(db: Db, runId: string) {
  return db
    .select({ category: historyEvents.category, n: sql<number>`count(*)` })
    .from(historyEvents)
    .where(eq(historyEvents.runId, runId))
    .groupBy(historyEvents.category)
    .all();
}

/** One event with its causes, consequences and sub-events resolved. */
export function getHistoryEventDetail(db: Db, runId: string, id: string) {
  const row = db.select({ payload: historyEvents.payload }).from(historyEvents).where(and(eq(historyEvents.runId, runId), eq(historyEvents.id, id))).get();
  if (!row) return null;
  const event = row.payload as HistoricalEvent;
  const fetch = (ids: string[]) =>
    ids.length === 0
      ? []
      : db.select({ payload: historyEvents.payload }).from(historyEvents).where(and(eq(historyEvents.runId, runId), inArray(historyEvents.id, ids))).all().map((r) => r.payload as HistoricalEvent);
  const consequences = db
    .select({ payload: historyEvents.payload })
    .from(historyEvents)
    .where(and(eq(historyEvents.runId, runId), sql`exists (select 1 from json_each(json_extract(${historyEvents.payload}, '$.causeIds')) where value = ${id})`))
    .orderBy(asc(historyEvents.tick))
    .limit(50)
    .all()
    .map((r) => r.payload as HistoricalEvent);
  const { state } = getRun(db, runId);
  const definition = event.definitionId ? getRunContent(db, runId).events.find((e) => e.id === event.definitionId) ?? null : null;
  return {
    event,
    causes: fetch(event.causeIds),
    consequences,
    definition,
    characters: event.characterIds.map((cid) => state.characters.find((c) => c.id === cid)).filter((c) => c !== undefined),
    settlements: event.settlementIds.map((sid) => state.settlements.find((s) => s.id === sid)).filter((s) => s !== undefined),
  };
}

/* ------------------------------------------------------------------ */
/* Run comparison                                                      */
/* ------------------------------------------------------------------ */

function runDigest(db: Db, runId: string) {
  const { summary, state } = getRun(db, runId);
  const milestones = queryHistory(db, runId, { minImportance: "major", order: "asc", limit: 200 }).items;
  const counts = db
    .select({ id: historyEvents.definitionId, n: sql<number>`count(*)` })
    .from(historyEvents)
    .where(and(eq(historyEvents.runId, runId), eq(historyEvents.kind, "narrative"), sql`${historyEvents.definitionId} is not null`))
    .groupBy(historyEvents.definitionId)
    .all();
  const series = db.select({ tick: tickMetrics.tick, population: tickMetrics.population, technologies: tickMetrics.technologies, food: tickMetrics.food })
    .from(tickMetrics).where(eq(tickMetrics.runId, runId)).orderBy(asc(tickMetrics.tick)).all();
  return { summary, state, milestones, narrativeCounts: Object.fromEntries(counts.map((c) => [c.id ?? "", c.n])), series };
}

function resources(state: WorldState) {
  const active = state.settlements.filter((s) => s.status === "active");
  const sum = (k: "food" | "water" | "materials" | "knowledge") => Math.round(active.reduce((a, s) => a + s.resources[k], 0));
  return { food: sum("food"), water: sum("water"), materials: sum("materials"), knowledge: sum("knowledge") };
}

export function compareRuns(db: Db, aId: string, bId: string) {
  const a = runDigest(db, aId);
  const b = runDigest(db, bId);
  const techName = (id: string) => TECH_BY_ID[id]?.name ?? id;
  const allDefs = new Set([...Object.keys(a.narrativeCounts), ...Object.keys(b.narrativeCounts)]);
  const narrative = [...allDefs].sort().map((id) => ({ id, a: a.narrativeCounts[id] ?? 0, b: b.narrativeCounts[id] ?? 0 })).filter((r) => r.a !== r.b);
  const flagsA = new Set(Object.keys(a.state.flags));
  const flagsB = new Set(Object.keys(b.state.flags));
  const maxTick = Math.max(a.summary.currentTick, b.summary.currentTick);
  const byTickA = new Map(a.series.map((s) => [s.tick, s]));
  const byTickB = new Map(b.series.map((s) => [s.tick, s]));
  const series = Array.from({ length: maxTick + 1 }, (_, t) => ({
    tick: t,
    a: byTickA.get(t)?.population ?? null,
    b: byTickB.get(t)?.population ?? null,
    aTech: byTickA.get(t)?.technologies ?? null,
    bTech: byTickB.get(t)?.technologies ?? null,
  }));
  const side = (d: ReturnType<typeof runDigest>) => ({
    summary: d.summary,
    resources: resources(d.state),
    technologies: d.state.technologies.map(techName),
    secrets: Object.keys(d.state.secrets),
    deaths: d.state.stats.deaths,
    births: d.state.stats.births,
    peakPopulation: d.state.stats.peakPopulation,
    milestones: d.milestones.map((m) => ({ id: m.id, tick: m.tick, year: m.year, title: m.title, importance: m.importance })),
  });
  return {
    a: side(a),
    b: side(b),
    diff: {
      techOnlyA: a.state.technologies.filter((t) => !b.state.technologies.includes(t)).map(techName),
      techOnlyB: b.state.technologies.filter((t) => !a.state.technologies.includes(t)).map(techName),
      flagsOnlyA: [...flagsA].filter((f) => !flagsB.has(f)).sort(),
      flagsOnlyB: [...flagsB].filter((f) => !flagsA.has(f)).sort(),
      narrative,
    },
    series,
  };
}
