import { ADULT_AGE, FARM, type Settlement } from "@genesis/schemas";
import { activeSettlements, characterAge, facilityLevel, hasTech, residents, round2, say, tensionBetween } from "@genesis/narrative";
import type { TickContext } from "../context";
import { isAway } from "./legacy";

/**
 * Surface farming as a production system, separate from the bunker's racks:
 * seed in store → sown in spring on working fields → crops in the ground →
 * harvested in autumn. The harvest depends on how much was sown, soil
 * fertility, the farm plan, known techniques and the year; part of it is kept
 * back as seed. Crops belong to the settlement: they survive the farmer who
 * sowed them.
 */
export const FARMING = {
  /** Chance a harvest mostly fails (blight, hail, a late frost). */
  failureChance: 0.07,
  failureLoss: 0.7,
  /** Non-farmers help with sowing at a quarter of a farmer's pace. */
  helperShare: 0.25,
  /** A settlement whose seed falls below this asks a neighbour for some. */
  seedShortfall: 10,
  seedGift: 15,
  soilRecovery: 0.15,
} as const;

const farmOf = (s: Settlement) => (s.farm ??= { seeds: 0, fertility: 100, crops: [], harvests: 0 });

/** Spring: sow what the fields, the farmers and the seed store allow. */
export function sowing(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    if (s.kind === "bunker") continue;
    const fields = facilityLevel(s, "fields");
    if (fields <= 0) continue;
    const farm = farmOf(s);
    const adults = residents(st, s.id).filter((c) => characterAge(st, c) >= ADULT_AGE && !isAway(st, c));
    const workers = adults.filter((c) => c.profession === "Farmer").length + FARMING.helperShare * adults.filter((c) => c.profession !== "Farmer").length;
    const sow = round2(Math.min(farm.seeds, workers * FARM.seedPerFarmer * fields));
    if (sow <= 0) continue;
    farm.seeds = round2(farm.seeds - sow);
    farm.crops.push({ plantedSeason: st.tick * 4, readySeason: st.tick * 4 + 2, seeds: sow });
  }
}

/** Autumn: bring in every crop that is ripe this year. Runs after the year's storms. */
export function harvest(ctx: TickContext): void {
  const st = ctx.state;
  const until = (st.tick + 1) * 4;
  for (const s of activeSettlements(st)) {
    const farm = s.farm;
    if (!farm || farm.crops.length === 0) continue;
    const ripe = farm.crops.filter((c) => c.readySeason < until);
    if (ripe.length === 0) continue;
    farm.crops = farm.crops.filter((c) => c.readySeason >= until);
    const sown = ripe.reduce((n, c) => n + c.seeds, 0);
    const plan = FARM.plans[farm.plan ?? "seedsave"];
    let tech = 1;
    if (hasTech(st, "irrigation")) tech *= 1 + 0.25 * facilityLevel(s, "fields");
    if (hasTech(st, "crop_genetics")) tech *= 1.15;
    if (hasTech(st, "mass_farming")) tech *= 1.15;
    if (st.flags["food.heirloom_seeds"]) tech *= 1.1;
    const weather = Math.min(1.3, Math.max(0.6, ctx.rng.gaussian(1, 0.15)));
    const failed = ctx.rng.chance(FARMING.failureChance);
    // Nobody left to bring it in: most of it rots in the field.
    const hands = residents(st, s.id).some((c) => characterAge(st, c) >= ADULT_AGE) ? 1 : 0.2;
    const crop = round2(sown * FARM.yieldPerSeed * (farm.fertility / 100) * plan.yield * tech * weather * (failed ? 1 - FARMING.failureLoss : 1) * hands);
    const keep = round2(crop * Math.min(0.8, FARM.seedKeep + plan.keep));
    const food = round2(crop - keep);
    const before = { food: s.resources.food, seeds: farm.seeds, fertility: farm.fertility };
    s.resources.food = round2(s.resources.food + food);
    farm.seeds = round2(farm.seeds + keep);
    // Soil drifts back toward ordinary between harvests; the plan decides where it settles
    // (hard use about 60, the default about 87, rotation about 127).
    farm.fertility = round2(Math.max(20, Math.min(150, farm.fertility + plan.fertility + (100 - farm.fertility) * FARMING.soilRecovery)));
    farm.harvests += 1;
    const first = farm.harvests === 1;
    if (first || failed) {
      ctx.system({
        category: "resource",
        importance: first ? "notable" : "minor",
        title: failed ? say(st).harvestFailedTitle(s.name) : say(st).firstHarvestTitle(s.name),
        text: failed ? say(st).harvestFailedText(s.name, Math.round(sown), Math.round(crop)) : say(st).firstHarvestText(s.name, Math.round(sown), Math.round(crop)),
        settlementIds: [s.id],
        characterIds: st.characters.filter((c) => c.deathTick === null && c.controllerId && c.homeId === s.id).map((c) => c.id),
        changes: [
          { path: `settlements.${s.id}.resources.food`, label: `${s.name} food`, before: before.food, after: s.resources.food },
          { path: `settlements.${s.id}.farm.seeds`, label: `${s.name} seed`, before: before.seeds, after: farm.seeds },
          { path: `settlements.${s.id}.farm.fertility`, label: `${s.name} fertility`, before: before.fertility, after: farm.fertility },
        ],
        summary: `${round2(sown)} seed sown; fertility ${before.fertility}; plan ${farm.plan ?? "seedsave"}${failed ? "; crop failure" : ""}`,
      });
    }
  }
}

/** A farm out of seed gets some from a neighbour that has plenty, unless they are at odds. Seed moves; none is made. */
export function seedSharing(ctx: TickContext): void {
  const st = ctx.state;
  const active = activeSettlements(st);
  for (const needy of active) {
    if (needy.kind === "bunker" || facilityLevel(needy, "fields") <= 0 || (needy.farm?.seeds ?? 0) >= FARMING.seedShortfall) continue;
    const donor = active
      .filter((d) => d.id !== needy.id && (d.farm?.seeds ?? 0) >= FARMING.seedGift * 3 && tensionBetween(st, d.id, needy.id) < 50)
      .sort((a, b) => (b.farm!.seeds - a.farm!.seeds) || (a.id < b.id ? -1 : 1))[0];
    if (!donor) continue;
    const before = { d: donor.farm!.seeds, n: needy.farm?.seeds ?? 0 };
    donor.farm!.seeds = round2(before.d - FARMING.seedGift);
    farmOf(needy).seeds = round2(before.n + FARMING.seedGift);
    ctx.system({
      category: "resource",
      importance: "minor",
      title: say(st).seedGiftTitle(donor.name, needy.name),
      text: say(st).seedGiftText(donor.name, needy.name, FARMING.seedGift),
      settlementIds: [donor.id, needy.id],
      changes: [
        { path: `settlements.${donor.id}.farm.seeds`, label: `${donor.name} seed`, before: before.d, after: donor.farm!.seeds },
        { path: `settlements.${needy.id}.farm.seeds`, label: `${needy.name} seed`, before: before.n, after: needy.farm!.seeds },
      ],
    });
  }
}
