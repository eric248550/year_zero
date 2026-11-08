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

  /** True inside stepWorld; false for a player acting between years. */
  inTick = false;
  private committed: Map<string, number> | null = null;

  constructor(public state: WorldState, public readonly rng: Rng) {}

  /** The first season not yet lived: this year's spring inside a tick, the coming spring between ticks. */
  get season(): number {
    return (this.inTick ? this.state.tick : this.state.tick + 1) * 4;
  }

  /** Share of this year a person has left after the work they have committed to. */
  freeShare(characterId: string): number {
    if (!this.committed) {
      this.committed = new Map();
      const from = this.state.tick * 4;
      const to = from + 4;
      for (const a of this.state.activities ?? []) {
        const n = Math.max(0, Math.min(to, a.dueSeason + 1) - Math.max(from, a.startSeason));
        if (n > 0) this.committed.set(a.characterId, (this.committed.get(a.characterId) ?? 0) + n);
      }
    }
    return Math.max(0, 1 - (this.committed.get(characterId) ?? 0) / 4);
  }

  /** Commitments changed: recount next time. */
  forgetCommitments(): void {
    this.committed = null;
  }

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
