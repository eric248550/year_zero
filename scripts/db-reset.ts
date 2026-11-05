import "./env";
/** Delete the local SQLite database (all runs and content), then migrate and seed again. */
import { rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveDbPath } from "@genesis/database";

const path = resolveDbPath();
for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
console.log(`✓ Removed ${path}`);
execSync("pnpm -s db:migrate && pnpm -s db:seed", { stdio: "inherit" });
