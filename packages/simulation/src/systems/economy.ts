import { LOCATION_BY_ID, type ResourceId, type Settlement, type StateChange } from "@genesis/schemas";
import { characterAge, hasTech, residents, round2 } from "@genesis/narrative";
import { ADULT_AGE, ELDER_AGE } from "@genesis/schemas";
import type { TickContext } from "../context";
import { hasLaw, isAway, working } from "./legacy";
import { resourceName, say } from "@genesis/narrative";

/** Tunable economic constants. Changing these changes RULES_VERSION semantics. */
export const ECONOMY = {
  foodPerLabor: 1.0,
  foodPerFarmer: 1.5,
  waterPerLabor: 1.3,
  forageFoodPerScout: 0.6,
  materialsPerEngineer: 1.1,
  materialsPerLabor: 0.15,
  knowledgePerScientist: 2.0,
  knowledgePerLabor: 0.1,
  bunkerWaterReclaimer: 5,
  adultNeed: 1,
  childNeed: 0.6,
  foodSpoilage: 0.15,
  waterLoss: 0.1,
  materialsUpkeepPerResident: 0.12,
  materialsUpkeepPerLevel: 2,
} as const;

export interface Workforce {
  residents: number;
  adults: number;
  children: number;
  labor: number;
  scientists: number;
  engineers: number;
  medics: number;
  scouts: number;
  farmers: number;
}

export function workforce(ctx: TickContext, s: Settlement): Workforce {
  const people = residents(ctx.state, s.id);
  const w: Workforce = { residents: people.length, adults: 0, children: 0, labor: 0, scientists: 0, engineers: 0, medics: 0, scouts: 0, farmers: 0 };
  for (const c of people) {
    const age = characterAge(ctx.state, c);
    if (age < ADULT_AGE) {
      w.children++;
      continue;
    }
    w.adults++;
    // Away on a long job: still eats, does not work here.
    const effort = isAway(ctx.state, c) ? 0 : age >= ELDER_AGE ? 0.5 : 1;
    w.labor += effort;
    if (c.profession === "Scientist") w.scientists += effort;
    if (c.profession === "Engineer") w.engineers += effort;
    if (c.profession === "Medic") w.medics += effort;
    if (c.profession === "Scout") w.scouts += effort;
    if (c.profession === "Farmer") w.farmers += effort;
  }
  return w;
}

function multipliers(ctx: TickContext, s: Settlement) {
  const features = LOCATION_BY_ID[s.locationId]?.features ?? [];
  const t = (id: string) => hasTech(ctx.state, id);
  const grid = (t("power_grid") ? 1.1 : 1) * (t("machining") ? 1.1 : 1);
  let food = s.kind === "bunker" ? 0.95 : 1.05;
  if (features.includes("fertile")) food *= 1.15;
  if (t("hydroponics")) food *= 1.2;
  if (t("irrigation") && s.kind !== "bunker") food *= 1.25;
  if (t("crop_genetics")) food *= 1.15;
  if (t("mass_farming")) food *= 1.15;
  if (ctx.state.flags["food.heirloom_seeds"]) food *= 1.1;
  if (working(s, "greenhouse")) food *= 1.1;
  let water = 1;
  if (t("water_purification")) water *= 1.3;
  if (features.includes("clean_aquifer")) water *= 1.3;
  if (features.includes("river")) water *= 1.15;
  if (t("water_wheel")) water *= 1.1;
  if (working(s, "well")) water *= 1.1;
  water *= grid;
  let materials = 1;
  if (features.includes("ruins")) materials *= 1.4;
  if (t("salvage_tools")) materials *= 1.4;
  if (t("solar_power")) materials *= 1.1;
  if (t("water_wheel")) materials *= 1.1;
  if (t("mechanical_power")) materials *= 1.1;
  if (t("workshop")) materials *= 1.2;
  if (t("metallurgy")) materials *= 1.2;
  if (working(s, "forge")) materials *= 1.1;
  materials *= grid;
  let knowledge = 1;
  if (t("solar_power")) knowledge *= 1.2;
  if (t("archives")) knowledge *= 1.15;
  if (t("apprenticeship")) knowledge *= 1.1;
  if (t("schooling")) knowledge *= 1.25;
  if (t("research_institute")) knowledge *= 1.3;
  if (ctx.state.flags["mystery.halcyon_archive"]) knowledge *= 1.15;
  if (working(s, "schoolhouse")) knowledge *= 1.1;
  return { food, water, materials, knowledge };
}

/** Resource production for every active settlement. */
export function produce(ctx: TickContext): void {
  for (const s of ctx.state.settlements) {
    if (s.status !== "active") continue;
    const w = workforce(ctx, s);
    const m = multipliers(ctx, s);
    const efficiency = (0.6 + 0.4 * (s.health / 100)) * (0.75 + 0.35 * (s.morale / 100));
    // One shared "season" roll per settlement per tick: drought years hit food and water together.
    const season = Math.min(1.3, Math.max(0.55, ctx.rng.gaussian(1, 0.16)));
    const out: Record<ResourceId, number> = {
      food: ((w.labor * ECONOMY.foodPerLabor + w.farmers * ECONOMY.foodPerFarmer) * m.food * season + w.scouts * ECONOMY.forageFoodPerScout) * efficiency,
      water: (w.labor * ECONOMY.waterPerLabor * m.water * season) * efficiency + (s.kind === "bunker" ? ECONOMY.bunkerWaterReclaimer : 0),
      materials: (w.engineers * ECONOMY.materialsPerEngineer + w.labor * ECONOMY.materialsPerLabor) * m.materials * efficiency,
      knowledge: (w.scientists * ECONOMY.knowledgePerScientist + w.labor * ECONOMY.knowledgePerLabor) * m.knowledge * efficiency,
    };
    for (const r of Object.keys(out) as ResourceId[]) s.resources[r] = round2(s.resources[r] + out[r]);
  }
}

