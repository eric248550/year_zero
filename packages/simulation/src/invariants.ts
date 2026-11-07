import { RESOURCES, TECH_BY_ID, type HistoricalEvent, type WorldState } from "@genesis/schemas";

/** Structural invariants that must hold after every tick. Returns human-readable violations. */
export function checkInvariants(state: WorldState, history: readonly HistoricalEvent[] = []): string[] {
  const v: string[] = [];
  if (!Number.isInteger(state.tick) || state.tick < 0) v.push(`Invalid tick ${state.tick}`);
  const techProjects = new Set<string>();
  for (const p of state.projects ?? []) {
    if (techProjects.has(p.techId)) v.push(`Two projects for ${p.techId}`);
    techProjects.add(p.techId);
    if (!TECH_BY_ID[p.techId]) v.push(`Project ${p.id} builds unknown technology ${p.techId}`);
    if (!Number.isFinite(p.progress) || p.progress < 0) v.push(`Project ${p.id} has invalid progress ${p.progress}`);
  }
  const ids = new Set<string>();
  for (const s of state.settlements) {
    if (ids.has(s.id)) v.push(`Duplicate settlement id ${s.id}`);
    ids.add(s.id);
    for (const r of RESOURCES) {
      const val = s.resources[r];
      if (!Number.isFinite(val)) v.push(`${s.name} ${r} is not finite (${val})`);
      else if (val < 0) v.push(`${s.name} ${r} is negative (${val})`);
    }
    if (s.morale < 0 || s.morale > 100) v.push(`${s.name} morale out of range (${s.morale})`);
    if (s.health < 0 || s.health > 100) v.push(`${s.name} health out of range (${s.health})`);
    if (s.capacity < 0) v.push(`${s.name} capacity negative`);
  }
  const charIds = new Set<string>();
  for (const c of state.characters) {
    if (charIds.has(c.id)) v.push(`Duplicate character id ${c.id}`);
    charIds.add(c.id);
    if (c.birthTick > state.tick) v.push(`${c.id} born in the future`);
    if (c.deathTick !== null && c.deathTick < c.birthTick) v.push(`${c.id} died before birth`);
    if (c.deathTick !== null && c.deathTick > state.tick) v.push(`${c.id} died in the future`);
    if (c.deathTick !== null && !c.causeOfDeath) v.push(`${c.id} dead without a cause`);
    if (c.deathTick === null) {
      const home = state.settlements.find((s) => s.id === c.homeId);
      if (!home) v.push(`${c.id} lives in unknown settlement ${c.homeId}`);
      else if (home.status !== "active") v.push(`${c.id} lives in abandoned ${home.name}`);
    }
  }
  const controlled = new Map<string, string>();
  for (const c of state.characters) {
    if (!c.controllerId || c.deathTick !== null) continue;
    const p = state.players?.[c.controllerId];
    if (!p) v.push(`${c.id} controlled by unknown player ${c.controllerId}`);
    else if (p.characterId !== c.id) v.push(`${c.id} claims player ${p.id}, who plays ${p.characterId ?? "nobody"}`);
    if (controlled.has(c.controllerId)) v.push(`Player ${c.controllerId} controls two living characters`);
    controlled.set(c.controllerId, c.id);
  }
  for (const p of Object.values(state.players ?? {})) {
    if (p.status === "active") {
      const c = p.characterId ? state.characters.find((x) => x.id === p.characterId) : undefined;
      if (!c || c.deathTick !== null) v.push(`Active player ${p.id} has no living character`);
      else if (c.controllerId !== p.id) v.push(`Player ${p.id}'s character ${c.id} is not marked as controlled`);
    } else if (p.characterId !== null) v.push(`Player ${p.id} (${p.status}) still holds a character`);
  }
  for (const d of state.pendingDecisions ?? []) {
    if (d.resolveTick <= state.tick) v.push(`Decision ${d.id} is overdue (due tick ${d.resolveTick})`);
  }
  for (const t of state.technologies) {
    const info = TECH_BY_ID[t];
    if (!info) v.push(`Unknown technology ${t}`);
    else for (const p of info.prerequisites) if (!state.technologies.includes(p)) v.push(`${t} unlocked without prerequisite ${p}`);
  }
  if (new Set(state.technologies).size !== state.technologies.length) v.push("Duplicate technology entries");
  for (const key of Object.keys(state.flags)) if (key.startsWith("secret.") || key.startsWith("system.")) v.push(`Reserved flag written: ${key}`);
  const hIds = new Set<string>();
  for (const h of history) {
    if (hIds.has(h.id)) v.push(`Duplicate history id ${h.id}`);
    hIds.add(h.id);
    if (h.tick > state.tick) v.push(`History ${h.id} is in the future`);
  }
  return v;
}
