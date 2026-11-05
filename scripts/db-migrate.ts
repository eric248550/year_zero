import "./env";
import { migrateDb, openDb, resolveDbPath } from "@genesis/database";

const path = resolveDbPath();
const db = openDb(path);
migrateDb(db);
console.log(`✓ Migrations applied to ${path}`);
