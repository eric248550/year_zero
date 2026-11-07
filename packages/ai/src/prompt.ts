import { z } from "zod";
import {
  CHOICE_TAGS,
  EFFECT_TYPES,
  EVENT_CATEGORIES,
  EventDefinitionSchema,
  LOCATIONS,
  PROFESSIONS,
  RESOURCES,
  SECRETS,
  TECHNOLOGIES,
  ZH_CATALOG,
} from "@genesis/schemas";
import type { GenerationContext } from "./types";

let cachedSchema: string | null = null;
function eventJsonSchema(): string {
  cachedSchema ??= JSON.stringify(z.toJSONSchema(EventDefinitionSchema, { io: "input" }));
  return cachedSchema;
}

/** System prompt: lore + closed vocabulary + schema. The model may only use what is listed here. */
export function buildSystemPrompt(ctx: GenerationContext): string {
  const catalog = {
    resources: RESOURCES,
    professions: PROFESSIONS,
    technologies: TECHNOLOGIES.map((t) => ({ id: t.id, name: t.name, branch: t.branch, tier: t.tier, prerequisites: t.prerequisites })),
    locations: LOCATIONS.map((l) => ({ id: l.id, name: l.name, settleable: l.settleable, hiddenUntilRevealedByEvent: l.hidden })),
    secrets: SECRETS.map((s) => ({ id: s.id, title: s.title })),
    choiceTags: CHOICE_TAGS,
    categories: EVENT_CATEGORIES,
    allowedEffectTypes: EFFECT_TYPES,
    storylines: ctx.storylines,
    existingEventIds: ctx.existingEventIds,
  };
  return [
    "You are a narrative designer for Genesis, a deterministic post-apocalyptic civilization simulation.",
    "You write storylet-style EVENT DEFINITIONS: things that MAY happen when preconditions hold. A deterministic engine decides whether and when they fire and applies their effects. You never change world state directly.",
    "",
    "Hard rules:",
    "- Output exactly ONE JSON object matching the schema below. No prose before or after it.",
    "- Use ONLY ids listed in the catalog (technologies, locations, secrets, storylines). Never invent new ids for them.",
    "- Use ONLY the allowed effect types. There is no way to run code, edit history, or delete records.",
    "- Secrets may only be revealed with REVEAL_SECRET; never write flags starting with 'secret.' or 'system.'.",
    "- Gate events on technology preconditions when they depend on infrastructure.",
    "- Roles are filled by living characters in the target settlement; reference roles in templates as {{roleId}}. Other placeholders: {{settlement}}, {{year}}, {{world}}, {{choice}}.",
    "- Keep resource swings proportional: a settlement of ~20 people uses ~20 food and ~20 water per year.",
    "- Give 2-3 choices with genuine trade-offs, tagged with values from choiceTags.",
    "- Use a new kebab-case id that is not in existingEventIds. Set status to \"draft\".",
    "- Write every player-facing string (title, description, narrative headline/text, choice labels/descriptions/outcomes, risk descriptions, life-event texts, causes of death, historical event titles/descriptions) in Traditional Chinese as used in Taiwan, with full-width punctuation. Keep ids, flags, tags and {{placeholders}} exactly as they are.",
    "- Use these Chinese names for places, secrets and professions:",
    JSON.stringify({ locations: ZH_CATALOG.locationName, secrets: ZH_CATALOG.secretTitle, professions: ZH_CATALOG.profession }),
    "",
    "## Catalog",
    JSON.stringify(catalog, null, 1),
    "",
    "## EventDefinition JSON Schema",
    eventJsonSchema(),
    "",
    "## World Bible",
    ctx.worldBible,
  ].join("\n");
}

export function buildUserPrompt(prompt: string): string {
  return `Developer request:\n${prompt.trim()}\n\nReturn only the JSON event definition.`;
}
