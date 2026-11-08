import {
  ADULT_AGE,
  BRANCHES,
  BRANCH_INFO,
  GOOD_INFO,
  GOODS,
  INDUSTRY,
  INFRASTRUCTURE,
  LOCATION_BY_ID,
  MAX_PROCESS,
  MAX_UPGRADE,
  MECHANICAL,
  NPC_BUILD_BASE,
  NPC_BUILD_PEOPLE,
  PRIORITY_INFO,
  PROCESSES,
  RESOURCES,
  SPECIALTY_INFO,
  TECHNOLOGIES,
  TECH_BY_ID,
  WORK_ACTIONS,
  WORK_BY_ID,
  ZH_CATALOG,
  type Activity,
  type BranchId,
  type Character,
  type FacilityId,
  type GoodId,
  type PriorityId,
  type ResourceId,
  type Settlement,
  type StateChange,
  type WorkActionInfo,
  type WorldState,
} from "@genesis/schemas";
import {
  activeSettlements,
  addGood,
  addPractice,
  applyEffect,
  characterAge,
  discoverLocation,
  EffectError,
  facilityLevel,
  facilityName,
  fullName,
  getCharacter,
  getSettlement,
  good,
  headOf,
  isAwayNow,
  isFarmable,
  isZh,
  newRecorder,
  notify,
  placeName,
  proposalKey,
  residents,
  round2,
  say,
  specialtyName,
  techText,
  transact,
} from "@genesis/narrative";
import type { Effect } from "@genesis/schemas";
import type { TickContext } from "../context";

/**
 * Work people choose to do. One system for players and NPCs: a character
 * commits seasons of their own year to an action. It is checked and paid for
 * when committed, occupies those seasons, and is resolved exactly once when its
 * last season is simulated. Nothing here depends on a story event firing.
 */
export const WORK = {
  /** A plan can only reach into the coming year. */
  planningSeasons: 4,
  /** How many of a profession's people act on their own each year: the head, plus one per this many. */
  npcPerWorkers: 8,
  npcMax: 3,
  /** Health below this makes someone a patient. */
  patient: 70,
  logSize: 80,
} as const;

type Bundle = { resources: Partial<Record<ResourceId, number>>; goods: Partial<Record<GoodId, number>> };
const none: Bundle = { resources: {}, goods: {} };

interface Outcome {
  ok: boolean;
  title: string;
  text: string;
  changes: StateChange[];
  /** A person who was treated, or anyone else who should see this. */
  others?: string[];
  important?: boolean;
}

interface Rule {
  /** Why it cannot be done now, or null. */
  blocker(st: WorldState, s: Settlement, c: Character, target: string | undefined, startSeason: number): string | null;
  cost(st: WorldState, s: Settlement, target: string | undefined): Bundle;
  /** Seasons it takes, when that depends on the target. */
  seasons?(st: WorldState, s: Settlement, target: string | undefined): number;
  /** Choices the player has for it. */
  targets?(st: WorldState, s: Settlement, c: Character): { id: string; label: string }[];
  /** Runs when the work is finished. */
  finish?(ctx: TickContext, a: Activity, c: Character, s: Settlement, skill: number): Outcome;
  /** Effects of the proposal, for shared work by someone not in charge. */
  proposal?(st: WorldState, s: Settlement, c: Character, target: string | undefined, startSeason: number): { title: string; effects: Effect[]; tags: string[]; domain?: "Farmer" | "Engineer" | "Scientist" | "Scout" | "Medic" };
  /** How much an NPC wants to do this now (0 = not at all). */
  npc(st: WorldState, s: Settlement, target?: string): number;
}

const tx = (st: WorldState, zh: string, en: string) => (isZh(st) ? zh : en);
const perHead = (st: WorldState, s: Settlement, r: ResourceId) => s.resources[r] / Math.max(1, residents(st, s.id).length);
const facilityOk = (s: Settlement, f: FacilityId) => facilityLevel(s, f) > 0;
const res = (st: WorldState, r: ResourceId | GoodId) => (GOODS as readonly string[]).includes(r) ? (isZh(st) ? GOOD_INFO[r as GoodId].zh : GOOD_INFO[r as GoodId].name) : (isZh(st) ? ({ food: "食物", water: "水", materials: "物資", knowledge: "知識" } as Record<string, string>)[r]! : r);

function adjust(s: Settlement, r: ResourceId, delta: number, changes: StateChange[]): void {
  const before = s.resources[r];
  s.resources[r] = round2(Math.max(0, before + delta));
  changes.push({ path: `settlements.${s.id}.resources.${r}`, label: `${s.name} ${r}`, before, after: s.resources[r] });
}

function adjustGood(s: Settlement, g: GoodId, delta: number, changes: StateChange[]): void {
  const before = good(s, g);
  addGood(s, g, delta);
  changes.push({ path: `settlements.${s.id}.goods.${g}`, label: `${s.name} ${g}`, before, after: good(s, g) });
}

function setFacility(s: Settlement, f: FacilityId, value: number, changes: StateChange[]): void {
  const before = s.facilities?.[f] ?? null;
  const after = round2(Math.max(0, Math.min(100, value)));
  s.facilities = { ...(s.facilities ?? {}), [f]: after };
  changes.push({ path: `settlements.${s.id}.facilities.${f}`, label: `${s.name} ${f}`, before, after });
}

/** Whether a settlement would put up another building without someone choosing to. */
export function mayAddBuilding(st: WorldState, s: Settlement): boolean {
  const up = Object.values(s.facilities ?? {}).filter((c) => (c ?? 0) >= 30).length + Object.keys(s.building ?? {}).length;
  return s.priority !== "hoard" && up < NPC_BUILD_BASE + Math.floor(residents(st, s.id).length / NPC_BUILD_PEOPLE);
}

const standing = (s: Settlement) => Object.entries(s.facilities ?? {}) as [FacilityId, number][];

function buildable(st: WorldState, s: Settlement): FacilityId[] {
  const here = st.locations.find((l) => l.id === s.locationId);
  const features = LOCATION_BY_ID[s.locationId]?.features ?? [];
  return (Object.entries(INFRASTRUCTURE) as [FacilityId, NonNullable<(typeof INFRASTRUCTURE)[FacilityId]>][])
    .filter(([f, i]) => st.technologies.includes(i.tech) && (!i.needs || features.includes(i.needs)) && (!i.after || facilityOk(s, i.after)) && (!i.deposit || (here?.[i.deposit] ?? 0) > 0) && !facilityOk(s, f) && s.building?.[f] === undefined)
    .map(([f]) => f);
}

