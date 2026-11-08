import { ADULT_AGE, type Character, type Effect, type Profession, type Settlement, type WorldState } from "@genesis/schemas";
import { characterAge, isAwayNow, residents } from "./queries";

/**
 * Who may change what in a settlement.
 *
 * - Domain changes (how the fields are farmed, which building is repaired) are
 *   for the head of that profession: the most skilled living adult of it there.
 * - Settlement changes (claims, laws, research priorities, taking a building
 *   apart, new buildings) go to the governing body: every adult under an
 *   assembly, the elders under a council of elders, otherwise the council of
 *   heads (the head of each profession).
 *
 * Players and NPCs follow the same rules; an NPC decides by its nature.
 */
const SKILL: Record<Profession, "survival" | "knowledge" | "social"> = {
  Farmer: "survival",
  Engineer: "survival",
  Medic: "knowledge",
  Scientist: "knowledge",
  Scout: "survival",
};

function adults(state: WorldState, s: Settlement): Character[] {
  // Someone away cannot speak for the settlement until they are back.
  return residents(state, s.id).filter((c) => characterAge(state, c) >= ADULT_AGE && !isAwayNow(state, c));
}

/** The head of a profession in a settlement (most skilled, then oldest, then id). */
export function headOf(state: WorldState, s: Settlement, p: Profession): Character | undefined {
  const skill = SKILL[p];
  return adults(state, s)
    .filter((c) => c.profession === p)
    .sort((a, b) => (b.attributes?.[skill] ?? 0) - (a.attributes?.[skill] ?? 0) || a.birthTick - b.birthTick || (a.id < b.id ? -1 : 1))[0];
}

export type Governance = "assembly" | "elders" | "heads";

export function governanceOf(state: WorldState): Governance {
  if (state.flags["governance.assembly"]) return "assembly";
  if (state.flags["governance.elder_council"]) return "elders";
  return "heads";
}

/** Who decides a proposal in this settlement. Never empty while anyone lives there. */
export function proposalDeciders(state: WorldState, s: Settlement, kind: "domain" | "settlement", domain?: Profession): string[] {
  if (kind === "domain" && domain) {
    const head = headOf(state, s, domain);
    if (head) return [head.id];
  }
  const all = adults(state, s);
  const g = governanceOf(state);
  if (g === "assembly") return all.map((c) => c.id);
  if (g === "elders") {
    const elders = all.filter((c) => characterAge(state, c) >= 60);
    if (elders.length) return elders.map((c) => c.id);
  }
  const heads = (["Farmer", "Engineer", "Medic", "Scientist", "Scout"] as const).map((p) => headOf(state, s, p)).filter((c): c is Character => !!c);
  return heads.length ? heads.map((c) => c.id) : all.slice(0, 1).map((c) => c.id);
}

/** A proposer may carry out a domain change alone only if they head that domain. */
export function mayActAlone(state: WorldState, s: Settlement, proposerId: string, kind: "domain" | "settlement", domain?: Profession): boolean {
  if (kind !== "domain" || !domain) return false;
  return headOf(state, s, domain)?.id === proposerId;
}

/** Proposals that would change the same thing conflict. */
export function proposalKey(effects: readonly Effect[]): string {
  return effects.map((e) => {
    switch (e.type) {
      case "SET_FARM_PLAN": return "farm-plan";
      case "PRIORITIZE_BRANCH": return "research-priority";
      case "SET_PRIORITY": return "settlement-priority";
      case "CLAIM_SITE": return `claim:${e.location}`;
      case "ENACT_LAW": case "REPEAL_LAW": return `law:${e.law}`;
      case "BUILD_FACILITY": case "CHANGE_FACILITY": return `facility:${e.facility}`;
      case "AFTER": return proposalKey(e.effects as Effect[]);
      case "SPEND": return "";
      default: return e.type;
    }
  }).filter(Boolean).join("+");
}
