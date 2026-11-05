import { z } from "zod";
import { MAX_TICKS_PER_CALL, stepRun } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return handle(() => stepRun(db(), id, z.object({ ticks: z.number().int().min(1).max(MAX_TICKS_PER_CALL) }).parse(body).ticks));
}