const needsFix = (s: Settlement) => standing(s).filter(([f, cond]) => cond < 100 && s.building?.[f] === undefined);
const patientsOf = (st: WorldState, s: Settlement) => residents(st, s.id).filter((c) => (c.attributes?.health ?? 100) < WORK.patient && !isAwayNow(st, c)).sort((a, b) => a.attributes!.health - b.attributes!.health || (a.id < b.id ? -1 : 1));
const GROUP_AGES: Record<string, (age: number) => boolean> = { children: (a) => a < ADULT_AGE, elders: (a) => a >= 60, workers: (a) => a >= ADULT_AGE && a < 60 };
const groupOf = (st: WorldState, s: Settlement, g: string) => patientsOf(st, s).filter((c) => GROUP_AGES[g]?.(characterAge(st, c)));
const unknownSites = (st: WorldState) => st.locations.filter((l) => !l.discovered && !LOCATION_BY_ID[l.id]?.hidden);
const salvageSites = (st: WorldState, s: Settlement) => st.locations.filter((l) => l.discovered && (l.salvage ?? 0) > 0 && (l.id === s.locationId || !l.settlementId));
const claimSites = (st: WorldState) => st.locations.filter((l) => l.discovered && !l.settlementId && !l.claimedBy && l.id !== "haven_deep" && !LOCATION_BY_ID[l.id]?.hidden);
const openTechs = (st: WorldState) => TECHNOLOGIES.filter((t) => !st.technologies.includes(t.id));
const siteLabel = (st: WorldState, id: string) => placeName(st, id);
const techLabel = (st: WorldState, id: string) => techText(st, id).name;
const groupLabel = (st: WorldState, g: string) => tx(st, { children: "孩子", elders: "長者", workers: "工作的人" }[g] ?? g, g);
const processLabel = (st: WorldState, p: string) => tx(st, { food: "糧食生產", water: "用水", materials: "物資生產", knowledge: "知識整理" }[p] ?? p, p);
const branchLabel = (st: WorldState, b: BranchId) => (isZh(st) ? ZH_CATALOG.branch[b] : BRANCH_INFO[b].name);

const r = (resources: Bundle["resources"], goods: Bundle["goods"] = {}): Bundle => ({ resources, goods });
const noneLeft = (zh: string, en: string) => (st: WorldState) => tx(st, zh, en);

