import { z } from "zod";
import { getRun, renameRun } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => getRun(db(), id).summary);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await readJson(req);
  return handle(() => renameRun(db(), id, z.object({ name: z.string().min(1).max(80) }).parse(body).name));
}
