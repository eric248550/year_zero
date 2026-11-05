/** Load the repository-root .env (if present) so CLI scripts share the Studio's configuration. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(import.meta.dirname, "../.env");
if (existsSync(file)) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* malformed .env: fall back to defaults */
  }
}