const RULES: Record<string, Rule> = {
  /* ---------------- Farmer ---------------- */
  farm_clear: {
    blocker: (st, s) => {
      if (s.kind === "bunker") return tx(st, "地堡裡沒有地可以開墾", "There is no ground to break in a bunker");
      if (!isFarmable(st, s)) return tx(st, "這裡的土地種不了東西", "This land cannot be farmed");
      if (facilityOk(s, "fields") || s.building?.fields !== undefined) return tx(st, "田已經有了，或正在整地", "Fields are already here or being laid out");
      return null;
    },
    cost: () => r({ materials: 5 }),
    proposal: (st, s) => ({ title: tx(st, `在${s.name}開墾新田（5 份物資，兩季）`, `Break new fields at ${s.name}`), tags: ["growth"], domain: "Farmer", effects: [{ type: "SPEND", costs: { materials: 5 } } as Effect, { type: "BUILD_FACILITY", facility: "fields", seasons: 2 } as Effect] }),
    finish: (ctx, a, c, s) => ({ ok: true, title: tx(ctx.state, `${fullName(c)}把荒地整成了田`, `${fullName(c)} broke new fields`), text: tx(ctx.state, `${s.name}有了田。明年春天起，這片地年年都能播種，不管是誰在種。`, `${s.name} has fields now. They will be sown every spring, whoever does the sowing.`), changes: [], important: true }),
    // The first fields are usually a story of their own; people get on with it if that never comes.
    npc: (st, s) => (s.kind !== "bunker" && st.tick - s.foundedTick >= 4 && (s.farm?.seeds ?? 0) >= 6 ? 6 : 0),
  },
  farm_tend: {
    blocker: (st, s, _c, _t, start) => {
      if (s.kind === "bunker") return s.resources.water < 4 ? tx(st, "水不夠灌溉種植架", "Not enough water for the racks") : null;
      if (!facilityOk(s, "fields")) return tx(st, "這裡還沒有能用的田", "There are no working fields here");
      if ((s.farm?.seeds ?? 0) <= 0 && !(s.farm?.crops.length)) return tx(st, "沒有種子，田裡不會有東西可照料", "No seed: nothing to tend");
      if (start % 4 > 1) return tx(st, "作物秋天就收了，太晚了", "Too late in the year: crops come in at autumn");
      return null;
    },
    cost: () => r({ water: 4 }),
    finish: (ctx, _a, c, s, skill) => {
      const st = ctx.state;
      const changes: StateChange[] = [];
      if (s.kind === "bunker") {
        const food = round2(7 * skill);
        adjust(s, "food", food, changes);
        return { ok: true, title: tx(st, `${fullName(c)}照料了種植架`, `${fullName(c)} tended the racks`), text: tx(st, `${s.name}多收了 ${food} 份食物。`, `${s.name} gets ${food} more food.`), changes };
      }
      const crops = s.farm?.crops ?? [];
      if (crops.length === 0) return { ok: false, title: tx(st, `${fullName(c)}白忙一場`, `${fullName(c)} found nothing to tend`), text: tx(st, "田裡今年沒有作物。", "Nothing was in the ground this year."), changes };
      const before = round2(crops.reduce((n, x) => n + x.seeds, 0));
      for (const x of crops) x.seeds = round2(x.seeds * (1 + 0.12 * skill));
      const after = round2(crops.reduce((n, x) => n + x.seeds, 0));
      changes.push({ path: `settlements.${s.id}.farm.crops`, label: `${s.name} crops`, before, after });
      return { ok: true, title: tx(st, `${fullName(c)}照料了田裡的作物`, `${fullName(c)} tended the crops`), text: tx(st, `田裡的作物長得更好了，今年秋天會多收一些（${before} → ${after}）。`, `The crop is doing better (${before} → ${after}).`), changes };
    },
    npc: (st, s) => (s.kind === "bunker" ? (perHead(st, s, "food") < 3 ? 3 : 1) : (s.farm?.seeds ?? 0) > 0 ? 3 : 0),
  },
  farm_soil: {
    blocker: (st, s) => (s.kind === "bunker" ? tx(st, "地堡沒有土壤可改良", "A bunker has no soil") : !facilityOk(s, "fields") ? tx(st, "這裡還沒有能用的田", "There are no working fields") : (s.farm?.fertility ?? 100) >= 145 ? tx(st, "土已經夠肥了", "The soil is as good as it gets") : null),
    cost: () => r({ materials: 4, food: 4 }),
    finish: (ctx, _a, c, s, skill) => {
      const st = ctx.state;
      const farm = s.farm!;
      const before = farm.fertility;
      farm.fertility = round2(Math.min(150, before + 7 * skill));
      return { ok: true, title: tx(st, `${fullName(c)}改良了${s.name}的土`, `${fullName(c)} improved the soil at ${s.name}`), text: tx(st, `土壤肥力從 ${Math.round(before)} 升到 ${Math.round(farm.fertility)}。之後的每一季收成都受益，不管是誰在種。`, `Fertility rose from ${Math.round(before)} to ${Math.round(farm.fertility)}, for every harvest to come.`), changes: [{ path: `settlements.${s.id}.farm.fertility`, label: `${s.name} fertility`, before, after: farm.fertility }] };
    },
    npc: (_st, s) => (s.kind !== "bunker" && (s.farm?.fertility ?? 100) < 95 ? 4 : 0),
  },
  farm_seed: {
    blocker: (st, s) => (!s.farm ? tx(st, "這裡沒有種子庫", "There is no seed store here") : null),
    cost: () => r({ food: 8 }),
    finish: (ctx, _a, c, s, skill) => {
      const st = ctx.state;
      const farm = s.farm!;
      const got = round2(Math.min(8, 4.5 * skill));
      const before = farm.seeds;
      farm.seeds = round2(before + got);
      return { ok: true, title: tx(st, `${fullName(c)}選出了一批好種`, `${fullName(c)} put by good seed`), text: tx(st, `${s.name}的種子多了 ${got} 份，來年能多播一些。`, `${got} more seed in store for next spring.`), changes: [{ path: `settlements.${s.id}.farm.seeds`, label: `${s.name} seed`, before, after: farm.seeds }] };
    },
    npc: (st, s) => (s.kind !== "bunker" && (s.farm?.seeds ?? 0) < 20 && perHead(st, s, "food") > 2 ? 5 : 0),
  },

  /* ---------------- Engineer ---------------- */
  eng_build: {
    targets: (st, s) => buildable(st, s).map((f) => ({ id: f, label: facilityName(st, f) })),
    blocker: (st, s, _c, target) => {
      if (!target || !buildable(st, s).includes(target as FacilityId)) return tx(st, "這項設施現在蓋不了", "That cannot be built here now");
      return null;
    },
    cost: (_st, _s, target) => { const i = INFRASTRUCTURE[target as FacilityId]; return r({ materials: i?.materials ?? 0 }, i?.parts ? { parts: i.parts } : {}); },
    seasons: (_st, _s, target) => INFRASTRUCTURE[target as FacilityId]?.seasons ?? 2,
    proposal: (st, s, _c, target) => {
      const i = INFRASTRUCTURE[target as FacilityId]!;
      return { title: tx(st, `蓋一座${facilityName(st, target as FacilityId)}（${i.materials} 份物資${i.parts ? `、${i.parts} 份零件` : ""}，${i.seasons} 季）`, `Build a ${target}`), tags: ["industry", "growth"], domain: "Engineer", effects: [{ type: "SPEND", costs: { materials: i.materials }, ...(i.parts ? { goods: { parts: i.parts } } : {}) } as Effect, { type: "BUILD_FACILITY", facility: target as FacilityId, seasons: i.seasons } as Effect] };
    },
    finish: (ctx, a, c, s) => ({ ok: true, title: tx(ctx.state, `${fullName(c)}蓋好了${facilityName(ctx.state, a.target as FacilityId)}`, `${fullName(c)} finished the ${a.target}`), text: tx(ctx.state, `${s.name}多了一座${facilityName(ctx.state, a.target as FacilityId)}。它會一直在，直到沒人保養為止。`, `${s.name} now has a ${a.target}.`), changes: [], important: true }),
    // On their own initiative people respect what the settlement decided and what its people can tend.
    npc: (st, s, target) => { const i = INFRASTRUCTURE[target as FacilityId]; return i && mayAddBuilding(st, s) && s.resources.materials >= i.materials + (i.deposit ? 0 : 20) ? 2 : 0; },
  },
  eng_inspect: {
    blocker: (st, s) => (standing(s).filter(([, cond]) => cond >= 30).length === 0 ? tx(st, "這裡沒有能保養的設施", "Nothing here to service") : null),
    cost: () => r({ materials: 2 }),
    finish: (ctx, _a, c, s, skill) => {
      const changes: StateChange[] = [];
      const items = standing(s).filter(([, cond]) => cond >= 30);
      for (const [f, cond] of items) setFacility(s, f, cond + 3 * skill, changes);
      return { ok: items.length > 0, title: tx(ctx.state, `${fullName(c)}巡檢了${s.name}的設施`, `${fullName(c)} serviced ${s.name}`), text: tx(ctx.state, `${items.length} 座設施的狀況都好了一點。`, `${items.length} buildings are in better shape.`), changes };
    },
    npc: (_st, s) => (s.resources.materials > 60 && standing(s).some(([, cond]) => cond >= 30 && cond < 85) ? 1 : 0),
  },
  eng_repair: {
    targets: (st, s) => needsFix(s).sort((a, b) => a[1] - b[1]).map(([f, cond]) => ({ id: f, label: `${facilityName(st, f)}（${Math.round(cond)}）` })),
    blocker: (st, s, _c, target) => {
      const cond = s.facilities?.[target as FacilityId];
      if (cond === undefined) return tx(st, "這裡沒有這項設施", "No such building here");
      if (cond >= 100) return tx(st, "它的狀況很好", "It is in good shape");
      if (s.building?.[target as FacilityId] !== undefined) return tx(st, "已經有人在修了", "Someone is already on it");
      return null;
    },
    cost: (_st, s, target) => {
      const cond = s.facilities?.[target as FacilityId] ?? 0;
      return r({ materials: Math.max(1, Math.ceil((100 - cond) / 8)) }, MECHANICAL.includes(target as FacilityId) && cond < 30 ? { parts: 2 } : {});
    },
    seasons: (_st, s, target) => ((s.facilities?.[target as FacilityId] ?? 0) < 30 ? 2 : 1),
    finish: (ctx, a, c, s, skill) => {
      const f = a.target as FacilityId;
      const cond = s.facilities?.[f];
      const changes: StateChange[] = [];
      if (cond === undefined) return { ok: false, title: tx(ctx.state, "要修的東西已經不在了", "It was gone"), text: tx(ctx.state, "等開工時，那座設施已經沒了。", "The building was already gone."), changes };
      setFacility(s, f, cond + 45 * skill, changes);
      return { ok: true, title: tx(ctx.state, `${fullName(c)}修好了${facilityName(ctx.state, f)}`, `${fullName(c)} repaired the ${f}`), text: tx(ctx.state, `${facilityName(ctx.state, f)}的狀況從 ${Math.round(cond)} 回到 ${Math.round(s.facilities![f]!)}。`, `Condition ${Math.round(cond)} → ${Math.round(s.facilities![f]!)}.`), changes };
    },
    npc: (_st, s, target) => ((s.facilities?.[target as FacilityId] ?? 100) < 60 ? 5 : 0),
  },
  eng_improve: {
    targets: (st, s) => standing(s).filter(([f, cond]) => cond >= 60 && (s.upgrades?.[f] ?? 0) < MAX_UPGRADE).map(([f]) => ({ id: f, label: `${facilityName(st, f)}（+${(s.upgrades?.[f] ?? 0) * 15}%）` })),
    blocker: (st, s, _c, target) => {
      if (!st.technologies.includes("workshop")) return tx(st, "要先有工坊技術", "Needs the Workshops technology");
      const cond = s.facilities?.[target as FacilityId];
      if (cond === undefined || cond < 60) return tx(st, "設施要先修到一定程度才能改良", "Repair it first");
      if ((s.upgrades?.[target as FacilityId] ?? 0) >= MAX_UPGRADE) return tx(st, "已經改到極限了", "Already improved as far as it goes");
      return null;
    },
    cost: () => r({ materials: 8 }, { parts: 4 }),
    finish: (ctx, a, c, s) => {
      const f = a.target as FacilityId;
      const before = s.upgrades?.[f] ?? 0;
      const changes: StateChange[] = [];
      if (s.facilities?.[f] === undefined) return { ok: false, title: tx(ctx.state, "要改良的東西已經不在了", "It was gone"), text: "", changes };
      s.upgrades = { ...(s.upgrades ?? {}), [f]: before + 1 };
      changes.push({ path: `settlements.${s.id}.upgrades.${f}`, label: `${s.name} ${f} upgrade`, before, after: before + 1 });
      return { ok: true, title: tx(ctx.state, `${fullName(c)}改良了${facilityName(ctx.state, f)}`, `${fullName(c)} improved the ${f}`), text: tx(ctx.state, `${facilityName(ctx.state, f)}的效果永久提升了。`, `It now gives more, for good.`), changes };
    },
    npc: (_st, s) => (good(s, "parts") > 26 && s.resources.materials > 120 ? 1 : 0),
  },
  eng_smelt: {
    blocker: (st, s) => (!facilityOk(s, "forge") ? tx(st, "需要一座能用的鍛爐", "Needs a working forge") : null),
    cost: () => r({}, { ore: INDUSTRY.smelt.ore * 4, timber: INDUSTRY.smelt.timber * 4 }),
    finish: (ctx, _a, c, s) => {
      const changes: StateChange[] = [];
      const metal = INDUSTRY.smelt.metal * 4;
      adjustGood(s, "metal", metal, changes);
      const made = (ctx.state.stats.made ??= {});
      made.metal = round2((made.metal ?? 0) + metal);
      return { ok: true, title: tx(ctx.state, `${fullName(c)}開爐煉出了金屬`, `${fullName(c)} ran the forge`), text: tx(ctx.state, `8 份礦石、4 份木材，變成 ${metal} 份能用的金屬。`, `8 ore and 4 timber became ${metal} metal.`), changes };
    },
    npc: (_st, s) => (good(s, "metal") < 15 ? 3 : 0),
  },
  eng_craft: {
    blocker: (st, s) => (!facilityOk(s, "workshop") ? tx(st, "需要一座能用的工坊", "Needs a working workshop") : null),
    cost: () => r({}, { metal: INDUSTRY.craft.metal * 3, timber: INDUSTRY.craft.timber * 3 }),
    finish: (ctx, _a, c, s) => {
      const changes: StateChange[] = [];
      const parts = INDUSTRY.craft.parts * 3;
      adjustGood(s, "parts", parts, changes);
      const made = (ctx.state.stats.made ??= {});
      made.parts = round2((made.parts ?? 0) + parts);
      return { ok: true, title: tx(ctx.state, `${fullName(c)}做出了一批工具和零件`, `${fullName(c)} made tools and components`), text: tx(ctx.state, `3 份金屬、3 份木材，做成 ${parts} 份工具零件。`, `3 metal and 3 timber became ${parts} tools and components.`), changes };
    },
    npc: (_st, s) => (good(s, "parts") < 20 ? 4 : 0),
  },

  /* ---------------- Scientist ---------------- */
  sci_experiment: {
    blocker: () => null,
    cost: () => r({ knowledge: 6, materials: 3 }),
    finish: (ctx, _a, c, s, skill) => {
      const st = ctx.state;
      const changes: StateChange[] = [];
      if (!ctx.rng.chance(Math.min(0.9, 0.35 + 0.35 * skill))) return { ok: false, title: tx(st, `${fullName(c)}的實驗失敗了`, `${fullName(c)}'s experiment failed`), text: tx(st, "材料用掉了，結果不能用。但至少知道這條路走不通。", "The materials are gone and the result is useless."), changes };
      const gain = round2(14 * skill);
      adjust(s, "knowledge", gain, changes);
      const p = (st.projects ?? []).find((x) => x.settlementId === s.id);
      if (p) {
        const tech = TECH_BY_ID[p.techId]!;
        const before = p.progress;
        p.progress = round2(Math.min(tech.cost - 0.01, before + tech.cost * 0.03));
        p.contributions = { ...(p.contributions ?? {}), [c.id]: round2((p.contributions?.[c.id] ?? 0) + (p.progress - before)) };
        changes.push({ path: `projects.${p.id}.progress`, label: tech.name, before, after: p.progress });
      }
      return { ok: true, title: tx(st, `${fullName(c)}的實驗成功了`, `${fullName(c)}'s experiment worked`), text: tx(st, `${s.name}的知識增加 ${gain}${p ? "，手上的專案也往前推了一點" : ""}。`, `Knowledge +${gain}.`), changes };
    },
    npc: (_st, s) => (s.resources.knowledge > 20 && s.resources.materials > 45 ? 2 : 0),
  },
  sci_process: {
    targets: (st, s) => PROCESSES.filter((p) => (s.processes?.[p] ?? 0) < MAX_PROCESS).map((p) => ({ id: p, label: `${processLabel(st, p)}（${s.processes?.[p] ?? 0}/${MAX_PROCESS}）` })),
    blocker: (st, s, _c, target) => {
      if (!st.technologies.includes("archives")) return tx(st, "要先有紀錄保存", "Needs Record Keeping");
      if (!target || !(PROCESSES as readonly string[]).includes(target)) return tx(st, "選一項要改良的生產", "Choose a process");
      return (s.processes?.[target as "food"] ?? 0) >= MAX_PROCESS ? tx(st, "這項已經改到極限了", "That is as good as it gets") : null;
    },
    cost: () => r({ knowledge: 20, materials: 5 }),
    finish: (ctx, a, c, s) => {
      const key = a.target as "food";
      const before = s.processes?.[key] ?? 0;
      s.processes = { ...(s.processes ?? {}), [key]: before + 1 };
      return { ok: true, title: tx(ctx.state, `${fullName(c)}改良了${processLabel(ctx.state, key)}`, `${fullName(c)} improved ${key}`), text: tx(ctx.state, `${s.name}的${processLabel(ctx.state, key)}永久提升了。這個做法會留下來。`, `A lasting gain for ${s.name}.`), changes: [{ path: `settlements.${s.id}.processes.${key}`, label: `${s.name} process ${key}`, before, after: before + 1 }], important: true };
    },
    npc: (_st, s, target) => (s.resources.knowledge > 60 && (s.processes?.[target as "food"] ?? 0) < MAX_PROCESS ? 3 : 0),
  },
  sci_investigate: {
    targets: (st) => openTechs(st).sort((a, b) => a.tier - b.tier).slice(0, 8).map((t) => ({ id: t.id, label: techLabel(st, t.id) })),
    blocker: (st, _s, _c, target) => (!target || !TECH_BY_ID[target] ? tx(st, "選一項要研究的技術", "Choose a technology") : st.technologies.includes(target) ? tx(st, "這項已經會了", "Already known") : (st.techNotes?.[target] ?? 0) >= 0.3 ? tx(st, "筆記已經夠多了，要動手做了", "There are enough notes; it needs doing") : null),
    cost: () => r({ knowledge: 12 }),
    finish: (ctx, a, c, s, skill) => {
      const st = ctx.state;
      const t = TECH_BY_ID[a.target!]!;
      if (st.technologies.includes(t.id)) return { ok: false, title: tx(st, `${techLabel(st, t.id)}已經有人做出來了`, `${t.name} was already built`), text: tx(st, "筆記只好歸檔。", "The notes were filed."), changes: [] };
      const share = round2(Math.min(0.15, 0.08 * skill));
      const changes: StateChange[] = [];
      const p = (st.projects ?? []).find((x) => x.techId === t.id);
      if (p) {
        const before = p.progress;
        p.progress = round2(Math.min(t.cost - 0.01, before + t.cost * share));
        p.contributions = { ...(p.contributions ?? {}), [c.id]: round2((p.contributions?.[c.id] ?? 0) + (p.progress - before)) };
        changes.push({ path: `projects.${p.id}.progress`, label: t.name, before, after: p.progress });
      } else {
        const before = st.techNotes?.[t.id] ?? 0;
        st.techNotes = { ...(st.techNotes ?? {}), [t.id]: round2(Math.min(0.3, before + share)) };
        changes.push({ path: `techNotes.${t.id}`, label: t.name, before, after: st.techNotes[t.id]! });
      }
      return { ok: true, title: tx(st, `${fullName(c)}研究了${techLabel(st, t.id)}`, `${fullName(c)} investigated ${t.name}`), text: tx(st, `整理出來的筆記，能省下 ${Math.round(share * 100)}% 的工作。`, `The notes will save ${Math.round(share * 100)}% of the work.`), changes, important: true };
    },
    npc: (_st, s) => (s.resources.knowledge > 40 ? 1 : 0),
  },
  sci_priority: {
    targets: (st) => BRANCHES.map((b) => ({ id: b, label: branchLabel(st, b) })),
    blocker: (st, _s, _c, target) => (!target || !(BRANCHES as readonly string[]).includes(target) ? tx(st, "選一個方向", "Choose a branch") : null),
    cost: () => none,
    proposal: (st, _s, _c, target) => ({ title: tx(st, `議會先發起${branchLabel(st, target as BranchId)}方面的專案`, `The council starts with ${target}`), tags: ["science"], effects: [{ type: "PRIORITIZE_BRANCH", branch: target } as Effect] }),
    npc: () => 0,
  },

  /* ---------------- Medic ---------------- */
  med_treat: {
    targets: (st, s) => patientsOf(st, s).slice(0, 8).map((p) => ({ id: p.id, label: `${fullName(p)}（${Math.round(p.attributes!.health)}）` })),
    blocker: (st, s, _c, target) => {
      const p = target ? getCharacter(st, target) : undefined;
      if (!p || p.deathTick !== null || p.homeId !== s.id || (p.attributes?.health ?? 100) >= WORK.patient) return tx(st, "沒有需要治療的這位病人", "That person does not need treating");
      return null;
    },
    cost: () => r({}, { medicine: 1 }),
    finish: (ctx, a, c, s, skill) => {
      const st = ctx.state;
      const changes: StateChange[] = [];
      const p = getCharacter(st, a.target!);
      if (!p || p.deathTick !== null || !p.attributes || p.homeId !== s.id) {
        adjustGood(s, "medicine", 1, changes);
        return { ok: false, title: tx(st, "病人等不到了", "The patient could not be reached"), text: tx(st, "藥收了回去。", "The dose went back on the shelf."), changes };
      }
      const before = p.attributes.health;
      p.attributes.health = Math.round(Math.min(100, before + 18 * skill));
      changes.push({ path: `characters.${p.id}.attributes.health`, label: `${fullName(p)} health`, before, after: p.attributes.health });
      return { ok: true, title: tx(st, `${fullName(c)}治好了${fullName(p)}`, `${fullName(c)} treated ${fullName(p)}`), text: tx(st, `${fullName(p)}的健康從 ${Math.round(before)} 回到 ${p.attributes.health}。`, `Health ${Math.round(before)} → ${p.attributes.health}.`), changes, others: [p.id] };
    },
    npc: (st, s, target) => (target && good(s, "medicine") > 0 && (getCharacter(st, target)?.attributes?.health ?? 100) < 60 ? 5 : 0),
  },
  med_allocate: {
    targets: (st, s) => Object.keys(GROUP_AGES).filter((g) => groupOf(st, s, g).length > 0).map((g) => ({ id: g, label: `${groupLabel(st, g)}（${groupOf(st, s, g).length}）` })),
    blocker: (st, s, _c, target) => (!target || groupOf(st, s, target).length === 0 ? tx(st, "這群人裡沒有需要藥的人", "Nobody in that group needs it") : null),
    cost: () => r({}, { medicine: 4 }),
    finish: (ctx, a, c, s, skill) => {
      const st = ctx.state;
      const changes: StateChange[] = [];
      const people = groupOf(st, s, a.target!).slice(0, 6);
      for (const p of people) {
        const before = p.attributes!.health;
        p.attributes!.health = Math.round(Math.min(100, before + 11 * skill));
        changes.push({ path: `characters.${p.id}.attributes.health`, label: `${fullName(p)} health`, before, after: p.attributes!.health });
      }
      if (people.length === 0) { adjustGood(s, "medicine", 4, changes); return { ok: false, title: tx(st, "藥沒有用出去", "The medicine went unused"), text: tx(st, "他們都好起來了，藥收回庫房。", "They had all recovered; the doses went back."), changes }; }
      const before = s.morale;
      s.morale = round2(Math.max(0, before - 1));
      changes.push({ path: `settlements.${s.id}.morale`, label: `${s.name} morale`, before, after: s.morale });
      return { ok: true, title: tx(st, `${fullName(c)}把藥分給了${groupLabel(st, a.target!)}`, `${fullName(c)} allocated medicine to ${a.target}`), text: tx(st, `${people.length} 個人好多了。其他人問：為什麼不是我們？`, `${people.length} people improved. Others asked why not them.`), changes, others: people.map((p) => p.id) };
    },
    npc: () => 0,
  },
  med_prepare: {
    blocker: () => null,
    cost: () => r({ food: 3, materials: 2 }),
    finish: (ctx, _a, c, s) => {
      const changes: StateChange[] = [];
      const doses = facilityOk(s, "clinic") ? 4 : 3;
      adjustGood(s, "medicine", doses, changes);
      const made = (ctx.state.stats.made ??= {});
      made.medicine = round2((made.medicine ?? 0) + doses);
      return { ok: true, title: tx(ctx.state, `${fullName(c)}調製了一批藥`, `${fullName(c)} prepared medicine`), text: tx(ctx.state, `多了 ${doses} 份藥。${doses > 3 ? "診所的器材幫了大忙。" : ""}`, `${doses} more doses.`), changes };
    },
    npc: (_st, s) => (good(s, "medicine") < 6 && s.resources.materials > 15 ? 4 : 0),
  },
  med_health: {
    blocker: (st, s) => ((s.processes?.health ?? 0) >= MAX_PROCESS ? tx(st, "能教的都教了", "Everything that can be taught has been") : null),
    cost: () => r({ materials: 6, knowledge: 4 }),
    finish: (ctx, _a, c, s, skill) => {
      const changes: StateChange[] = [];
      const lvl = s.processes?.health ?? 0;
      s.processes = { ...(s.processes ?? {}), health: lvl + 1 };
      changes.push({ path: `settlements.${s.id}.processes.health`, label: `${s.name} public health`, before: lvl, after: lvl + 1 });
      const before = s.health;
      s.health = round2(Math.min(100, before + 4 * skill));
      changes.push({ path: `settlements.${s.id}.health`, label: `${s.name} health`, before, after: s.health });
      return { ok: true, title: tx(ctx.state, `${fullName(c)}推動了公共衛生`, `${fullName(c)} improved public health`), text: tx(ctx.state, `煮水、清溝、隔離的習慣留了下來。${s.name}的健康長期提升。`, `The habits stayed. Everyday health is better for good.`), changes, important: true };
    },
    npc: (_st, s) => (s.health < 75 && s.resources.materials > 25 ? 3 : 0),
  },

  /* ---------------- Scout ---------------- */
  sco_explore: {
    blocker: (st) => (unknownSites(st).length === 0 ? noneLeft("地圖上已經沒有空白了", "Nowhere left to find")(st) : null),
    cost: () => r({ food: 6, materials: 3 }),
    finish: (ctx, _a, c, s, skill) => {
      const st = ctx.state;
      const changes: StateChange[] = [];
      const sites = unknownSites(st);
      const site = [...sites].sort((a, b) => (LOCATION_BY_ID[a.id]?.distance ?? 9) - (LOCATION_BY_ID[b.id]?.distance ?? 9) || (a.id < b.id ? -1 : 1))[0];
      const found = site && ctx.rng.chance(Math.min(0.9, 0.3 + 0.4 * skill));
      if (ctx.rng.chance(0.15) && c.attributes) {
        const before = c.attributes.health;
        c.attributes.health = Math.max(1, before - 8);
        changes.push({ path: `characters.${c.id}.attributes.health`, label: `${fullName(c)} health`, before, after: c.attributes.health });
      }
      if (!found || !site) return { ok: false, title: tx(st, `${fullName(c)}空手回來了`, `${fullName(c)} came back with nothing`), text: tx(st, "走了三季，沒有找到新的地方。至少知道那個方向沒有東西。", "Three seasons, nothing new."), changes };
      const rec = newRecorder();
      discoverLocation(st, site.id, rec);
      changes.push(...rec.changes);
      return { ok: true, title: tx(st, `${fullName(c)}找到了${siteLabel(st, site.id)}`, `${fullName(c)} found ${siteLabel(st, site.id)}`), text: tx(st, `${siteLabel(st, site.id)}從此在地圖上。之後有人能去搜刮、佔地、定居。`, `It is on the map now.`), changes, important: true };
    },
    npc: (st, s) => (unknownSites(st).length > 0 && s.resources.food > 30 ? 4 : 0),
  },
  sco_salvage: {
    targets: (st, s) => salvageSites(st, s).map((l) => ({ id: l.id, label: `${siteLabel(st, l.id)}（${Math.round(l.salvage ?? 0)}）` })),
    blocker: (st, s, _c, target) => (!target || !salvageSites(st, s).some((l) => l.id === target) ? tx(st, "那裡已經沒東西了", "Nothing left there") : null),
    cost: () => r({ food: 4 }),
    finish: (ctx, a, c, s, skill) => {
      const st = ctx.state;
      const changes: StateChange[] = [];
      const loc = st.locations.find((l) => l.id === a.target);
      const got = round2(Math.min(16 * skill, loc?.salvage ?? 0));
      if (!loc || got <= 0) return { ok: false, title: tx(st, `${fullName(c)}空手回來了`, `${fullName(c)} came back with nothing`), text: tx(st, "那裡已經被搜光了。", "It had been picked clean."), changes };
      const before = loc.salvage ?? 0;
      loc.salvage = round2(before - got);
      changes.push({ path: `locations.${loc.id}.salvage`, label: `${loc.id} salvage`, before, after: loc.salvage });
      const parts = Math.floor(got / 10);
      adjust(s, "materials", round2(got - parts), changes);
      if (parts) adjustGood(s, "parts", parts, changes);
      return { ok: true, title: tx(st, `${fullName(c)}從${siteLabel(st, loc.id)}帶回了東西`, `${fullName(c)} brought back salvage`), text: tx(st, `${round2(got - parts)} 份物資${parts ? `、${parts} 份還能用的零件` : ""}。${siteLabel(st, loc.id)}還剩 ${Math.round(loc.salvage!)}。`, `${got} salvaged; ${Math.round(loc.salvage!)} left.`), changes };
    },
    npc: (_st, s, target) => (target && s.resources.materials < 25 && s.resources.food > 30 ? 3 : 0),
  },
  sco_expedition: {
    targets: (st) => claimSites(st).map((l) => ({ id: l.id, label: siteLabel(st, l.id) })),
    blocker: (st, _s, _c, target) => (!target || !claimSites(st).some((l) => l.id === target) ? tx(st, "那裡現在不能佔", "That site cannot be claimed") : null),
    cost: () => none,
    proposal: (st, s, _c, target) => ({
      title: tx(st, `到${siteLabel(st, target!)}建立據點（8 份食物、8 份物資，兩季）`, `Establish an outpost at ${target}`),
      tags: ["bold", "growth"],
      effects: [
        { type: "SPEND", costs: { food: 8, materials: 8 } } as Effect,
        { type: "AFTER", seasons: 2, away: ["you"], title: tx(st, "{{you}}回來了：據點建好了", "{{you}} is back: the outpost stands"), text: tx(st, `{{you}}在${siteLabel(st, target!)}立了牌子、搭了棚子。往後那裡的出產歸${s.name}。`, `The site now yields to ${s.name}.`), effects: [{ type: "CLAIM_SITE", location: target }] } as Effect,
      ],
    }),
    npc: () => 0,
  },
};

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function openWork(st: WorldState, characterId: string): Activity[] {
  return (st.activities ?? []).filter((a) => a.characterId === characterId).sort((a, b) => a.startSeason - b.startSeason);
}

