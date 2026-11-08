import { describe, expect, it } from "vitest";
import type { WorldState } from "@genesis/schemas";
import { evaluateCondition, rivalOf, tensionBetween, tensionKey } from "@genesis/narrative";
import { applyImmediate, checkInvariants, createWorld, playerCharacter, stepWorld } from "@genesis/simulation";
import { def, seedContent } from "./helpers";

const events = seedContent.events;

function withOutpost(seed: number): WorldState {
  let s = createWorld({ seed });
  for (let i = 0; i < 8 && s.settlements.filter((x) => x.status === "active").length < 2; i++) s = stepWorld(s, { events: [], actions: [] }).state;
  expect(s.settlements.filter((x) => x.status === "active").length).toBeGreaterThanOrEqual(2);
  return s;
}

describe("tension between settlements", () => {
  it("is read by the tension condition and changed by CHANGE_TENSION toward the rival", () => {
    let s = withOutpost(5);
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    s.tensions = { [tensionKey(a!.id, b!.id)]: 45 };
    expect(rivalOf(s, a!)?.id).toBe(b!.id);
    expect(evaluateCondition(s, { type: "tension", op: ">=", value: 40 }, { settlement: a! }).passed).toBe(true);
    expect(evaluateCondition(s, { type: "tension", op: ">=", value: 50 }, { settlement: a! }).passed).toBe(false);

    const ev = def({
      id: "feud", scope: "settlement", preconditions: [{ type: "tension", op: ">=", value: 40 }],
      narrative: { headline: "{{settlement}} and {{rival}}", text: "x" },
      choices: [{ id: "go", label: "Go", effects: [{ type: "CHANGE_TENSION", delta: 20 }] }],
    });
    const r = stepWorld(s, { events: [ev], actions: [] });
    const fired = r.events.find((e) => e.definitionId === "feud");
    expect(fired).toBeDefined();
    expect(fired!.changes.some((c) => c.path.startsWith("tensions."))).toBe(true);
    expect(fired!.title).not.toContain("{{rival}}");
  });

  it("stops aid and leads to raids when neighbours hate each other", () => {
    let s = withOutpost(9);
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    let raided = false, refused = false;
    for (let i = 0; i < 30 && !(raided && refused); i++) {
      s.tensions = { ...(s.tensions ?? {}), [tensionKey(a!.id, b!.id)]: 95 };
      // Starve one side so it is both refused and desperate.
      const poor = s.settlements.find((x) => x.id === b!.id)!;
      poor.supportedBy = null;
      poor.resources.food = 0;
      poor.shortage.food = Math.max(1, poor.shortage.food);
      s.settlements.find((x) => x.id === a!.id)!.resources.food = 1000;
      const r = stepWorld(s, { events, actions: [] });
      expect(checkInvariants(r.state, r.events)).toEqual([]);
      if (r.events.some((e) => e.title.includes("搶了") && e.settlementIds.includes(a!.id) && e.settlementIds.includes(b!.id))) raided = true;
      if (r.events.some((e) => e.title.includes("拒絕援助"))) refused = true;
      s = r.state;
      if (s.settlements.find((x) => x.id === b!.id)?.status !== "active") break;
    }
    expect(raided).toBe(true);
    expect(refused).toBe(true);
  });

  it("fades with time when nothing feeds it", () => {
    let s = withOutpost(13);
    const [a, b] = s.settlements.filter((x) => x.status === "active");
    s.tensions = { [tensionKey(a!.id, b!.id)]: 30 };
    // Nothing to feed it: no outpost to supply, both well stocked.
    for (let i = 0; i < 5; i++) {
      for (const x of s.settlements) { x.supportedBy = null; x.resources.food = 500; x.resources.water = 500; }
      s = stepWorld(s, { events: [], actions: [] }).state;
    }
    expect(tensionBetween(s, a!.id, b!.id)).toBeLessThan(40);
  });
});

describe("schisms", () => {
  it("split a crowded settlement; nobody moves a player", () => {
    let s = applyImmediate(createWorld({ seed: 4 }), { type: "JOIN_WORLD", playerId: "p", playerName: "p" }).state;
    const me = playerCharacter(s, "p")!;
    const haven = s.settlements.find((x) => x.kind === "bunker")!;
    haven.capacity = 60; // far too crowded
    for (const l of s.locations) if (["ashford_crossing", "cinder_flats"].includes(l.id)) l.discovered = true;
    let split = false;
    for (let i = 0; i < 120 && !split; i++) {
      const r = stepWorld(s, { events: [], actions: [] });
      split = r.events.some((e) => e.title.includes("分裂了"));
      s = r.state;
      s.settlements.find((x) => x.id === haven.id)!.capacity = 60;
    }
    expect(split).toBe(true);
    expect(playerCharacter(s, "p")?.homeId ?? me.homeId).toBe(me.homeId);
    expect(Object.values(s.tensions ?? {}).some((t) => t >= 20)).toBe(true);
  });
});
