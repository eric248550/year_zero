import type { EventScope, HistoricalEvent, Importance, Rng, StateChange, WorldState } from "@genesis/schemas";
import { allocateHistoryId, currentYear } from "@genesis/narrative";

type HistoryCategory = HistoricalEvent["category"];

/** Mutable per-tick working context shared by the systems. */
export class TickContext {
  readonly events: HistoricalEvent[] = [];
  /** Per-settlement unmet need ratio (0..1) from this tick's consumption, used by mortality. */
  readonly deficits = new Map<string, { food: number; water: number }>();
  births = 0;
  deaths = 0;

  constructor(public state: WorldState, public readonly rng: Rng) {}

  /** Record a system-generated historical event (rules, not narrative content). */
  system(input: {
    category: HistoryCategory;
    importance: Importance;
    title: string;
    text: string;
    scope?: EventScope;
    settlementIds?: string[];
    characterIds?: string[];
    causeIds?: string[];
    changes?: StateChange[];
    summary?: string;
  }): HistoricalEvent {
    const event: HistoricalEvent = {
      id: allocateHistoryId(this.state),
      tick: this.state.tick,
      year: currentYear(this.state),
      kind: "system",
      definitionId: null,
      definitionVersion: null,
      category: input.category,
      scope: input.scope ?? (input.settlementIds?.length ? "settlement" : "world"),
      importance: input.importance,
      title: input.title,
      text: input.text,
      settlementIds: input.settlementIds ?? [],
      characterIds: input.characterIds ?? [],
      storylineIds: [],
      causeIds: input.causeIds ?? [],
      parentId: null,
      trigger: input.summary ? { summary: input.summary, chance: null, roll: null, priority: null, conditions: [], roles: {} } : null,
      choice: null,
      changes: input.changes ?? [],
    };
    this.events.push(event);
    return event;
  }
}
