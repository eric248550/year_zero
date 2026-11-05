import { z } from "zod";
import { generateEventDraft, resolveProviders } from "@genesis/ai";
import { listEventDefinitions, listStorylines, recordAiGeneration, validationContext } from "@genesis/database";
import { nowIso } from "@genesis/database";
import { db, handle, readJson, worldBible } from "@/lib/server";

const Generate = z.object({
  prompt: z.string().trim().min(8, "Describe the event in a sentence or two").max(2000),
  mode: z.enum(["model", "mock"]),
});

/**
 * Generate a draft. Nothing is saved to the content library here — the
 * developer must explicitly approve the draft (which stores it as `draft`).
 * The generation attempt itself is logged for provenance.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(async () => {
    const { prompt, mode } = Generate.parse(body);
    const { real, mock, status } = resolveProviders();
    if (mode === "model" && !real) throw new RangeError(`No AI model configured: ${status.reason}`);
    const provider = mode === "model" ? real! : mock;
    const context = {
      worldBible: worldBible(),
      storylines: listStorylines(db()).map((s) => ({ id: s.id, title: s.title, summary: s.summary })),
      existingEventIds: listEventDefinitions(db()).map((d) => d.id),
    };
    try {
      const outcome = await generateEventDraft(provider, { prompt, context }, validationContext(db()));
      recordAiGeneration(db(), {
        prompt,
        provider: outcome.generation.provider,
        model: outcome.generation.model,
        isMock: outcome.generation.isMock,
        rawOutput: outcome.generation.rawText.slice(0, 100_000),
        definitionId: (outcome.candidate as { id?: string } | null)?.id ?? null,
        outcome: outcome.validation.valid ? "valid" : "invalid",
        errors: outcome.validation.errors,
        createdAt: nowIso(),
      });
      return outcome;
    } catch (err) {
      recordAiGeneration(db(), { prompt, provider: provider.id, model: provider.model, isMock: provider.isMock, rawOutput: null, definitionId: null, outcome: "error", errors: [{ message: (err as Error).message }], createdAt: nowIso() });
      throw err;
    }
  });
}
