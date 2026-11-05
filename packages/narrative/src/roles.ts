import type { Character, Rng, Role, WorldState } from "@genesis/schemas";
import { characterAge } from "./queries";

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

/** Fill roles with distinct living characters, randomly but deterministically. Returns null if impossible. */
export function resolveRoles(
  state: WorldState,
  roles: readonly Role[],
  settlementId: string | null,
  rng: Rng,
): Record<string, string> | null {
  const assigned: Record<string, string> = {};
  const used = new Set<string>();
  const ordered = [...roles].sort((a, b) => Number(a.optional) - Number(b.optional));
  for (const role of ordered) {
    const pool = candidatesForRole(state, role, settlementId, used);
    if (pool.length === 0) {
      if (role.optional) continue;
      return null;
    }
    const pick = rng.pick(pool);
    assigned[role.id] = pick.id;
    used.add(pick.id);
  }
  return assigned;
}
