export interface GenerationContext {
  /** World Bible markdown (lore, tone, rules for authors). */
  worldBible: string;
  storylines: { id: string; title: string; summary: string }[];
  existingEventIds: string[];
}

export interface GenerateRequest {
  prompt: string;
  context: GenerationContext;
}

export interface GenerateResult {
  provider: string;
  model: string;
  /** True when content came from the deterministic template generator, not a model. */
  isMock: boolean;
  rawText: string;
  parsed: unknown | null;
  parseError: string | null;
}

/** Replaceable model adapter. Implementations must run server-side only. */
export interface EventDraftProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly isMock: boolean;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
