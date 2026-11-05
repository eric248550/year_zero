import { asc, desc, eq } from "drizzle-orm";
import type { ContentBundle, DefinitionStatus, EventDefinition, Storyline } from "@genesis/schemas";
import { makeContentBundle, validateEventDefinition, validateStoryline, type ValidationContext, type ValidationResult } from "@genesis/narrative";
import { nowIso, type Db } from "../client";
import { aiGenerations, eventDefinitions, eventDefinitionVersions, storylines } from "../schema";

export class ContentError extends Error {
  constructor(message: string, public readonly validation?: ValidationResult<unknown>) {
    super(message);
    this.name = "ContentError";
  }
}

export interface DefinitionRow {
  id: string;
  version: number;
  status: DefinitionStatus;
  source: string;
  definition: EventDefinition;
  validation: { errors: { path: string; message: string; code: string }[]; warnings: { path: string; message: string; code: string }[] } | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export function validationContext(db: Db, extra: { eventId?: string } = {}): ValidationContext {
  const eventIds = db.select({ id: eventDefinitions.id }).from(eventDefinitions).all().map((r) => r.id);
  const storylineIds = db.select({ id: storylines.id }).from(storylines).all().map((r) => r.id);
  return { knownEventIds: new Set([...eventIds, ...(extra.eventId ? [extra.eventId] : [])]), knownStorylineIds: new Set(storylineIds) };
}

export function listEventDefinitions(db: Db): DefinitionRow[] {
  return db.select().from(eventDefinitions).orderBy(asc(eventDefinitions.id)).all() as DefinitionRow[];
}

export function getEventDefinition(db: Db, id: string): DefinitionRow | null {
  return (db.select().from(eventDefinitions).where(eq(eventDefinitions.id, id)).get() as DefinitionRow | undefined) ?? null;
}

export function listDefinitionVersions(db: Db, id: string) {
  return db.select().from(eventDefinitionVersions).where(eq(eventDefinitionVersions.definitionId, id)).orderBy(desc(eventDefinitionVersions.version)).all();
}

/**
 * Create or update an event definition. Always stored as a DRAFT with its
 * validation result; publishing is a separate, explicit step.
 */
export function saveEventDefinition(
  db: Db,
  raw: unknown,
  options: { source?: string; note?: string; expectedId?: string } = {},
): { row: DefinitionRow | null; validation: ValidationResult<EventDefinition> } {
  const candidateId = (raw as { id?: unknown } | null)?.id;
  const validation = validateEventDefinition(raw, validationContext(db, { eventId: typeof candidateId === "string" ? candidateId : undefined }));
  if (!validation.value) return { row: null, validation };
  const def = validation.value;
  if (options.expectedId && options.expectedId !== def.id) {
    throw new ContentError(`Definition id cannot change (expected ${options.expectedId}, got ${def.id})`);
  }
  const existing = getEventDefinition(db, def.id);
  const version = existing ? existing.version + 1 : 1;
  const source = options.source ?? existing?.source ?? "manual";
  const stored: EventDefinition = { ...def, version, status: "draft", source };
  const at = nowIso();
  const record = { errors: validation.errors, warnings: validation.warnings };
  db.transaction((tx) => {
    if (existing) {
      tx.update(eventDefinitions).set({ version, status: "draft", source, definition: stored, validation: record, updatedAt: at }).where(eq(eventDefinitions.id, def.id)).run();
    } else {
      tx.insert(eventDefinitions).values({ id: def.id, version, status: "draft", source, definition: stored, validation: record, createdAt: at, updatedAt: at }).run();
    }
    tx.insert(eventDefinitionVersions).values({ definitionId: def.id, version, status: "draft", definition: stored, note: options.note ?? null, createdAt: at }).run();
  });
  return { row: getEventDefinition(db, def.id), validation };
}

function setStatus(db: Db, id: string, status: DefinitionStatus, note: string) {
  const row = getEventDefinition(db, id)!;
  const at = nowIso();
  const definition = { ...row.definition, status };
  db.transaction((tx) => {
    tx.update(eventDefinitions).set({ status, definition, updatedAt: at, ...(status === "published" ? { publishedAt: at } : {}) }).where(eq(eventDefinitions.id, id)).run();
    tx.insert(eventDefinitionVersions).values({ definitionId: id, version: row.version, status, definition, note, createdAt: at }).run();
  });
  return getEventDefinition(db, id)!;
}

/** Re-run validation; a definition with no errors moves to `validated`. */
export function validateStoredDefinition(db: Db, id: string): { row: DefinitionRow; validation: ValidationResult<EventDefinition> } {
  const row = getEventDefinition(db, id);
  if (!row) throw new ContentError(`Event ${id} not found`);
  const validation = validateEventDefinition(row.definition, validationContext(db));
  db.update(eventDefinitions).set({ validation: { errors: validation.errors, warnings: validation.warnings }, updatedAt: nowIso() }).where(eq(eventDefinitions.id, id)).run();
  if (validation.valid && row.status === "draft") return { row: setStatus(db, id, "validated", "Passed validation"), validation };
  if (!validation.valid && row.status !== "draft") return { row: setStatus(db, id, "draft", "Failed re-validation"), validation };
  return { row: getEventDefinition(db, id)!, validation };
}

/** Publish a validated definition. New runs will include it; existing runs keep their frozen content. */
export function publishDefinition(db: Db, id: string): DefinitionRow {
  const row = getEventDefinition(db, id);
  if (!row) throw new ContentError(`Event ${id} not found`);
  if (row.status !== "validated") throw new ContentError(`Only validated definitions can be published (status is ${row.status})`);
  const validation = validateEventDefinition(row.definition, validationContext(db));
  if (!validation.valid) throw new ContentError("Definition no longer passes validation", validation);
  return setStatus(db, id, "published", "Published");
}

export function archiveDefinition(db: Db, id: string): DefinitionRow {
  if (!getEventDefinition(db, id)) throw new ContentError(`Event ${id} not found`);
  return setStatus(db, id, "archived", "Archived / rejected");
}

export function listStorylines(db: Db): Storyline[] {
  return db.select().from(storylines).orderBy(asc(storylines.id)).all().map((r) => r.definition as Storyline);
}

export function getStoryline(db: Db, id: string): Storyline | null {
  const row = db.select().from(storylines).where(eq(storylines.id, id)).get();
  return row ? (row.definition as Storyline) : null;
}

export function saveStoryline(db: Db, raw: unknown): ValidationResult<Storyline> {
  const validation = validateStoryline(raw, validationContext(db));
  if (!validation.valid || !validation.value) return validation;
  const s = validation.value;
  db.insert(storylines)
    .values({ id: s.id, status: s.status, definition: s, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: storylines.id, set: { status: s.status, definition: s, updatedAt: nowIso() } })
    .run();
  return validation;
}

/** The content bundle a NEW run would be frozen with. */
export function currentPublishedBundle(db: Db): ContentBundle {
  const events = listEventDefinitions(db).filter((r) => r.status === "published").map((r) => r.definition);
  const lines = listStorylines(db).filter((s) => s.status === "published");
  return makeContentBundle(events, lines);
}

/** Import file-based seed content. Seed definitions are published; local edits to non-seed content are untouched. */
export function importSeedContent(db: Db, content: { events: EventDefinition[]; storylines: Storyline[] }) {
  let created = 0;
  let updated = 0;
  for (const s of content.storylines) saveStoryline(db, s);
  for (const def of content.events) {
    const existing = getEventDefinition(db, def.id);
    if (existing && existing.source !== "seed") continue;
    const { status: _s, version: _v, ...comparableNew } = def;
    if (existing) {
      const { status: _es, version: _ev, ...comparableOld } = existing.definition;
      if (JSON.stringify(comparableOld) === JSON.stringify(comparableNew) && existing.status === "published") continue;
    }
    const { row } = saveEventDefinition(db, def, { source: "seed", note: "Imported from content/events" });
    if (!row) continue;
    validateStoredDefinition(db, def.id);
    publishDefinition(db, def.id);
    if (existing) updated++;
    else created++;
  }
  return { created, updated };
}

export function recordAiGeneration(db: Db, input: typeof aiGenerations.$inferInsert) {
  return db.insert(aiGenerations).values(input).returning().get();
}

export function listAiGenerations(db: Db, limit = 20) {
  return db.select().from(aiGenerations).orderBy(desc(aiGenerations.id)).limit(limit).all();
}
