import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockProvider, extractJsonObject, generateEventDraft, resolveProviders, buildSystemPrompt, type EventDraftProvider } from "@genesis/ai";
import { CONTENT_DIR, seedContent } from "./helpers";

const context = {
  worldBible: readFileSync(join(CONTENT_DIR, "world-bible/world-bible.md"), "utf8"),
  storylines: seedContent.storylines.map((s) => ({ id: s.id, title: s.title, summary: s.summary })),
  existingEventIds: seedContent.events.map((e) => e.id),
};
const ctx = { knownEventIds: new Set(context.existingEventIds), knownStorylineIds: new Set(seedContent.storylines.map((s) => s.id)) };

describe("AI event generation", () => {
  it("works without an API key: no real provider, mock clearly labelled", () => {
    const p = resolveProviders({});
    expect(p.real).toBeNull();
    expect(p.mock.isMock).toBe(true);
    expect(p.status.reason).toMatch(/No AI provider/);
    expect(resolveProviders({ ANTHROPIC_API_KEY: "sk-test" }).real?.id).toBe("anthropic");
    expect(resolveProviders({ ANTHROPIC_API_KEY: "sk-test", GENESIS_AI_PROVIDER: "mock" }).real).toBeNull();
  });

  it.each([
    "Generate a water contamination event for the early rebuilding stage",
    "A crop failure event for surface farms",
    "Something mysterious about the forgotten bunker",
    "A social event about trade",
  ])("mock drafts pass validation and are stored as drafts: %s", async (prompt) => {
    const out = await generateEventDraft(new MockProvider(), { prompt, context }, ctx);
    expect(out.validation.errors).toEqual([]);
    expect(out.generation.isMock).toBe(true);
    expect((out.candidate as { status: string }).status).toBe("draft");
    expect((out.candidate as { source: string }).source).toMatch(/^mock:/);
  });

  it("invalid model output is caught by validation, never accepted", async () => {
    const rogue: EventDraftProvider = {
      id: "rogue", label: "rogue", model: "x", isMock: false,
      generate: async () => ({ provider: "rogue", model: "x", isMock: false, rawText: "", parseError: null, parsed: {
        id: "rogue-event", title: "Rogue", scope: "settlement", category: "social", description: "d",
        narrative: { headline: "h", text: "t" }, status: "published",
        effects: [{ type: "SET_POPULATION", value: 1_000_000 }, { type: "UNLOCK_TECHNOLOGY", tech: "fusion" }],
      } }),
    };
    const out = await generateEventDraft(rogue, { prompt: "x", context }, ctx);
    expect(out.validation.valid).toBe(false);
    expect(out.validation.errors.map((e) => e.code)).toContain("effect.unsupported");
    expect((out.candidate as { status: string }).status).toBe("draft");
  });

  it("extracts JSON from fenced model output and reports unparseable output", () => {
    expect(extractJsonObject("Here:\n```json\n{\"a\":1}\n```").value).toEqual({ a: 1 });
    expect(extractJsonObject("no json here").error).toMatch(/No JSON/);
  });

  it("the system prompt carries the World Bible, catalog and allowed actions", () => {
    const sys = buildSystemPrompt(context);
    expect(sys).toContain("Project Halcyon");
    expect(sys).toContain("UNLOCK_TECHNOLOGY");
    expect(sys).toContain("water_purification");
  });
});
