import { describe, expect, it } from "vitest";
import { ADULT_AGE } from "@genesis/schemas";
import { characterAge, ageAt } from "@genesis/narrative";
import { createWorld, stepWorld } from "@genesis/simulation";
import { seedContent } from "./helpers";

describe("aging and death", () => {
  it("ages characters by exactly one year per tick, independent of wall-clock time", () => {
    let w = createWorld({ seed: 21 });
    const initial = new Map(w.characters.map((c) => [c.id, characterAge(w, c)]));
    for (let i = 0; i < 10; i++) w = stepWorld(w, { events: [] }).state;
    for (const c of w.characters) {
      if (!initial.has(c.id)) continue;
      const expected = c.deathTick === null ? initial.get(c.id)! + 10 : initial.get(c.id)! + (c.deathTick - 0);
      expect(characterAge(w, c)).toBe(expected);
      expect(characterAge(w, c)).toBe(ageAt(c, w.tick));
    }
  });

  it("dead characters stop aging and keep their death record", () => {
    let w = createWorld({ seed: 22 });
    const victim = w.characters[0]!;
    victim.deathTick = 0;
    victim.causeOfDeath = "test";
    const ageAtDeath = characterAge(w, victim);
    for (let i = 0; i < 5; i++) w = stepWorld(w, { events: [] }).state;
    const after = w.characters.find((c) => c.id === victim.id)!;
    expect(characterAge(w, after)).toBe(ageAtDeath);
    expect(after.deathTick).toBe(0);
  });

  it("children receive a profession when they come of age", () => {
    let w = createWorld({ seed: 23 });
    const child = w.characters.find((c) => c.profession === null)!;
    child.birthTick = -(ADULT_AGE - 1);
    w = stepWorld(w, { events: [] }).state;
    const grown = w.characters.find((c) => c.id === child.id)!;
    if (grown.deathTick === null) expect(grown.profession).not.toBeNull();
  });

  it("over a long run people die and are born, and nobody acts after death", () => {
    let w = createWorld({ seed: 24 });
    const actedAfterDeath: string[] = [];
    for (let i = 0; i < 80; i++) {
      const r = stepWorld(w, { events: seedContent.events });
      for (const e of r.events) {
        if (e.kind !== "narrative" || !e.trigger) continue;
        for (const id of Object.values(e.trigger.roles)) {
          const c = w.characters.find((x) => x.id === id);
          if (c && c.deathTick !== null) actedAfterDeath.push(`${id} in ${e.id}`);
        }
      }
      w = r.state;
    }
    expect(actedAfterDeath).toEqual([]);
    expect(w.stats.deaths).toBeGreaterThan(0);
    expect(w.stats.births).toBeGreaterThan(0);
  });
});
