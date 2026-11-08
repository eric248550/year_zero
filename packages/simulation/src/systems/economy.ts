import { INDUSTRY, LOCATION_BY_ID, PROCESS_BONUS, type FacilityId, type LocationState, type ResourceId, type Settlement, type StateChange } from "@genesis/schemas";
import { addGood, characterAge, good, hasTech, powerLevel, residents, round2 } from "@genesis/narrative";
import { ADULT_AGE, ELDER_AGE } from "@genesis/schemas";
import type { TickContext } from "../context";
import { hasLaw, isAway, level } from "./legacy";
import { resourceName, say } from "@genesis/narrative";

/** Tunable economic constants. Changing these changes RULES_VERSION semantics. */
export const ECONOMY = {
  foodPerLabor: 0.85,
  foodPerFarmer: 1.5,
  waterPerLabor: 1.2,
  forageFoodPerScout: 0.6,
  materialsPerEngineer: 1.4,
  materialsPerLabor: 0.15,
  knowledgePerScientist: 1.4,
  knowledgePerLabor: 0.05,
  bunkerWaterReclaimer: 5,
  adultNeed: 1,
  childNeed: 0.6,
  foodSpoilage: 0.15,
  waterLoss: 0.1,
  materialsUpkeepPerResident: 0.12,
  materialsUpkeepPerLevel: 2,
  /** Share of materials spent on upkeep that engineers recover. */
  recycleShare: 0.3,
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
    // Seasons spent on chosen work are not spent on the daily round.
    const effort = (isAway(ctx.state, c) ? 0 : age >= ELDER_AGE ? 0.5 : 1) * ctx.freeShare(c.id);
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
  // Buildings work in proportion to their condition; broken ones (below 30) do nothing.
  const L = (f: FacilityId) => level(s, f);
  // Know-how spreads to everyone; infrastructure only helps where it stands.
  const grid = (t("power_grid") ? 1 + 0.1 * powerLevel(ctx.state, s) * L("power_lines") : 1) * (t("machining") ? 1.1 : 1);
  let food = s.kind === "bunker" ? 0.95 : 1.05;
  if (features.includes("fertile")) food *= 1.15;
  if (t("hydroponics")) food *= 1.2;
  // On the surface, everyday labour grows kitchen gardens and keeps a few animals; grain comes from the fields (farming.ts).
  if (s.kind !== "bunker") food *= 0.6;
  if (t("crop_genetics")) food *= 1.15;
  if (t("mass_farming")) food *= 1.15;
  if (ctx.state.flags["food.heirloom_seeds"]) food *= 1.1;
  food *= 1 + 0.1 * L("greenhouse");
  let water = 1;
  if (t("water_purification")) water *= 1.3;
  if (features.includes("clean_aquifer")) water *= 1.3;
  if (features.includes("river")) water *= 1.15;
  water *= 1 + 0.1 * L("watermill");
  water *= 1 + 0.1 * L("well");
  if (ctx.state.flags["governance.engineer_control"]) water *= 1.1;
  water *= grid;
  let materials = 1;
  if (features.includes("ruins")) materials *= 1.4;
  if (t("salvage_tools")) materials *= 1.4;
  const power = powerLevel(ctx.state, s);
  materials *= 1 + 0.1 * power;
  materials *= 1 + 0.1 * L("watermill");
  if (t("mechanical_power")) materials *= 1.1;
  materials *= 1 + (t("workshop") ? 0.2 : 0.1) * L("forge");
  if (t("metallurgy")) materials *= 1.2;
  materials *= grid;
  let knowledge = 1;
  knowledge *= 1 + 0.2 * power;
  if (t("archives")) knowledge *= 1.15;
  if (t("apprenticeship")) knowledge *= 1.1;
  if (t("schooling")) knowledge *= 1.25;
  if (t("research_institute")) knowledge *= 1.3;
  if (ctx.state.flags["mystery.halcyon_archive"]) knowledge *= 1.15;
  knowledge *= 1 + 0.1 * L("schoolhouse");
  // Processes people have worked out here.
  const P = (k: "food" | "water" | "materials" | "knowledge") => 1 + PROCESS_BONUS * (s.processes?.[k] ?? 0);
  return { food: food * P("food"), water: water * P("water"), materials: materials * P("materials"), knowledge: knowledge * P("knowledge") };
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
    // Foraging and everyday salvage come out of the land, which holds only so much.
    const loc = ctx.state.locations.find((l) => l.id === s.locationId);
    const forage = Math.min(w.scouts * ECONOMY.forageFoodPerScout * efficiency, loc?.wild ?? 0);
    if (loc) loc.wild = round2((loc.wild ?? 0) - forage);
    const made = materialsFrom(ctx, s, loc, (w.labor * ECONOMY.materialsPerLabor + w.engineers * ECONOMY.materialsPerEngineer) * m.materials * efficiency);
    const out: Record<ResourceId, number> = {
      food: (w.labor * ECONOMY.foodPerLabor + w.farmers * ECONOMY.foodPerFarmer) * m.food * season * efficiency + forage,
      water: (w.labor * ECONOMY.waterPerLabor * m.water * season) * efficiency + (s.kind === "bunker" ? ECONOMY.bunkerWaterReclaimer : 0),
      materials: made,
      knowledge: (w.scientists * ECONOMY.knowledgePerScientist + w.labor * ECONOMY.knowledgePerLabor) * m.knowledge * efficiency,
    };
    for (const r of Object.keys(out) as ResourceId[]) s.resources[r] = round2(s.resources[r] + out[r]);
    manufacture(ctx, s, w.engineers);
    const flow = (ctx.state.stats.flow ??= {});
    for (const r of Object.keys(out) as ResourceId[]) flow[`made_${r}`] = round2((flow[`made_${r}`] ?? 0) + out[r]);
  }
}

