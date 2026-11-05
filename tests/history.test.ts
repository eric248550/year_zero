import { describe, expect, it } from "vitest";
import { EFFECT_TYPES, Rng, type HistoricalEvent } from "@genesis/schemas";
import { executeEvent } from "@genesis/narrative";
import { createWorld, stepWorld } from "@genesis/simulation";
import { def, seedContent } from "./helpers";

describe("immutable history", () => {
  it("there is no effect type capable of editing or deleting history", () => {
    expect(EFFECT_TYPES.filter((t) => /HISTOR/.test(t))).toEqual(["CREATE_HISTORICAL_EVENT"]);
    expect(EFFECT_TYPES.some((t) => /DELETE|EDIT|UPDATE|REWRITE/.test(t))).toBe(false);
  });

  it("CREATE_HISTORICAL_EVENT appends a new linked record instead of modifying anything", () => {
    const w = createWorld({ seed: 1 });
    const d = def({ id: "chronicle", effects: [{ type: "CREATE_HISTORICAL_EVENT", title: "A chronicle", description: "Something notable", importance: "major" }] });
    const r = executeEvent(w, d, "s-haven", new Rng(1), { chance: 1, roll: 0 });
    expect(r.events).toHaveLength(2);
    const [parent, child] = r.events as [HistoricalEvent, HistoricalEvent];
    expect(child.parentId).toBe(parent.id);
    expect(child.causeIds).toEqual([parent.id]);
    expect(child.id).not.toBe(parent.id);
  });

  it("events committed earlier are never altered by later ticks", () => {
    let w = createWorld({ seed: 2 });
    const committed: HistoricalEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const r = stepWorld(w, { events: seedContent.events });
      committed.push(...r.events);
      w = r.state;
    }
    const frozen = structuredClone(committed);
    for (let i = 0; i < 30; i++) w = stepWorld(w, { events: seedContent.events }).state;
    expect(committed).toEqual(frozen);
    expect(new Set(committed.map((e) => e.id)).size).toBe(committed.length);
    // History ids are monotonic: the counter only moves forward.
    const nums = committed.map((e) => Number(e.id.slice(1)));
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });
});
