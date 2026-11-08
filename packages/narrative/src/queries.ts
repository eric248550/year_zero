import {
  ADULT_AGE,
  UPGRADE_BONUS,
  type Character,
  type GoodId,
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
  if (c < 30) return 0;
  return (c / 100) * (1 + UPGRADE_BONUS * ((s?.upgrades as Record<string, number> | undefined)?.[f] ?? 0));
}

/**
 * Electricity a settlement makes itself, by time of day. A generator runs day
 * and night while its water mill turns; a solar array only makes power in
 * daylight, and only what a battery bank stored is left after dark.
 */
export function ownPowerAt(s: Settlement): { day: number; night: number } {
  const solar = Math.min(1, facilityLevel(s, "solar_array"));
  const stored = Math.min(solar, facilityLevel(s, "battery_bank"));
  // A generator only turns while its water mill does.
  const dynamo = Math.min(1, facilityLevel(s, "generator")) * (facilityLevel(s, "watermill") > 0 ? 1 : 0);
  return { day: Math.min(1, dynamo + solar), night: Math.min(1, dynamo + stored) };
}

/** A day's worth of power, averaged over day and night. */
export function ownPower(s: Settlement): number {
  const { day, night } = ownPowerAt(s);
  return Math.round(((day + night) / 2) * 1000) / 1000;
}

/**
 * Electric power available to a settlement (0–1): its own, or the grid's best
 * source through its power lines once the power grid is known.
 */
export function powerLevel(state: WorldState, s: Settlement): number {
  const p = powerAt(state, s);
  return Math.round(((p.day + p.night) / 2) * 1000) / 1000;
}

/** Electric power by time of day: the settlement's own, or what the grid brings through its lines. */
export function powerAt(state: WorldState, s: Settlement): { day: number; night: number } {
  const own = ownPowerAt(s);
  const lines = Math.min(1, facilityLevel(s, "power_lines"));
  if (!lines || !state.technologies.includes("power_grid")) return own;
  const sources = activeSettlements(state).filter((o) => facilityLevel(o, "power_lines") > 0).map(ownPowerAt);
  return {
    day: Math.max(own.day, Math.min(1, Math.max(0, ...sources.map((x) => x.day)) * lines)),
    night: Math.max(own.night, Math.min(1, Math.max(0, ...sources.map((x) => x.night)) * lines)),
  };
}

/** The first season nothing has happened in yet: between years, spring of the coming year. */
export function nextSeason(state: WorldState): number {
  return (state.tick + 1) * 4;
}

export function isAwayNow(state: WorldState, c: Character): boolean {
  return c.awayUntil !== undefined && c.awayUntil >= state.tick * 4;
}

/** Has this person committed their time to work that has not finished? */
export function hasOpenWork(state: WorldState, characterId: string): boolean {
  return (state.activities ?? []).some((a) => a.characterId === characterId);
}

export function good(s: Settlement | undefined, g: GoodId): number {
  return s?.goods?.[g] ?? 0;
}

export function addGood(s: Settlement, g: GoodId, amount: number): void {
  s.goods = { ...(s.goods ?? {}), [g]: round2(Math.max(0, good(s, g) + amount)) };
}

/** Tell a player something that happened to them. No-op for NPCs. */
export function notify(state: WorldState, characterId: string, title: string, text: string): void {
  const c = getCharacter(state, characterId);
  const p = c?.controllerId ? state.players?.[c.controllerId] : undefined;
  if (!p) return;
  const n = p.nextNotice ?? 1;
  p.nextNotice = n + 1;
  p.notices = [...(p.notices ?? []), { id: `n-${p.id}-${n}`, tick: state.tick, title, text }].slice(-20);
}

/** The nearest site not yet found (hidden ones only come through the story). */
export function nearestUnknown(state: WorldState): LocationState | undefined {
  return state.locations
    .filter((l) => !l.discovered && !LOCATION_BY_ID[l.id]?.hidden)
    .sort((a, b) => (LOCATION_BY_ID[a.id]?.distance ?? 9) - (LOCATION_BY_ID[b.id]?.distance ?? 9) || (a.id < b.id ? -1 : 1))[0];
}

/** The nearest discovered site nobody lives on or has claimed. */
export function nearestClaimable(state: WorldState): LocationState | undefined {
  return state.locations
    .filter((l) => l.discovered && !l.settlementId && !l.claimedBy && l.id !== "haven_deep" && !LOCATION_BY_ID[l.id]?.hidden)
    .sort((a, b) => (LOCATION_BY_ID[a.id]?.distance ?? 9) - (LOCATION_BY_ID[b.id]?.distance ?? 9) || (a.id < b.id ? -1 : 1))[0];
}
