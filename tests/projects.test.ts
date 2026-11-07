import { describe, expect, it } from "vitest";
import { BRANCHES, BRANCH_INFO, TECHNOLOGIES, TECH_BY_ID, type WorldState } from "@genesis/schemas";
import { characterAge, getCharacter } from "@genesis/narrative";
import { activeProjects, applyImmediate, checkInvariants, createWorld, playerCharacter, stepWorld } from "@genesis/simulation";
import { seedContent } from "./helpers";

const events = seedContent.events;

function played(state: WorldState, playerId: string, profession?: "Farmer" | "Engineer" | "Scientist"): WorldState {
  let s = applyImmediate(state, { type: "JOIN_WORLD", playerId, playerName: playerId, ...(profession ? { profession } : {}) }).state;
  for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) {
    s = applyImmediate(s, { type: "PROLOGUE", playerId, step, choiceId }).state;
  }
  return s;
}

function step(s: WorldState, years = 1): WorldState {
  for (let i = 0; i < years; i++) {
    const r = stepWorld(s, { events, actions: [] });
    expect(checkInvariants(r.state, r.events)).toEqual([]);
    s = r.state;
  }
  return s;
}

describe("technology tree", () => {
  it("has six branches of four tiers whose prerequisites form no cycle", () => {
    for (const b of BRANCHES) {
      const tiers = new Set(TECHNOLOGIES.filter((t) => t.branch === b).map((t) => t.tier));
      expect([...tiers].sort()).toEqual([1, 2, 3, 4]);
    }
    const known = new Set<string>();
    for (let round = 0; round < TECHNOLOGIES.length; round++) {
      for (const t of TECHNOLOGIES) if (t.prerequisites.every((p) => known.has(p))) known.add(t.id);
    }
    expect(known.size).toBe(TECHNOLOGIES.length);
    // Branches need each other: most tier 2+ techs reach outside their branch.
    const cross = TECHNOLOGIES.filter((t) => t.prerequisites.some((p) => TECH_BY_ID[p]!.branch !== t.branch));
    expect(cross.length).toBeGreaterThanOrEqual(10);
  });
});

describe("projects", () => {
  it("are started by the council and finish as technologies, credited to the people who built them", () => {
    let s = step(createWorld({ seed: 7 }));
    expect(activeProjects(s).length).toBeGreaterThan(0);
    const first = activeProjects(s)[0]!;
    // The council asks someone of the branch's own profession to lead.
    expect(getCharacter(s, first.leadId)?.profession).toBe(BRANCH_INFO[TECH_BY_ID[first.techId]!.branch].profession);
    let done = false;
    for (let i = 0; i < 15 && !done; i++) {
      const r = stepWorld(s, { events, actions: [] });
      s = r.state;
      const e = r.events.find((x) => x.changes.some((c) => c.path === `technologies.${first.techId}`));
      if (e) {
        done = true;
        expect(e.characterIds).toContain(first.leadId);
        expect(getCharacter(s, first.leadId)?.lifeEvents.some((l) => l.historyId === e.id)).toBe(true);
      }
    }
    expect(done).toBe(true);
    expect(activeProjects(s).some((p) => p.techId === first.techId)).toBe(false);
  });

  it("let a player start one, lead it, and have others join or leave", () => {
    let s = played(played(createWorld({ seed: 11 }), "a", "Farmer"), "b", "Engineer");
    const a = playerCharacter(s, "a")!;
    const b = playerCharacter(s, "b")!;
    const tech = TECHNOLOGIES.find((t) => t.tier === 1 && !activeProjects(s).some((p) => p.techId === t.id))!;
    const before = s.settlements.find((x) => x.id === a.homeId)!.resources.materials;
    const r = applyImmediate(s, { type: "START_PROJECT", playerId: "a", tech: tech.id });
    expect(r.rejected).toBeNull();
    s = r.state;
    const p = activeProjects(s).find((x) => x.techId === tech.id)!;
    expect(p).toMatchObject({ leadId: a.id, memberIds: [a.id], startedBy: "player" });
    expect(s.settlements.find((x) => x.id === a.homeId)!.resources.materials).toBe(before - tech.materials);
    expect(r.events[0]?.characterIds).toContain(a.id);

    // The same technology cannot be started twice; a leader cannot start a second one.
    expect(applyImmediate(s, { type: "START_PROJECT", playerId: "b", tech: tech.id }).rejected).toMatch(/already working/);
    const other = TECHNOLOGIES.find((t) => t.tier === 1 && !activeProjects(s).some((x) => x.techId === t.id))!;
    expect(applyImmediate(s, { type: "START_PROJECT", playerId: "a", tech: other.id }).rejected).toMatch(/already leading/);

    s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "b", projectId: p.id }).state;
    expect(activeProjects(s).find((x) => x.id === p.id)!.memberIds).toEqual([a.id, b.id]);
    expect(applyImmediate(s, { type: "JOIN_PROJECT", playerId: "b", projectId: p.id }).rejected).toMatch(/already/);
    s = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "b", projectId: null }).state;
    expect(activeProjects(s).find((x) => x.id === p.id)!.memberIds).toEqual([a.id]);
    expect(applyImmediate(s, { type: "JOIN_PROJECT", playerId: "b", projectId: null }).rejected).toMatch(/not on a project/);
  });

  it("move faster with a player on them, most of all in the player's own profession", () => {
    const base = played(createWorld({ seed: 21 }), "a", "Farmer");
    const me = playerCharacter(base, "a")!;
    expect(characterAge(base, me)).toBeGreaterThanOrEqual(16);
    let s = step(base);
    const farm = activeProjects(s).find((p) => TECH_BY_ID[p.techId]!.branch === "farming");
    expect(farm).toBeDefined();
    const without = step(s);
    const joined = applyImmediate(s, { type: "JOIN_PROJECT", playerId: "a", projectId: farm!.id });
    expect(joined.rejected).toBeNull();
    const withMe = step(joined.state);
    const gain = (x: WorldState) => activeProjects(x).find((p) => p.id === farm!.id)?.lastGain ?? Infinity;
    expect(gain(withMe)).toBeGreaterThan(gain(without));
  });

  it("keep the world going for a century: every branch advances", () => {
    const s = step(createWorld({ seed: 3 }), 100);
    for (const b of BRANCHES) expect(s.technologies.some((id) => TECH_BY_ID[id]!.branch === b && TECH_BY_ID[id]!.tier >= 2)).toBe(true);
  });
});
