import { hashString } from "@genesis/schemas";
import type { EventDraftProvider, GenerateRequest, GenerateResult } from "./types";

type Template = (slug: string, prompt: string) => Record<string, unknown>;

const templates: { keywords: RegExp; build: Template }[] = [
  {
    keywords: /water|well|contaminat|thirst|drought|river/i,
    build: (id) => ({
      id, title: "Tainted Cistern", scope: "settlement", category: "health",
      description: "A storage cistern is found contaminated after heavy rain washes ash into it.",
      preconditions: [
        { type: "technology", tech: "water_purification", has: false },
        { type: "resource", resource: "water", op: ">=", value: 10, scope: "target" },
        { type: "world_tick", op: ">=", value: 2 },
      ],
      roles: [{ id: "medic", profession: "Medic", minAge: 16, optional: true }, { id: "engineer", profession: "Engineer", minAge: 16 }],
      effects: [{ type: "ADJUST_RESOURCE", resource: "water", amount: -15 }],
      choices: [
        { id: "drain", label: "Drain and scrub the cistern", tags: ["cautious", "industry"], costs: { materials: 10 }, effects: [{ type: "CHANGE_SETTLEMENT_STAT", stat: "health", delta: 3 }], outcome: "{{engineer}} leads the crews into the cistern with brushes and lye." },
        { id: "treat", label: "Treat the sick and keep drinking", tags: ["bold", "community"], requiresRoles: ["medic"], effects: [{ type: "CHANGE_SETTLEMENT_STAT", stat: "health", delta: -6 }, { type: "ADD_LIFE_EVENT", role: "medic", text: "Treated the cistern sickness" }], outcome: "{{medic}} keeps the sick alive while the water slowly clears." },
      ],
      priority: 6, chance: 0.25, cooldown: 8, storylineIds: ["first-water-crisis"], importance: "notable",
      narrative: { headline: "Ash in the cistern of {{settlement}}", text: "After the spring rains, the water in {{settlement}}'s cistern turned grey and bitter." },
      status: "draft",
    }),
  },
  {
    keywords: /food|harvest|crop|famine|seed|blight|farm/i,
    build: (id) => ({
      id, title: "Locust Swarm", scope: "settlement", category: "resource",
      description: "A swarm of insects descends on surface fields.",
      preconditions: [{ type: "settlement_kind", kind: "settlement" }, { type: "world_tick", op: ">=", value: 5 }],
      roles: [{ id: "scout", profession: "Scout", minAge: 16, optional: true }],
      effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: -20 }],
      choices: [
        { id: "smoke", label: "Smoke the fields", tags: ["cautious"], costs: { materials: 8 }, effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 10 }], outcome: "Smudge fires burn along every row." },
        { id: "harvest_early", label: "Harvest early", tags: ["bold", "growth"], effects: [{ type: "ADJUST_RESOURCE", resource: "food", amount: 6 }, { type: "CHANGE_SETTLEMENT_STAT", stat: "morale", delta: -3 }], outcome: "Green grain is cut before the swarm can take it." },
      ],
      priority: 5, chance: 0.15, cooldown: 10, storylineIds: ["rebuilding-food-production"], importance: "notable",
      narrative: { headline: "Locusts over {{settlement}}", text: "The sky over {{settlement}} hummed for three days." },
      status: "draft",
    }),
  },
  {
    keywords: /bunker|vault|signal|mystery|secret|halcyon|forgotten/i,
    build: (id) => ({
      id, title: "Message in the Wall", scope: "settlement", category: "mystery",
      description: "Workers find a sealed capsule behind a bunker wall panel.",
      preconditions: [{ type: "settlement_kind", kind: "bunker" }, { type: "flag", flag: "mystery.signal_heard", present: true }],
      roles: [{ id: "finder", minAge: 16 }],
      effects: [{ type: "ADD_LIFE_EVENT", role: "finder", text: "Found the capsule behind the wall" }],
      choices: [
        { id: "open", label: "Open it publicly", tags: ["openness", "community"], effects: [{ type: "ADD_WORLD_FLAG", flag: "mystery.capsule_opened" }, { type: "ADJUST_RESOURCE", resource: "knowledge", amount: 8 }], outcome: "The capsule holds a list of coordinates and a single word: HALCYON." },
        { id: "hide", label: "Give it to the archivists", tags: ["secrecy", "science"], effects: [{ type: "ADD_WORLD_FLAG", flag: "mystery.capsule_hidden" }], outcome: "The capsule disappears into the archive." },
      ],
      priority: 4, chance: 0.2, cooldown: 0, maxOccurrences: 1, storylineIds: ["the-forgotten-bunker"], importance: "notable",
      narrative: { headline: "A capsule behind the wall of {{settlement}}", text: "Replacing a corroded panel, {{finder}} found a steel capsule welded into the wall." },
      status: "draft",
    }),
  },
];

const fallback: Template = (id) => ({
  id, title: "Travelling Trader", scope: "settlement", category: "social",
  description: "A lone trader arrives from beyond the known ruins.",
  preconditions: [{ type: "world_tick", op: ">=", value: 3 }],
  roles: [{ id: "host", minAge: 18 }],
  effects: [],
  choices: [
    { id: "trade", label: "Trade materials for knowledge", tags: ["science", "openness"], costs: { materials: 10 }, effects: [{ type: "ADJUST_RESOURCE", resource: "knowledge", amount: 12 }], outcome: "{{host}} trades scrap for a box of water-damaged manuals." },
    { id: "turn_away", label: "Turn the trader away", tags: ["cautious", "secrecy"], effects: [{ type: "CHANGE_SETTLEMENT_STAT", stat: "morale", delta: -2 }], outcome: "The trader shrugs and walks on." },
  ],
  priority: 3, chance: 0.15, cooldown: 6, storylineIds: [], importance: "minor",
  narrative: { headline: "A trader at the gates of {{settlement}}", text: "A stranger with a handcart appeared at {{settlement}} at dusk, asking to trade." },
  status: "draft",
});

/**
 * DETERMINISTIC MOCK — not a language model. Picks a hand-written template by
 * keyword so the generator → validate → review → publish flow can be exercised
 * without an API key. Always reported with isMock: true.
 */
export class MockProvider implements EventDraftProvider {
  readonly id = "mock";
  readonly label = "Deterministic mock (no AI model)";
  readonly model = "template-generator-v1";
  readonly isMock = true;

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const suffix = hashString(request.prompt).slice(-5);
    const t = templates.find((x) => x.keywords.test(request.prompt))?.build ?? fallback;
    const draft = t(`mock-draft`, request.prompt);
    let id = `${String(draft.title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`;
    while (request.context.existingEventIds.includes(id)) id += "x";
    const parsed = { ...draft, id };
    return {
      provider: this.id,
      model: this.model,
      isMock: true,
      rawText: JSON.stringify(parsed, null, 2),
      parsed,
      parseError: null,
    };
  }
}