/** First season this character could start something new, counting from `from`. */
export function nextFree(st: WorldState, c: Character, from: number): number {
  let at = from;
  for (const a of openWork(st, c.id)) if (a.dueSeason + 1 > at) at = a.dueSeason + 1;
  if (c.awayUntil !== undefined && c.awayUntil + 1 > at && c.awayUntil >= st.tick * 4) at = c.awayUntil + 1;
  return at;
}

function skillOf(c: Character, info: WorkActionInfo): number {
  const attr = info.profession === "Medic" || info.profession === "Scientist" ? c.attributes?.knowledge : c.attributes?.survival;
  const base = 0.7 + 0.6 * ((attr ?? 50) / 100);
  return round2(base * (info.practice && c.specialties?.includes(info.practice) ? 1.25 : 1));
}

function seasonsOf(st: WorldState, s: Settlement, info: WorkActionInfo, target?: string): number {
  return RULES[info.id]!.seasons?.(st, s, target) ?? info.seasons;
}

function canPay(s: Settlement, b: Bundle): boolean {
  return RESOURCES.every((x) => s.resources[x] + 1e-9 >= (b.resources[x] ?? 0)) && GOODS.every((g) => good(s, g) + 1e-9 >= (b.goods[g] ?? 0));
}

/** Who acts directly: routine work anyone can do; shared assets only the person in charge. */
function goesToProposal(st: WorldState, s: Settlement, c: Character, info: WorkActionInfo): boolean {
  if (!info.shared) return false;
  if (info.shared === "settlement") return true;
  return headOf(st, s, info.profession)?.id !== c.id;
}

