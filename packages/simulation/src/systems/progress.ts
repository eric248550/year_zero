import { LOCATION_BY_ID, type Settlement, type TechnologyInfo } from "@genesis/schemas";
import { councilCandidates } from "./projects";
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
} from "@genesis/narrative";
import type { TickContext } from "../context";
import { placeDescription, placeName, say } from "@genesis/narrative";

/** The technology the council would start a project for next (developer focus first). */
export function currentResearchTarget(ctx: TickContext): TechnologyInfo | null {
  return councilCandidates(ctx.state)[0] ?? null;
}

export function developmentCost(s: Settlement, workshop = false): number {
  return Math.round((60 * s.level + 40) * (workshop ? 0.75 : 1));
}

export function development(ctx: TickContext): void {
  for (const s of activeSettlements(ctx.state)) {
    const maxLevel = s.kind === "bunker" ? 3 : 5;
    if (s.level >= maxLevel) continue;
    const pop = population(ctx.state, s.id);
    const cost = developmentCost(s, hasTech(ctx.state, "workshop"));
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
  if (hasTech(st, "pathfinding")) p *= 1.3;
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