/** Consumption, spoilage, upkeep and shortage tracking. Stocks never go negative. */
export function consume(ctx: TickContext): void {
  for (const s of ctx.state.settlements) {
    if (s.status !== "active") continue;
    const w = workforce(ctx, s);
    const need = w.adults * ECONOMY.adultNeed + w.children * ECONOMY.childNeed;
    const deficit = { food: 0, water: 0 };

    for (const r of ["food", "water"] as const) {
      const available = s.resources[r];
      const unmet = Math.max(0, need - available);
      s.resources[r] = round2(Math.max(0, available - need));
      deficit[r] = need > 0 ? unmet / need : 0;
      const loss = r === "food" ? ECONOMY.foodSpoilage * (hasTech(ctx.state, "mass_farming") ? 0.5 : 1) * (working(s, "granary") ? 0.5 : 1) : ECONOMY.waterLoss;
      s.resources[r] = round2(s.resources[r] * (1 - loss));

      if (deficit[r] > 0.02) {
        if (s.shortage[r] === 0) {
          const change: StateChange = { path: `settlements.${s.id}.shortage.${r}`, label: `${s.name} ${r} shortage`, before: false, after: true };
          const e = ctx.system({
            category: "resource",
            importance: "notable",
            title: say(ctx.state).shortageTitle(r, s.name),
            text: say(ctx.state).shortageText(s.name, Math.round(deficit[r] * 100), resourceName(ctx.state, r)),
            settlementIds: [s.id],
            changes: [change],
            summary: `Stock (${round2(available)}) fell short of the yearly need (${round2(need)}) for ${w.residents} residents`,
          });
          s.shortageOrigin[r] = e.id;
        }
        s.shortage[r] += 1;
      } else if (s.shortage[r] > 0) {
        const origin = s.shortageOrigin[r];
        ctx.system({
          category: "resource",
          importance: "minor",
          title: say(ctx.state).recoverTitle(s.name, resourceName(ctx.state, r)),
          text: say(ctx.state).recoverText(s.shortage[r], s.name, resourceName(ctx.state, r)),
          settlementIds: [s.id],
          causeIds: origin ? [origin] : [],
        });
        s.shortage[r] = 0;
        s.shortageOrigin[r] = null;
      }
    }
    ctx.deficits.set(s.id, deficit);

    const upkeep = w.residents * ECONOMY.materialsUpkeepPerResident + s.level * ECONOMY.materialsUpkeepPerLevel;
    if (s.resources.materials < upkeep) s.morale = Math.max(0, s.morale - 3); // infrastructure decays
    s.resources.materials = round2(Math.max(0, s.resources.materials - upkeep));
  }
}

/** Morale and health drift toward targets shaped by conditions. */
export function wellbeing(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of st.settlements) {
    if (s.status !== "active") continue;
    const w = workforce(ctx, s);
    const d = ctx.deficits.get(s.id) ?? { food: 0, water: 0 };
    const crowded = w.residents > s.capacity;
    const foodPerCapita = w.residents > 0 ? s.resources.food / w.residents : 0;

    let morale = 52 + s.level * 2;
    if (hasTech(st, "civic_charter")) morale += 10;
    if (hasTech(st, "trade_routes")) morale += 3;
    if (foodPerCapita > 3) morale += 5;
    morale -= d.food * 40 + d.water * 45;
    if (crowded) morale -= 15;
    if (st.flags["society.truth_known"]) morale -= 4;
    if (st.flags["governance.ration_council"]) morale += 3;
    if (st.flags["society.closed_gates"]) morale += 2;
    if (working(s, "meeting_hall")) morale += 3;
    if (hasLaw(s, "rationing")) morale -= 3;
    if (hasLaw(s, "work_duty")) morale -= 4;
    if (hasLaw(s, "shared_stores")) morale += 2;
    if (hasLaw(s, "curfew")) morale -= 2;
    if (st.flags["society.bunker_first"] && s.kind === "bunker") morale += 4;
    if (st.flags["society.surface_first"] && s.kind === "bunker") morale -= 3;

    let health = 58 + Math.min(20, w.medics * 4);
    if (hasTech(st, "field_medicine")) health += 8;
    if (hasTech(st, "antibiotics")) health += 10;
    if (hasTech(st, "water_purification")) health += 4;
    if (working(s, "clinic")) health += 5;
    health -= d.food * 30 + d.water * 40;
    if (crowded) health -= 10;

    s.morale = round2(Math.min(100, Math.max(0, s.morale + (morale - s.morale) * 0.3)));
    s.health = round2(Math.min(100, Math.max(0, s.health + (health - s.health) * 0.3)));
  }
}
