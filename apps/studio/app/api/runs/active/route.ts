import { z } from "zod";
import { setActiveRunId } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

export async function POST(req: Request) {
  const { id } = z.object({ id: z.string().min(1) }).parse(await readJson(req));
  return handle(() => setActiveRunId(db(), id));
}
