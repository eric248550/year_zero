import {
  ADULT_AGE,
  type Character,
  type ResourceId,
  LOCATION_BY_ID,
  type LocationState,
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

/** How much of its effect a building gives: 0 when missing or broken (below 30), else its condition as a share. */
export function facilityLevel(s: Settlement | undefined, f: string): number {
  const c = (s?.facilities as Record<string, number> | undefined)?.[f] ?? 0;
  return c >= 30 ? c / 100 : 0;
}

/** Power a settlement makes itself: the generator, plus the solar array (half of it without batteries). */
export function ownPower(s: Settlement): number {
  const solar = facilityLevel(s, "solar_array") * (facilityLevel(s, "battery_bank") > 0 ? 1 : 0.5);
  return Math.min(1, facilityLevel(s, "generator") + solar);
}

/**
 * Electric power available to a settlement (0–1): its own, or the grid's best
 * source through its power lines once the power grid is known.
 */
export function powerLevel(state: WorldState, s: Settlement): number {
  const own = ownPower(s);
  const lines = facilityLevel(s, "power_lines");
  if (!lines || !state.technologies.includes("power_grid")) return own;
  const grid = Math.max(0, ...activeSettlements(state).filter((o) => facilityLevel(o, "power_lines") > 0).map(ownPower));
  return Math.max(own, Math.min(1, grid * lines));
}

/** The nearest discovered site nobody lives on or has claimed. */
export function nearestClaimable(state: WorldState): LocationState | undefined {
  return state.locations
    .filter((l) => l.discovered && !l.settlementId && !l.claimedBy && l.id !== "haven_deep" && !LOCATION_BY_ID[l.id]?.hidden)
    .sort((a, b) => (LOCATION_BY_ID[a.id]?.distance ?? 9) - (LOCATION_BY_ID[b.id]?.distance ?? 9) || (a.id < b.id ? -1 : 1))[0];
}