/**
 * Materials are never made from nothing. Work takes reusable materials out of
 * the old world's salvage, and timber and ore out of the land. Timber and ore
 * are not yet anything useful: see `manufacture`. While salvage lasts only part
 * of the effort goes to camps and mines, and only while their stock is low;
 * once it is gone they are all there is.
 */
export function materialsFrom(ctx: TickContext, s: Settlement, loc: LocationState | undefined, capacity: number): number {
  if (!loc || capacity <= 0) return 0;
  const stats = (ctx.state.stats.materialsBySource ??= { salvage: 0, timber: 0, ore: 0 });
  const salvageLeft = (loc.salvage ?? 0) > 0;
  const raw = salvageLeft ? capacity * INDUSTRY.extractionShare : capacity;
  const tools = good(s, "parts") > 0 ? 1 : INDUSTRY.noTools;
  // Without a camp people still gather deadwood and cut a little by hand.
  const camp = Math.max(0.3, level(s, "lumber_camp"));
  const mine = level(s, "mine");
  const canCut = (loc.timber ?? 0) > 0;
  const canDig = (loc.ore ?? 0) > 0 && mine > 0;
  const cutEffort = canCut ? (canDig ? raw / 2 : raw) : 0;
  const digEffort = canDig ? raw - cutEffort : 0;
  const timber = round2(Math.min(cutEffort * camp * tools, loc.timber ?? 0, salvageLeft ? Math.max(0, INDUSTRY.target.timber - good(s, "timber")) : Infinity));
  // Ore is finite: it is dug to meet the forge's need, never just because there are hands free.
  const ore = round2(Math.min(digEffort * mine * tools, loc.ore ?? 0, Math.max(0, INDUSTRY.target.ore - good(s, "ore"))));
  const spent = timber / (camp * tools) + (ore > 0 ? ore / (mine * tools) : 0);
  loc.timber = round2((loc.timber ?? 0) - timber);
  loc.ore = round2((loc.ore ?? 0) - ore);
  if (timber > 0) addGood(s, "timber", timber);
  if (ore > 0) addGood(s, "ore", ore);
  const wear = round2((timber + ore) * INDUSTRY.toolWear);
  if (wear > 0) addGood(s, "parts", -Math.min(wear, good(s, "parts")));
  const salvage = Math.min(capacity - spent, loc.salvage ?? 0);
  const taken = Math.max(0, salvage);
  loc.salvage = round2((loc.salvage ?? 0) - taken);
  stats.salvage = round2(stats.salvage + taken);
  const made = (ctx.state.stats.made ??= {});
  made.timber = round2((made.timber ?? 0) + timber);
  made.ore = round2((made.ore ?? 0) + ore);
  return taken;
}

/**
 * The year's routine production, limited by engineers and working buildings:
 * ore and fuel become metal at a forge; metal and timber become tools and
 * components at a workshop; what is left over is sawn or wrought into building
 * materials. Inputs always leave the store as outputs enter it.
 */
