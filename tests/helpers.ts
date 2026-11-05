import { resolve } from "node:path";
import { loadContentDir } from "@genesis/narrative/node";
import type { EventDefinition, EventDefinitionInput } from "@genesis/schemas";
import { EventDefinitionSchema } from "@genesis/schemas";

export const CONTENT_DIR = resolve(import.meta.dirname, "../content");
export const seedContent = loadContentDir(CONTENT_DIR);

export function def(input: Partial<EventDefinitionInput> & { id: string }): EventDefinition {
  return EventDefinitionSchema.parse({
    title: input.id,
    scope: "settlement",
    category: "social",
    description: "test event",
    narrative: { headline: "Test {{settlement}}", text: "Test event text" },
    status: "published",
    chance: 1,
    cooldown: 0,
    ...input,
  });
}
