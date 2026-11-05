import { clearQueuedActions, queueAction } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await readJson(req);
  return handle(() => ({ queue: queueAction(db(), id, body.action) }));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => clearQueuedActions(db(), id));
}
