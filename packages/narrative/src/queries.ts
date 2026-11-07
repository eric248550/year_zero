import {
  ADULT_AGE,
  type Character,
  type ResourceId,
  type Project,
  type Settlement,
  type WorldState,
} from "@genesis/schemas";

/** Character age in world years. Never derived from wall-clock time. */
export function ageAt(character: Character, tick: number, ticksPerYear = 1): number {
  const end = character.deathTick ?? tick;
  return Math.max(0, Math.floor((end - character.birthTick) / ticksPerYear));
}

export function characterAge(state: WorldState, character: Character): number {
  return ageAt(character, state.tick, state.ticksPerYear);
}

export function isAlive(character: Character): boolean {
  return character.deathTick === null;
}

export function livingCharacters(state: WorldState): Character[] {
  return state.characters.filter(isAlive);
}

export function residents(state: WorldState, settlementId: string): Character[] {
  return state.characters.filter((c) => c.deathTick === null && c.homeId === settlementId);
}

export function isAdult(state: WorldState, c: Character): boolean {
  return characterAge(state, c) >= ADULT_AGE;
}

export function population(state: WorldState, settlementId?: string): number {
  if (settlementId) return residents(state, settlementId).length;
  return livingCharacters(state).length;
}

export function activeSettlements(state: WorldState): Settlement[] {
  return state.settlements.filter((s) => s.status === "active");
}

export function getSettlement(state: WorldState, id: string): Settlement | undefined {
  return state.settlements.find((s) => s.id === id);
}

export function getCharacter(state: WorldState, id: string): Character | undefined {
  return state.characters.find((c) => c.id === id);
}

export function totalResource(state: WorldState, resource: ResourceId): number {
  return activeSettlements(state).reduce((sum, s) => sum + s.resources[resource], 0);
}

export function hasTech(state: WorldState, tech: string): boolean {
  return state.technologies.includes(tech);
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Display name in the order its script expects: Chinese family-first with no
 * space (林曉晴), otherwise given-first with a space (Ada Marsh).
 */
export function fullName(c: Pick<Character, "givenName" | "familyName">): string {
  if (!c.familyName) return c.givenName;
  if (CJK.test(c.familyName)) return `${c.familyName}${c.givenName}`;
  return `${c.givenName} ${c.familyName}`;
}

export function currentYear(state: WorldState): number {
  return state.startYear + Math.floor(state.tick / state.ticksPerYear);
}

export function relationshipKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function allocateHistoryId(state: WorldState): string {
  const id = `h${String(state.counters.nextHistory).padStart(6, "0")}`;
  state.counters.nextHistory += 1;
  return id;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function tensionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function tensionBetween(state: WorldState, a: string, b: string): number {
  return state.tensions?.[tensionKey(a, b)] ?? 0;
}

/** The other active settlement this one is most at odds with (ties: lowest id). */
export function rivalOf(state: WorldState, s: Settlement): Settlement | null {
  let best: Settlement | null = null;
  let bestT = -1;
  for (const o of activeSettlements(state)) {
    if (o.id === s.id) continue;
    const t = tensionBetween(state, s.id, o.id);
    if (t > bestT || (t === bestT && best && o.id < best.id)) { best = o; bestT = t; }
  }
  return best;
}

/** The active project a character leads or has joined. */
export function projectOf(state: WorldState, characterId: string): Project | undefined {
  return (state.projects ?? []).find((p) => p.memberIds.includes(characterId) || p.leadId === characterId);
}
