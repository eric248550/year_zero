import { TECH_BY_ID, type Attributes, type Character, type Rng, type Role, type WorldState } from "@genesis/schemas";

/** A child with no living parent and nobody living who looks after them. */
export function isOrphan(state: WorldState, c: Character): boolean {
  const alive = (id: string) => state.characters.some((x) => x.id === id && x.deathTick === null);
  return !c.parentIds.some(alive) && !(c.caretakerIds ?? []).some(alive);
}
import { characterAge, projectOf, relationshipKey } from "./queries";

/** Living characters eligible for a role. Dead characters are NEVER eligible. */
export function candidatesForRole(
  state: WorldState,
  role: Role,
  settlementId: string | null,
  exclude: ReadonlySet<string>,
): Character[] {
  return state.characters.filter((c) => {
    if (c.deathTick !== null) return false;
    if (exclude.has(c.id)) return false;
    if (settlementId !== null && c.homeId !== settlementId) return false;
    if (role.profession && c.profession !== role.profession) return false;
    const age = characterAge(state, c);
    if (role.minAge !== undefined && age < role.minAge) return false;
    if (role.maxAge !== undefined && age > role.maxAge) return false;
    if (role.player && !c.controllerId) return false;
    if (role.orphan && !isOrphan(state, c)) return false;
    if (role.onProject) {
      const p = projectOf(state, c.id);
      if (!p || (role.onProject !== true && TECH_BY_ID[p.techId]?.branch !== role.onProject)) return false;
    }
    if (role.minAttributes) {
      for (const [k, min] of Object.entries(role.minAttributes) as [keyof Attributes, number][]) {
        if ((c.attributes?.[k] ?? 50) < min) return false;
      }
    }
    return true;
  });
}

/**
 * Check (without consuming randomness) whether all required roles can be
 * filled by distinct living characters. Greedy check in declared order,
 * using the most constrained roles first to avoid false negatives.
 */
export function rolesSatisfiable(state: WorldState, roles: readonly Role[], settlementId: string | null): boolean {
  const required = roles.filter((r) => !r.optional);
  const pools = required
    .map((r) => candidatesForRole(state, r, settlementId, new Set()))
    .map((pool, i) => ({ pool, i }))
    .sort((a, b) => a.pool.length - b.pool.length);
  const used = new Set<string>();
  for (const { pool } of pools) {
    const pick = pool.find((c) => !used.has(c.id));
    if (!pick) return false;
    used.add(pick.id);
  }
  return true;
}

/** Players are this many times likelier to be cast in a world event than an NPC. */
export const PLAYER_ROLE_WEIGHT = 10;

/** Fill roles with distinct living characters, randomly but deterministically. Returns null if impossible. */
export function resolveRoles(
  state: WorldState,
  roles: readonly Role[],
  settlementId: string | null,
  rng: Rng,
  /** Roles already decided (e.g. the player a personal event is about). Must be valid candidates. */
  forced: Readonly<Record<string, string>> = {},
): Record<string, string> | null {
  const assigned: Record<string, string> = { ...forced };
  const used = new Set<string>(Object.values(forced));
  const ordered = [...roles].filter((r) => !(r.id in forced)).sort((a, b) => Number(a.optional) - Number(b.optional));
  for (const role of ordered) {
    const pool = candidatesForRole(state, role, settlementId, used);
    if (pool.length === 0) {
      if (role.optional) continue;
      return null;
    }
    const anchorId = role.familiarWith ? assigned[role.familiarWith] : undefined;
    const pick = anchorId
      ? rng.weighted(pool, (c) => (1 + Math.abs(state.relationships[relationshipKey(anchorId, c.id)] ?? 0) / 10) ** 2 * (c.controllerId ? PLAYER_ROLE_WEIGHT : 1))
      : pool.some((c) => c.controllerId)
        ? rng.weighted(pool, (c) => (c.controllerId ? PLAYER_ROLE_WEIGHT : 1))
        : rng.pick(pool);
    assigned[role.id] = pick.id;
    used.add(pick.id);
  }
  return assigned;
}
