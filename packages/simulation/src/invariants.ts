import { EXCLUSIVE_FLAGS, RESOURCES, TECH_BY_ID, type HistoricalEvent, type WorldState } from "@genesis/schemas";

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
  // People referenced anywhere must exist; people doing things must be alive.
  const byId = new Map(state.characters.map((c) => [c.id, c]));
  for (const c of state.characters) {
    for (const pid of c.parentIds) {
      const parent = byId.get(pid);
      if (!parent) v.push(`${c.id} has unknown parent ${pid}`);
      else {
        if (parent.birthTick > c.birthTick - 12) v.push(`${c.id} born to ${pid}, who was under 12`);
        if (parent.deathTick !== null && parent.deathTick < c.birthTick) v.push(`${c.id} born after parent ${pid} died`);
      }
    }
    if (c.parentIds.length === 2) {
      const [a2, b2] = c.parentIds.map((id) => byId.get(id));
      if (a2 && b2 && (a2.parentIds.includes(b2.id) || b2.parentIds.includes(a2.id) || a2.parentIds.some((x) => b2.parentIds.includes(x)))) v.push(`${c.id} has close kin as parents`);
    }
    for (const cid of c.caretakerIds ?? []) if (!byId.has(cid)) v.push(`${c.id} cared for by unknown ${cid}`);
  }
  for (const p of state.projects ?? []) {
    if (p.leadId && !byId.has(p.leadId)) v.push(`Project ${p.id} led by unknown ${p.leadId}`);
    for (const m of p.memberIds) if (!byId.has(m)) v.push(`Project ${p.id} has unknown member ${m}`);
  }
  for (const d of state.pendingDecisions ?? []) for (const id of d.participants) if (!byId.has(id)) v.push(`Decision ${d.id} has unknown participant ${id}`);
  for (const x of state.scheduled ?? []) {
    for (const id of Object.values(x.roles)) if (!byId.has(id)) v.push(`Scheduled ${x.id} names unknown ${id}`);
    if (x.dueSeason < state.tick * 4) v.push(`Scheduled ${x.id} is overdue`);
  }
  for (const key of Object.keys(state.relationships)) {
    const [a3, b3] = key.split("|");
    if (!a3 || !b3 || !byId.has(a3) || !byId.has(b3)) v.push(`Relationship ${key} names an unknown character`);
  }
  for (const l of state.locations) if (l.claimedBy && !ids.has(l.claimedBy)) v.push(`${l.id} claimed by unknown ${l.claimedBy}`);
  for (const s of state.settlements) for (const [f, cond] of Object.entries(s.facilities ?? {})) if (cond === undefined || cond < 0 || cond > 100) v.push(`${s.name} ${f} condition out of range`);
  const openKeys = new Set<string>();
  for (const p of state.proposals ?? []) {
    if (p.status !== "open") continue;
    const k = `${p.settlementId}|${p.key}`;
    if (openKeys.has(k)) v.push(`Two open proposals for ${k}`);
    openKeys.add(k);
  }
  const sched = new Set<string>();
  for (const x of state.scheduled ?? []) { if (sched.has(x.id)) v.push(`Duplicate scheduled ${x.id}`); sched.add(x.id); }
  for (const g of EXCLUSIVE_FLAGS) if (g.filter((f) => state.flags[f] !== undefined).length > 1) v.push(`Rival flags held together: ${g.join(", ")}`);
  const hIds = new Set<string>();
  for (const h of history) {
    if (hIds.has(h.id)) v.push(`Duplicate history id ${h.id}`);
    hIds.add(h.id);
    if (h.tick > state.tick) v.push(`History ${h.id} is in the future`);
  }
  return v;
}