/** Why this character cannot take on this work now, or null. */
export function workBlocker(st: WorldState, c: Character, actionId: string, target: string | undefined, base: number): string | null {
  const info = WORK_BY_ID[actionId];
  const rule = RULES[actionId];
  if (!info || !rule) return `Unknown work "${actionId}"`;
  if (c.deathTick !== null) return tx(st, "這個人已經不在了", "That person is dead");
  if (characterAge(st, c) < ADULT_AGE) return tx(st, "還太年輕，不能做這份工作", "Too young for this work");
  if (c.profession !== info.profession) return tx(st, "這不是你的本行", `Only a ${info.profession} can do this`);
  const s = getSettlement(st, c.homeId);
  if (!s || s.status !== "active") return tx(st, "聚落已經不在了", "The settlement is gone");
  if (info.target && !target) return tx(st, "要先選一個對象", "Choose what to do it to");
  const start = nextFree(st, c, base);
  if (start >= base + WORK.planningSeasons) return tx(st, "今年的時間已經排滿了", "Your year is already planned");
  const why = rule.blocker(st, s, c, target, start);
  if (why) return why;
  if (!goesToProposal(st, s, c, info) && !canPay(s, rule.cost(st, s, target))) return tx(st, "聚落的存量不夠", `${s.name} does not have enough`);
  if (goesToProposal(st, s, c, info)) {
    const p = rule.proposal?.(st, s, c, target, start);
    if (p && st.proposals?.some((x) => x.status === "open" && x.settlementId === s.id && x.key === proposalKey(p.effects))) return tx(st, "已經有人提過了，正等著決定", "Someone has already proposed this");
  }
  return null;
}

