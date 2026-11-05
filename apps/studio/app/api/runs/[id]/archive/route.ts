import { archiveRun } from "@genesis/database";
import { db, handle } from "@/lib/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => archiveRun(db(), id));
}
