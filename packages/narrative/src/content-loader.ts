import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EventDefinition, Storyline } from "@genesis/schemas";
import { validateEventDefinition, validateStoryline, type ValidationIssue } from "./validation";

export interface LoadedContent {
  events: EventDefinition[];
  storylines: Storyline[];
  problems: { file: string; errors: ValidationIssue[] }[];
}

function readJsonFiles(dir: string): { file: string; data: unknown }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: join(dir, f), data: JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown }));
}

/** Load and validate the file-based seed content (content/events, content/storylines). */
export function loadContentDir(contentDir: string): LoadedContent {
  const problems: LoadedContent["problems"] = [];
  const storylineFiles = readJsonFiles(join(contentDir, "storylines"));
  const eventFiles = readJsonFiles(join(contentDir, "events"));
  const knownStorylineIds = new Set(storylineFiles.map((f) => (f.data as { id?: string }).id ?? ""));
  const knownEventIds = new Set(eventFiles.map((f) => (f.data as { id?: string }).id ?? ""));
  const ctx = { knownEventIds, knownStorylineIds };

  const storylines: Storyline[] = [];
  for (const f of storylineFiles) {
    const r = validateStoryline(f.data, ctx);
    if (r.valid && r.value) storylines.push(r.value);
    else problems.push({ file: f.file, errors: r.errors });
  }
  const events: EventDefinition[] = [];
  for (const f of eventFiles) {
    const r = validateEventDefinition(f.data, ctx);
    if (r.valid && r.value) events.push(r.value);
    else problems.push({ file: f.file, errors: r.errors });
  }
  return { events, storylines, problems };
}

export { makeContentBundle } from "./bundle";