export interface WorkOptionView {
  id: string;
  name: string;
  hint: string;
  risk: string | null;
  /** Season index it would finish if started next. */
  finishSeason: number;
  seasons: number;
  away: boolean;
  proposes: boolean;
  costs: { name: string; amount: number; have: number }[];
  targets: { id: string; label: string; blocker: string | null }[] | null;
  /** Why it cannot be done at all (or for the only target). */
  blocker: string | null;
}

/** The character's work list, with what each needs. Used by the player UI. */
export function workOptions(st: WorldState, c: Character): WorkOptionView[] {
  const s = getSettlement(st, c.homeId);
  if (!s || !c.profession) return [];
  const base = (st.tick + 1) * 4;
  const zh = isZh(st);
  return WORK_ACTIONS.filter((a) => a.profession === c.profession).map((info) => {
    const rule = RULES[info.id]!;
    const targets = rule.targets ? rule.targets(st, s, c) : null;
    const sample = targets?.[0]?.id;
    const seasons = seasonsOf(st, s, info, sample);
    const proposes = goesToProposal(st, s, c, info);
    const cost = rule.cost(st, s, sample);
    const costs = [
      ...RESOURCES.filter((x) => cost.resources[x]).map((x) => ({ name: res(st, x), amount: cost.resources[x]!, have: Math.floor(s.resources[x]) })),
      ...GOODS.filter((g) => cost.goods[g]).map((g) => ({ name: res(st, g), amount: cost.goods[g]!, have: Math.floor(good(s, g)) })),
    ];
    const blocker = targets
      ? targets.length === 0 ? tx(st, "現在沒有可以做的對象", "Nothing to do this to right now") : null
      : workBlocker(st, c, info.id, undefined, base);
    return {
      id: info.id, name: zh ? info.zh : info.name, hint: zh ? info.zhHint : info.hint, risk: (zh ? info.zhRisk : info.risk) ?? null, finishSeason: nextFree(st, c, base) + seasons - 1, seasons, away: !!info.away, proposes, costs,
      targets: targets ? targets.map((t) => ({ ...t, blocker: workBlocker(st, c, info.id, t.id, base) })) : null,
      blocker,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Starting                                                            */
/* ------------------------------------------------------------------ */

/** Commit to the work: validated by the caller; pays now, or hands it to the people who decide. */
export function startWork(ctx: TickContext, c: Character, actionId: string, target: string | undefined, requestId?: string): Activity | null {
  const st = ctx.state;
  const info = WORK_BY_ID[actionId]!;
  const rule = RULES[actionId]!;
  const s = getSettlement(st, c.homeId)!;
  const start = nextFree(st, c, ctx.season);
  const seasons = seasonsOf(st, s, info, target);

  if (goesToProposal(st, s, c, info)) {
    const p = rule.proposal!(st, s, c, target, start);
    const e = ctx.system({
      category: "governance", importance: "minor",
      title: tx(st, `${fullName(c)}提議：${p.title}`, `${fullName(c)} proposes: ${p.title}`),
      text: tx(st, "交給負責決定的人了。", "It is with the people who decide."),
      settlementIds: [s.id], characterIds: [c.id], summary: "Player action (logged for replay)",
    });
    const rec = newRecorder();
    const next = transact(st, (d) => applyEffect(d, { type: "PROPOSE", kind: info.shared!, title: p.title, tags: p.tags, effects: p.effects, ...(info.shared === "domain" ? { domain: p.domain ?? info.profession } : {}) } as Effect, {
      tick: d.tick, settlementId: s.id, roles: { you: c.id }, historyId: e.id, title: p.title, scope: "settlement", category: "governance", storylineIds: [], season: ctx.season,
    }, rec)).state;
    ctx.state = next;
    e.changes.push(...rec.changes);
    getCharacter(next, c.id)!.lifeEvents.push({ tick: next.tick, text: e.title, historyId: e.id });
    return null;
  }

  const cost = rule.cost(st, s, target);
  for (const x of RESOURCES) if (cost.resources[x]) s.resources[x] = round2(s.resources[x] - cost.resources[x]!);
  for (const g of GOODS) if (cost.goods[g]) addGood(s, g, -cost.goods[g]!);
  const n = st.counters.nextActivity ?? 1;
  st.counters.nextActivity = n + 1;
  const due = start + seasons - 1;
  const activity: Activity = {
    id: `w-${n}`, actionId, characterId: c.id, settlementId: s.id, ...(target ? { target } : {}), startSeason: start, dueSeason: due,
    status: start < (ctx.inTick ? (st.tick + 1) * 4 : 0) ? "in_progress" : "planned", paid: cost, ...(requestId ? { requestId } : {}),
  };
  (st.activities ??= []).push(activity);
  if (info.away) c.awayUntil = Math.max(c.awayUntil ?? 0, due);
  // Buildings stand on a construction site the settlement owns: the work continues if the builder is lost.
  const site = actionId === "eng_build" ? (target as FacilityId) : actionId === "farm_clear" ? "fields" : null;
  if (site) {
    s.building = { ...(s.building ?? {}), [site]: due };
    ctx.system({
      category: "settlement", importance: "minor",
      title: say(st).buildStartTitle(s.name, facilityName(st, site)), text: say(st).buildStartText(s.name, facilityName(st, site), seasons),
      settlementIds: [s.id], characterIds: [c.id],
      changes: [{ path: `settlements.${s.id}.building.${site}`, label: `${s.name} builds ${site}`, before: null, after: due }],
      summary: `Work ${activity.id}: ${actionId}`,
    });
  }
  ctx.forgetCommitments();
  return activity;
}

/** Put a settlement-wide priority to whoever governs the settlement. */
export function proposePriority(ctx: TickContext, c: Character, priority: PriorityId | null): void {
  const st = ctx.state;
  const s = getSettlement(st, c.homeId)!;
  const name = priority ? (isZh(st) ? PRIORITY_INFO[priority].zh : PRIORITY_INFO[priority].name) : tx(st, "不特別偏重什麼", "nothing in particular");
  const title = tx(st, `${s.name}往後：${name}`, `${s.name}: ${name}`);
  const e = ctx.system({
    category: "governance", importance: "minor", title: tx(st, `${fullName(c)}提議：${title}`, `${fullName(c)} proposes: ${title}`), text: tx(st, "交給負責決定的人了。", "It is with the people who decide."),
    settlementIds: [s.id], characterIds: [c.id], summary: "Player action (logged for replay)",
  });
  const rec = newRecorder();
  ctx.state = transact(st, (d) => applyEffect(d, { type: "PROPOSE", kind: "settlement", title, tags: ["community"], effects: [{ type: "SET_PRIORITY", priority }] } as Effect, {
    tick: d.tick, settlementId: s.id, roles: { you: c.id }, historyId: e.id, title, scope: "settlement", category: "governance", storylineIds: [], season: ctx.season,
  }, rec)).state;
  e.changes.push(...rec.changes);
}

function refund(s: Settlement, paid: Bundle): void {
  for (const x of RESOURCES) if (paid.resources[x]) s.resources[x] = round2(s.resources[x] + paid.resources[x]!);
  for (const g of GOODS) if (paid.goods[g]) addGood(s, g, paid.goods[g]!);
}

function close(ctx: TickContext, a: Activity, status: Activity["status"], result: string): void {
  const st = ctx.state;
  a.status = status;
  a.result = result;
  a.resolvedTick = st.tick;
  const c = getCharacter(st, a.characterId);
  if (c && c.awayUntil !== undefined && c.awayUntil <= a.dueSeason && WORK_BY_ID[a.actionId]?.away) delete c.awayUntil;
  st.activities = (st.activities ?? []).filter((x) => x.id !== a.id);
  if (c?.controllerId || st.players && Object.values(st.players).some((p) => p.lineage.includes(a.characterId))) {
    st.activityLog = [...(st.activityLog ?? []), a].slice(-WORK.logSize);
  }
  ctx.forgetCommitments();
}

/** Call off work that has not begun. */
export function cancelWork(ctx: TickContext, a: Activity): void {
  const s = getSettlement(ctx.state, a.settlementId);
  if (s) refund(s, a.paid);
  const site = a.actionId === "eng_build" ? (a.target as FacilityId) : a.actionId === "farm_clear" ? "fields" : null;
  if (s && site && s.building?.[site] === a.dueSeason) delete s.building[site];
  close(ctx, a, "cancelled", tx(ctx.state, "取消了，用料已退回。", "Called off; what was paid went back."));
}

/* ------------------------------------------------------------------ */
/* Each year                                                           */
/* ------------------------------------------------------------------ */

/** People of a settlement who act on their own initiative this year, through the same rules as players. */
export function npcWork(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    const adults = residents(st, s.id).filter((c) => !c.controllerId && characterAge(st, c) >= ADULT_AGE && !isAwayNow(st, c) && openWork(st, c.id).length === 0);
    for (const profession of ["Farmer", "Engineer", "Scientist", "Medic", "Scout"] as const) {
      const pool = adults.filter((c) => c.profession === profession).sort((a, b) => (a.id < b.id ? -1 : 1));
      if (pool.length === 0) continue;
      const head = headOf(st, s, profession);
      const n = Math.min(WORK.npcMax, 1 + Math.floor(pool.length / WORK.npcPerWorkers));
      const crew = [...pool.filter((c) => c.id === head?.id), ...pool.filter((c) => c.id !== head?.id)].slice(0, n);
      for (const c of crew) {
        const options = WORK_ACTIONS.filter((a) => a.profession === profession).flatMap((info) => {
          const rule = RULES[info.id]!;
          const targets: (string | undefined)[] = rule.targets ? rule.targets(st, s, c).map((t) => t.id) : [undefined];
          return targets.map((target) => ({ info, target, score: rule.npc(st, s, target) }));
        }).filter((o) => o.score > 0 && !goesToProposal(st, s, c, o.info) && !(o.target && (st.activities ?? []).some((a) => a.actionId === o.info.id && a.target === o.target && a.settlementId === s.id)) && workBlocker(st, c, o.info.id, o.target, ctx.season) === null)
          .sort((a, b) => b.score - a.score || (a.info.id < b.info.id ? -1 : 1) || ((a.target ?? "") < (b.target ?? "") ? -1 : 1));
        const pick = options[0];
        if (pick) startWork(ctx, c, pick.info.id, pick.target);
      }
    }
  }
}

/** Mark work that has begun; drop what lost its worker or place. Runs before the year is lived. */
export function beginWork(ctx: TickContext): void {
  const st = ctx.state;
  for (const a of st.activities ?? []) if (a.status === "planned" && a.startSeason < (st.tick + 1) * 4) a.status = "in_progress";
}

/**
 * Every piece of work whose last season falls in this year finishes, in season
 * order. Taken off the list before anything else happens, so nothing can
 * resolve twice. Work whose person died, moved or lost their settlement ends
 * as interrupted; what had not started is paid back.
 */
export function resolveWork(ctx: TickContext): void {
  const st = ctx.state;
  const until = (st.tick + 1) * 4;
  const now = st.tick * 4;
  for (const a of [...(st.activities ?? [])].sort((x, y) => x.dueSeason - y.dueSeason || (x.id < y.id ? -1 : 1))) {
    const c = getCharacter(st, a.characterId);
    const s = getSettlement(st, a.settlementId);
    if (!c || !s || c.deathTick !== null || s.status !== "active" || c.homeId !== s.id) {
      const started = a.startSeason <= now + 3;
      if (!started && s && s.status === "active") refund(s, a.paid);
      const why = !c || c.deathTick !== null
        ? tx(st, "人走了，工作沒有做完。", "They died before it was finished.")
        : tx(st, "人離開了，工作沒有做完。", "They left before it was finished.");
      close(ctx, a, "interrupted", why);
      continue;
    }
    if (a.dueSeason >= until) continue;
    const info = WORK_BY_ID[a.actionId]!;
    const rule = RULES[a.actionId]!;
    let outcome: Outcome;
    try {
      outcome = rule.finish ? rule.finish(ctx, a, c, s, skillOf(c, info)) : { ok: true, title: info.zh, text: "", changes: [] };
    } catch (err) {
      if (!(err instanceof EffectError)) throw err;
      outcome = { ok: false, title: info.zh, text: err.message, changes: [] };
    }
    const learned: string[] = [];
    if (outcome.ok && info.practice && addPractice(c, info.practice, a.dueSeason - a.startSeason + 1)) {
      learned.push(specialtyName(st, info.practice));
      outcome.changes.push({ path: `characters.${c.id}.specialties.${info.practice}`, label: `${fullName(c)} learns ${SPECIALTY_INFO[info.practice].name}`, before: false, after: true });
    }
    if (outcome.ok && c.attributes && info.profession) {
      const key = info.profession === "Medic" || info.profession === "Scientist" ? "knowledge" : "survival";
      c.attributes[key] = Math.min(100, c.attributes[key] + 0.5);
    }
    const text = [outcome.text, ...learned.map((x) => tx(st, `做了這麼多，${fullName(c)}學會了${x}。`, `${fullName(c)} has learned ${x}.`))].filter(Boolean).join("\n");
    const e = ctx.system({
      category: info.profession === "Scout" ? "exploration" : info.profession === "Scientist" ? "technology" : "settlement",
      importance: outcome.important ? "notable" : "minor",
      title: outcome.title, text,
      settlementIds: [s.id], characterIds: [c.id, ...(outcome.others ?? []).filter((x) => x !== c.id)], changes: outcome.changes,
      summary: `Work ${a.id}: ${a.actionId}`,
    });
    if (c.controllerId || outcome.important) c.lifeEvents.push({ tick: st.tick, text: outcome.title, historyId: e.id });
    notify(st, c.id, outcome.title, text);
    for (const id of outcome.others ?? []) if (id !== c.id) notify(st, id, outcome.title, text);
    close(ctx, a, outcome.ok ? "completed" : "failed", text);
  }
}

/** Surplus tools, metal and raw goods move to places that cannot make their own. Nothing is created. */
export function shareGoods(ctx: TickContext): void {
  const st = ctx.state;
  const active = activeSettlements(st);
  for (const needy of active) {
    for (const g of ["parts", "metal", "timber", "ore"] as const) {
      const low = g === "parts" ? 5 : 8;
      if (good(needy, g) >= low) continue;
      const donor = active.filter((d) => d.id !== needy.id && good(d, g) >= 24 && (st.tensions?.[[d.id, needy.id].sort().join("|")] ?? 0) < 50)
        .sort((a, b) => good(b, g) - good(a, g) || (a.id < b.id ? -1 : 1))[0];
      if (!donor) continue;
      const amount = Math.min(8, Math.floor(good(donor, g) - 16));
      addGood(donor, g, -amount);
      addGood(needy, g, amount);
      st.stats.trade = round2((st.stats.trade ?? 0) + amount);
    }
  }
}
