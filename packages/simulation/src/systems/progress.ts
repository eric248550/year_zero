import { LOCATION_BY_ID, POLICY_INFO, TECHNOLOGIES, TECH_BY_ID, type Settlement, type TechnologyInfo } from "@genesis/schemas";
import {
  activeSettlements,
  characterAge,
  discoverLocation,
  fullName,
  hasTech,
  newRecorder,
  population,
  residents,
  round2,
  totalResource,
  unlockTechnology,
} from "@genesis/narrative";
import type { TickContext } from "../context";
import { placeDescription, placeName, say, techText } from "@genesis/narrative";

export function researchable(ctx: TickContext, tech: TechnologyInfo): boolean {
  const st = ctx.state;
  if (hasTech(st, tech.id)) return false;
  if (!tech.prerequisites.every((p) => hasTech(st, p))) return false;
  if (tech.minPopulation && population(st) < tech.minPopulation) return false;
  return true;
}

/** The technology currently being researched: developer focus, else policy preference. */
export function currentResearchTarget(ctx: TickContext): TechnologyInfo | null {
  const st = ctx.state;
  if (st.researchFocus) {
    const focus = TECH_BY_ID[st.researchFocus];
    if (focus && researchable(ctx, focus)) return focus;
  }
  for (const id of POLICY_INFO[st.policy].researchOrder) {
    const t = TECH_BY_ID[id];
    if (t && researchable(ctx, t)) return t;
  }
  return TECHNOLOGIES.find((t) => researchable(ctx, t)) ?? null;
}

/** Spend knowledge across settlements (richest first). Fails without side effects if insufficient. */
function spendKnowledge(ctx: TickContext, amount: number): boolean {
  if (totalResource(ctx.state, "knowledge") + 1e-9 < amount) return false;
  let remaining = amount;
  const pool = [...activeSettlements(ctx.state)].sort((a, b) => b.resources.knowledge - a.resources.knowledge);
  for (const s of pool) {
    const take = Math.min(s.resources.knowledge, remaining);
    s.resources.knowledge = round2(s.resources.knowledge - take);
    remaining -= take;
    if (remaining <= 1e-9) break;
  }
  return true;
}

export function research(ctx: TickContext): void {
  const st = ctx.state;
  const target = currentResearchTarget(ctx);
  if (!target) return;
  const before = round2(totalResource(st, "knowledge"));
  if (!spendKnowledge(ctx, target.cost)) return;
  const rec = newRecorder();
  unlockTechnology(st, target.id, rec);
  if (st.researchFocus === target.id) st.researchFocus = null;
  if (target.id === "power_grid") {
    for (const s of activeSettlements(st)) s.capacity += 10;
  }
  ctx.system({
    category: "technology",
    importance: "major",
    title: say(st).techTitle(techText(st, target.id).name),
    text: say(st).techBody(techText(st, target.id).name, techText(st, target.id).description, techText(st, target.id).effect),
    changes: [{ path: "knowledge.total", label: "Total knowledge", before, after: round2(totalResource(st, "knowledge")) }, ...rec.changes],
    summary: `Accumulated knowledge reached the research cost (${target.cost}); prerequisites ${target.prerequisites.length ? target.prerequisites.join(", ") : "none"} satisfied`,
  });
}

export function developmentCost(s: Settlement): number {
  return 40 * s.level + 20;
}

export function development(ctx: TickContext): void {
  for (const s of activeSettlements(ctx.state)) {
    const maxLevel = s.kind === "bunker" ? 3 : 5;
    if (s.level >= maxLevel) continue;
    const pop = population(ctx.state, s.id);
    const cost = developmentCost(s);
    if (pop < s.capacity * 0.7 || s.resources.materials < cost + 10) continue;
    const before = { level: s.level, capacity: s.capacity, materials: s.resources.materials };
    s.resources.materials = round2(s.resources.materials - cost);
    s.level += 1;
    s.capacity += s.kind === "bunker" ? 4 : 10;
    s.morale = Math.min(100, s.morale + 5);
    ctx.system({
      category: "settlement",
      importance: "notable",
      title: say(ctx.state).growTitle(s.name, s.level),
      text: say(ctx.state).growText(s.name, s.capacity),
      settlementIds: [s.id],
      changes: [
        { path: `settlements.${s.id}.level`, label: `${s.name} level`, before: before.level, after: s.level },
        { path: `settlements.${s.id}.capacity`, label: `${s.name} capacity`, before: before.capacity, after: s.capacity },
        { path: `settlements.${s.id}.resources.materials`, label: `${s.name} materials`, before: before.materials, after: s.resources.materials },
      ],
      summary: `Population ${pop} ≥ 70% of capacity and materials ≥ ${cost + 10}`,
    });
  }
}

/** Attempt to discover a location from a settlement. Returns true on success. */
export function attemptExploration(ctx: TickContext, s: Settlement, bonus: number, reason: string): boolean {
  const st = ctx.state;
  const scouts = residents(st, s.id).filter((c) => c.profession === "Scout" && characterAge(st, c) >= 16);
  const undiscovered = st.locations.filter((l) => !l.discovered && !LOCATION_BY_ID[l.id]!.hidden);
  if (scouts.length === 0 || undiscovered.length === 0) return false;
  let p = (1 - Math.pow(0.88, scouts.length)) * 0.35 + bonus;
  if (hasTech(st, "radio")) p *= 1.5;
  if (!ctx.rng.chance(Math.min(0.95, p))) return false;
  const loc = ctx.rng.weighted(undiscovered, (l) => 1 / LOCATION_BY_ID[l.id]!.distance);
  const scout = ctx.rng.pick(scouts);
  const info = LOCATION_BY_ID[loc.id]!;
  const rec = newRecorder();
  discoverLocation(st, loc.id, rec);
  const e = ctx.system({
    category: "exploration",
    importance: "notable",
    title: say(st).discoverTitle(placeName(st, info.id)),
    text: say(st).discoverText(fullName(scout), s.name, placeName(st, info.id), placeDescription(st, info.id), info.settleable),
    settlementIds: [s.id],
    characterIds: [scout.id],
    changes: rec.changes,
    summary: reason,
  });
  scout.lifeEvents.push({ tick: st.tick, text: say(st).discoveredLife(placeName(st, info.id)), historyId: e.id });
  return true;
}

export function exploration(ctx: TickContext): void {
  for (const s of activeSettlements(ctx.state)) {
    attemptExploration(ctx, s, 0, "Routine scouting patrol succeeded (chance scales with scouts, radio)");
  }
}
