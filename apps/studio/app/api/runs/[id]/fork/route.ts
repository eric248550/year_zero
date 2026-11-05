import { z } from "zod";
import { POLICIES } from "@genesis/schemas";
import { forkRun } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

const Fork = z.object({
  tick: z.number().int().min(0),
  name: z.string().max(80).optional(),
  policy: z.enum(POLICIES).optional(),
  reseed: z.number().int().min(0).max(2_147_483_647).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return handle(() => {
    const { tick, ...options } = Fork.parse(body);
    return forkRun(db(), id, tick, options);
  });
}
