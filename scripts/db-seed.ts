import "./env";
/** Import file-based seed content and create a demo run (idempotent). */
import { resolve } from "node:path";
import { loadContentDir } from "@genesis/narrative/node";
import { createRun, importSeedContent, listRuns, migrateDb, openDb, resolveDbPath } from "@genesis/database";

const db = openDb(resolveDbPath());
migrateDb(db);
const content = loadContentDir(resolve(import.meta.dirname, "../content"));
if (content.problems.length) {
  console.error("Seed content failed validation:", JSON.stringify(content.problems, null, 2));
  process.exit(1);
}
const { created, updated } = importSeedContent(db, content);
console.log(`✓ Event definitions: ${created} created, ${updated} updated (${content.events.length} in content/events)`);
console.log(`✓ Storylines: ${content.storylines.length}`);
if (listRuns(db).length === 0) {
  const run = createRun(db, { name: "元年：第一道光", seed: 2131, policy: "balanced" });
  console.log(`✓ Created demo run ${run.id} (seed ${run.seed})`);
} else {
  console.log("• Runs already exist; no demo run created");
}
