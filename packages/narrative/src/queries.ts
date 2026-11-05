import {
  ADULT_AGE,
  type Character,
  type ResourceId,
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

export function fullName(c: Character): string {
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
