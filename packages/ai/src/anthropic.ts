import Anthropic from "@anthropic-ai/sdk";
import { extractJsonObject } from "./json";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { ProviderError, type EventDraftProvider, type GenerateRequest, type GenerateResult } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/**
 * Claude via the official Anthropic SDK. Server-side only: the API key is read
 * from the environment and never sent to the browser.
 */
export class AnthropicProvider implements EventDraftProvider {
  readonly id = "anthropic";
  readonly isMock = false;
  readonly label: string;
  private readonly client: Anthropic;

  constructor(readonly model: string = DEFAULT_ANTHROPIC_MODEL, apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
    this.label = `Anthropic · ${model}`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    let response;
    try {
      // Streaming avoids HTTP timeouts on long generations; finalMessage() collects the result.
      response = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: 16000,
          system: buildSystemPrompt(request.context),
          messages: [{ role: "user", content: buildUserPrompt(request.prompt) }],
          output_config: { effort: "medium" },
          // If a safety classifier declines, the API re-runs the request on a fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.");
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic rate limit reached (429). Try again shortly.", true);
      if (err instanceof Anthropic.BadRequestError) throw new ProviderError(`Anthropic rejected the request: ${err.message}`);
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("Could not reach the Anthropic API (network error).", true);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error (${err.status ?? "unknown"}): ${err.message}`, (err.status ?? 0) >= 500);
      throw err;
    }

    if (response.stop_reason === "refusal") {
      throw new ProviderError("The model declined this request. Rephrase the prompt and try again.");
    }
    const rawText = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    const { value, error } = extractJsonObject(rawText);
    const truncated = response.stop_reason === "max_tokens" ? " (output was truncated at max_tokens)" : "";
    return {
      provider: this.id,
      model: response.model ?? this.model,
      isMock: false,
      rawText,
      parsed: value,
      parseError: error ? error + truncated : null,
    };
  }
}
