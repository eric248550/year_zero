import { z } from "zod";
import { setChoiceOverride } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return handle(() => {
    const { definitionId, choiceId } = z.object({ definitionId: z.string(), choiceId: z.string().nullable() }).parse(body);
    return { overrides: setChoiceOverride(db(), id, definitionId, choiceId) };
  });
}
