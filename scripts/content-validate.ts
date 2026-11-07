/** Validate every file under content/ and print errors and warnings. */
import { resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { validateBundle, validateEventDefinition } from "@genesis/narrative";
import { loadContentDir } from "@genesis/narrative/node";

const dir = resolve(import.meta.dirname, "../content");
const loaded = loadContentDir(dir);
const ctx = { knownEventIds: new Set(loaded.events.map((e) => e.id)), knownStorylineIds: new Set(loaded.storylines.map((s) => s.id)) };
let warnings = 0;
for (const f of readdirSync(resolve(dir, "events")).filter((f) => f.endsWith(".json"))) {
  const r = validateEventDefinition(JSON.parse(readFileSync(resolve(dir, "events", f), "utf8")), ctx);
  for (const w of r.warnings) { warnings++; console.log(`warn  ${f}: ${w.path} — ${w.message}`); }
  for (const e of r.errors) console.log(`ERROR ${f}: ${e.path} — ${e.message}`);
}
const bundle = validateBundle(loaded.events);
for (const w of bundle.warnings) { warnings++; console.log(`warn  (content): ${w.message}`); }
for (const e of bundle.errors) console.log(`ERROR (content): ${e.message}`);
console.log(`\n${loaded.events.length} events, ${loaded.storylines.length} storylines, ${loaded.problems.length} invalid files, ${warnings} warnings`);
process.exit(loaded.problems.length || bundle.errors.length ? 1 : 0);
