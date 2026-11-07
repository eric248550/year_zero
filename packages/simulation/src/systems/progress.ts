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

/** Settlements that are filling up pay for an expansion; it is built over a year (finished in construction()). */
export function development(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    const maxLevel = s.kind === "bunker" ? 3 : 5;
    if (s.level >= maxLevel || s.expanding !== undefined) continue;
    const pop = population(st, s.id);
    const cost = developmentCost(s, hasTech(st, "workshop"));
    if (pop < s.capacity * 0.7 || s.resources.materials < cost + 10) continue;
    const before = s.resources.materials;
    s.resources.materials = round2(before - cost);
    s.expanding = st.tick * 4 + 4;
    ctx.system({
      category: "settlement",
      importance: "minor",
      title: say(st).expandStartTitle(s.name, s.level + 1),
      text: say(st).expandStartText(s.name),
      settlementIds: [s.id],
      changes: [
        { path: `settlements.${s.id}.resources.materials`, label: `${s.name} materials`, before, after: s.resources.materials },
        { path: `settlements.${s.id}.expanding`, label: `${s.name} expansion`, before: null, after: s.expanding },
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
  const tower = s.facilities?.watchtower ?? 0;
  if (tower >= 30) p *= 1 + 0.2 * (tower / 100);
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