export function manufacture(ctx: TickContext, s: Settlement, engineers: number): void {
  const stats = (ctx.state.stats.materialsBySource ??= { salvage: 0, timber: 0, ore: 0 });
  const made = (ctx.state.stats.made ??= {});
  const { smelt, craft } = INDUSTRY;
  const forge = level(s, "forge");
  if (forge > 0) {
    const batches = Math.floor(Math.min(good(s, "ore") / smelt.ore, good(s, "timber") / smelt.timber, engineers * INDUSTRY.smeltPerEngineer * forge, Math.max(0, INDUSTRY.target.metal - good(s, "metal")) / smelt.metal));
    if (batches > 0) {
      addGood(s, "ore", -batches * smelt.ore);
      addGood(s, "timber", -batches * smelt.timber);
      addGood(s, "metal", batches * smelt.metal);
      made.metal = round2((made.metal ?? 0) + batches * smelt.metal);
    }
  }
  const shop = level(s, "workshop");
  if (shop > 0) {
    const batches = Math.floor(Math.min(good(s, "metal") / craft.metal, good(s, "timber") / craft.timber, engineers * INDUSTRY.craftPerEngineer * shop, Math.max(0, INDUSTRY.target.parts - good(s, "parts")) / craft.parts));
    if (batches > 0) {
      addGood(s, "metal", -batches * craft.metal);
      addGood(s, "timber", -batches * craft.timber);
      addGood(s, "parts", batches * craft.parts);
      made.parts = round2((made.parts ?? 0) + batches * craft.parts);
    }
  }
  // Surplus timber and metal go into building materials.
  const sawn = round2(Math.max(0, good(s, "timber") - INDUSTRY.timberReserve));
  if (sawn > 0) {
    addGood(s, "timber", -sawn);
    s.resources.materials = round2(s.resources.materials + sawn);
    stats.timber = round2(stats.timber + sawn);
  }
  const wrought = round2(Math.max(0, good(s, "metal") - INDUSTRY.metalReserve));
  if (wrought > 0 && s.resources.materials < INDUSTRY.enoughMaterials) {
    addGood(s, "metal", -wrought);
    const gained = round2(wrought * INDUSTRY.metalToMaterials);
    s.resources.materials = round2(s.resources.materials + gained);
    stats.ore = round2(stats.ore + gained);
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
      const loss = r === "food" ? ECONOMY.foodSpoilage * (hasTech(ctx.state, "mass_farming") ? 0.5 : 1) * (1 - 0.5 * level(s, "granary")) : ECONOMY.waterLoss;
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

    const flow = (ctx.state.stats.flow ??= {});
    flow.eaten = round2((flow.eaten ?? 0) + need);
    const upkeep = w.residents * ECONOMY.materialsUpkeepPerResident + s.level * ECONOMY.materialsUpkeepPerLevel + (hasLaw(s, "sanitation") ? 2 : 0);
    if (s.resources.materials < upkeep) s.morale = Math.max(0, s.morale - 3); // infrastructure decays
    const paid = Math.min(upkeep, s.resources.materials);
    // Engineers recover part of what wears out (scrap, offcuts, broken tools): never more than was used.
    const recycle = level(s, "workshop") > 0 && good(s, "parts") > 0 ? INDUSTRY.workshopRecycle : ECONOMY.recycleShare;
    const recycled = w.engineers > 0 ? paid * recycle : 0;
    s.resources.materials = round2(Math.max(0, s.resources.materials - paid + recycled));
    flow.upkeep = round2((flow.upkeep ?? 0) + paid);
    flow.recycled = round2((flow.recycled ?? 0) + recycled);
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
    // Who runs the water: an elected council is trusted; engineers in charge are efficient but resented.
    if (st.flags["governance.water_council"]) morale += 3;
    if (st.flags["governance.engineer_control"]) morale -= 2;
    // The founders' memorial was torn down: Haven Deep's oldest families never forgave it.
    if (st.flags["society.founders_repudiated"] && s.kind === "bunker") morale -= 3;
    if (st.flags["society.closed_gates"]) morale += 2;
    morale += 3 * level(s, "meeting_hall");
    // How the settlement is governed: an assembly gives people a voice.
    if (st.flags["governance.assembly"]) morale += 2;
    if (hasLaw(s, "rationing")) morale -= 3;
    if (hasLaw(s, "work_duty")) morale -= 4;
    if (hasLaw(s, "shared_stores")) morale += 2;
    if (hasLaw(s, "curfew")) morale -= 2;
    if (st.flags["society.bunker_first"] && s.kind === "bunker") morale += 4;
    if (st.flags["society.surface_first"] && s.kind === "bunker") morale -= 3;

    let health = 58 + Math.min(20, w.medics * 4) + 2 * (s.processes?.health ?? 0);
    if (hasTech(st, "field_medicine")) health += 8;
    if (hasTech(st, "antibiotics")) health += 10;
    if (hasTech(st, "water_purification")) health += 4;
    health += 5 * level(s, "clinic");
    if (hasLaw(s, "sanitation")) health += 4;
    health -= d.food * 30 + d.water * 40;
    if (crowded) health -= 10;

    s.morale = round2(Math.min(100, Math.max(0, s.morale + (morale - s.morale) * 0.3)));
    s.health = round2(Math.min(100, Math.max(0, s.health + (health - s.health) * 0.3)));
  }
}
