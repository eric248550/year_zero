import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import { NextResponse } from "next/server";
import {
  ConflictError,
  ContentError,
  NotFoundError,
  findRepoRoot,
  getActiveRunId,
  getDb,
  getRun,
  listEventDefinitions,
  listStorylines,
} from "@genesis/database";
import { ProviderError, resolveProviders } from "@genesis/ai";

export const db = () => getDb();

/** Active run with its head state, or null when no run exists yet. */
export function loadActiveRun() {
  const d = db();
  const id = getActiveRunId(d);
  if (!id) return null;
  return getRun(d, id);
}

export function contentStats() {
  const defs = listEventDefinitions(db());
  return {
    total: defs.length,
    published: defs.filter((d) => d.status === "published").length,
    drafts: defs.filter((d) => d.status === "draft" || d.status === "validated").length,
    storylines: listStorylines(db()).length,
  };
}

export function worldBible(): string {
  try {
    return readFileSync(join(findRepoRoot(), "content/world-bible/world-bible.md"), "utf8");
  } catch {
    return "";
  }
}

export function contentDir(): string {
  return join(findRepoRoot(), "content");
}

export function aiStatus() {
  return resolveProviders().status;
}

/** Wrap a route handler: maps domain errors to HTTP status codes with JSON bodies. */
export async function handle(fn: () => unknown | Promise<unknown>) {
  try {
    const result = await fn();
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof ConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof ContentError) return NextResponse.json({ error: err.message, validation: err.validation ?? null }, { status: 409 });
    if (err instanceof RangeError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message, retryable: err.retryable }, { status: 502 });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
