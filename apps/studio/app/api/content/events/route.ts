import { z } from "zod";
import { ConflictError, getEventDefinition, saveEventDefinition } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

const Save = z.object({
  definition: z.unknown(),
  expectedId: z.string().optional(),
  source: z.string().max(120).optional(),
  note: z.string().max(400).optional(),
  create: z.boolean().optional(),
});

/** Create or update a definition. Always stored as a draft; returns validation results. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(() => {
    const input = Save.parse(body);
    const id = (input.definition as { id?: unknown } | null)?.id;
    if (input.create && typeof id === "string" && getEventDefinition(db(), id)) throw new ConflictError(`An event with id "${id}" already exists`);
    const { row, validation } = saveEventDefinition(db(), input.definition, { expectedId: input.expectedId, source: input.source, note: input.note });
    return { saved: row !== null, id: row?.id ?? null, status: row?.status ?? null, validation };
  });
}
