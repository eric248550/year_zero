import { z } from "zod";
import { POLICIES, WORLD_LOCALES } from "@genesis/schemas";
import { createRun, listRuns } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

const CreateRun = z.object({
  seed: z.number().int().min(0).max(2_147_483_647),
  policy: z.enum(POLICIES).default("balanced"),
  name: z.string().max(80).optional(),
  locale: z.enum(WORLD_LOCALES).optional(),
});

export async function GET() {
  return handle(() => ({ runs: listRuns(db()) }));
}

export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(() => createRun(db(), CreateRun.parse(body)));
}
