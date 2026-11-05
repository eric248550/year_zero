import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Walk up from `start` to the directory containing pnpm-workspace.yaml. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function resolveDbPath(): string {
  const configured = process.env.GENESIS_DB_PATH || "data/genesis.db";
  if (configured === ":memory:") return configured;
  return isAbsolute(configured) ? configured : join(findRepoRoot(), configured);
}

export function migrationsFolder(): string {
  return join(findRepoRoot(), "packages/database/migrations");
}

export function openDb(path = resolveDbPath()): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema }) as Db;
}

export function migrateDb(db: Db): void {
  migrate(db, { migrationsFolder: migrationsFolder() });
}

const globalForDb = globalThis as unknown as { __genesisDb?: Db };

/** Process-wide connection (survives Next.js dev hot reloads). Migrations are applied on first open. */
export function getDb(): Db {
  if (!globalForDb.__genesisDb) {
    const db = openDb();
    migrateDb(db);
    globalForDb.__genesisDb = db;
  }
  return globalForDb.__genesisDb;
}

export function nowIso(): string {
  return new Date().toISOString();
}
