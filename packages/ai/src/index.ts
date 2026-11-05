import { validateEventDefinition, type ValidationContext, type ValidationResult } from "@genesis/narrative";
import type { EventDefinition } from "@genesis/schemas";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { MockProvider } from "./mock";
import type { EventDraftProvider, GenerateRequest, GenerateResult } from "./types";

export * from "./types";
export { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
export { MockProvider } from "./mock";
export { buildSystemPrompt, buildUserPrompt } from "./prompt";
export { extractJsonObject } from "./json";

export interface ProviderStatus {
  /** The real model provider, or null if none is configured. */
  model: { id: string; label: string; model: string } | null;
  mockAvailable: true;
  reason: string;
}

/** Resolve providers from environment. Never throws; absence of a key is a normal state. */
export function resolveProviders(env: Record<string, string | undefined> = process.env): { real: EventDraftProvider | null; mock: EventDraftProvider; status: ProviderStatus } {
  const mock = new MockProvider();
  const choice = (env.GENESIS_AI_PROVIDER ?? "").trim().toLowerCase();
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (choice === "mock" || choice === "none") {
    return { real: null, mock, status: { model: null, mockAvailable: true, reason: `GENESIS_AI_PROVIDER=${choice}: model generation disabled` } };
  }
  if (key && (choice === "" || choice === "anthropic")) {
    const real = new AnthropicProvider(env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL, key);
    return { real, mock, status: { model: { id: real.id, label: real.label, model: real.model }, mockAvailable: true, reason: "ANTHROPIC_API_KEY configured" } };
  }
  return { real: null, mock, status: { model: null, mockAvailable: true, reason: choice === "anthropic" ? "GENESIS_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty" : "No AI provider configured (set ANTHROPIC_API_KEY)" } };
}

export interface DraftOutcome {
  generation: GenerateResult;
  validation: ValidationResult<EventDefinition>;
  /** The draft as it will be stored: forced to status=draft with provenance in `source`. */
  candidate: unknown | null;
}

/**
 * Pipeline steps 2–5: build context → generate → Zod structure → rule validation.
 * Never publishes; the caller stores the result as a draft for human review.
 */
export async function generateEventDraft(provider: EventDraftProvider, request: GenerateRequest, ctx: ValidationContext): Promise<DraftOutcome> {
  const generation = await provider.generate(request);
  if (generation.parsed === null || typeof generation.parsed !== "object") {
    return {
      generation,
      candidate: null,
      validation: { valid: false, value: null, errors: [{ path: "(root)", code: "generation.parse", message: generation.parseError ?? "No JSON produced" }], warnings: [] },
    };
  }
  const candidate = {
    ...(generation.parsed as Record<string, unknown>),
    status: "draft",
    version: 1,
    source: generation.isMock ? `mock:${generation.model}` : `ai:${generation.provider}:${generation.model}`,
  };
  const validation = validateEventDefinition(candidate, ctx);
  const id = (candidate as { id?: unknown }).id;
  if (typeof id === "string" && ctx.knownEventIds.has(id)) {
    validation.errors.push({ path: "id", code: "id.duplicate", message: `An event with id "${id}" already exists; rename it before saving` });
    validation.valid = false;
  }
  return { generation, candidate, validation };
}
