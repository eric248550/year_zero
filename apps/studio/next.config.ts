import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Load the repository-root .env so the Studio and CLI scripts share one config file.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    /* ignore malformed .env; defaults apply */
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@genesis/schemas", "@genesis/narrative", "@genesis/simulation", "@genesis/database", "@genesis/ai"],
  serverExternalPackages: ["better-sqlite3"],
  typedRoutes: false,
  eslint: { ignoreDuringBuilds: true },
};

export default config;
