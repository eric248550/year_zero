/**
 * Static world catalog — the closed vocabulary the simulation rules and the
 * narrative validator agree on. Event definitions (including AI drafts) may only
 * reference IDs declared here. Changing this file changes RULES_VERSION.
 */

export const RULES_VERSION = "rules-1.3.0";

export const START_YEAR = 2131;

export const RESOURCES = ["food", "water", "materials", "knowledge"] as const;
export type ResourceId = (typeof RESOURCES)[number];

export const RESOURCE_INFO: Record<ResourceId, { label: string; description: string }> = {
  food: { label: "Food", description: "Rations, grow-room yields and surface harvests. Consumed by every survivor each year." },
  water: { label: "Water", description: "Potable water from reclaimers, wells and rivers. Consumed by every survivor each year." },
  materials: { label: "Materials", description: "Salvage, timber and scrap used for construction, repairs and expeditions." },
  knowledge: { label: "Knowledge", description: "Recovered and newly produced know-how. Spent to research technologies." },
};

export const PROFESSIONS = ["Scientist", "Engineer", "Medic", "Scout", "Farmer"] as const;
export type Profession = (typeof PROFESSIONS)[number];

export const PROFESSION_INFO: Record<Profession, { description: string; output: string }> = {
  Scientist: { description: "Keepers of fragmentary pre-collapse science.", output: "+knowledge" },
  Engineer: { description: "Builders, fixers and salvagers.", output: "+materials, settlement development" },
  Medic: { description: "Healers in a world with almost no medicine.", output: "+health, lower mortality" },
  Scout: { description: "Surface walkers who map the ruins and forage.", output: "+food (foraging), exploration" },
  Farmer: { description: "Growers who coax food out of racks, seed trays and poisoned ground.", output: "+food" },
};

export const ADULT_AGE = 16;
export const ELDER_AGE = 65;

/**
 * Six branches of rebuilding. Each branch is pushed forward by one profession;
 * the tree's cross-links make the branches need each other.
 */
export const BRANCHES = ["farming", "industry", "energy", "medicine", "knowledge", "society"] as const;
export type BranchId = (typeof BRANCHES)[number];

export const BRANCH_INFO: Record<BranchId, { name: string; profession: Profession; attribute: "health" | "social" | "knowledge" | "survival" }> = {
  farming: { name: "Farming", profession: "Farmer", attribute: "survival" },
  industry: { name: "Materials & Industry", profession: "Engineer", attribute: "survival" },
  energy: { name: "Energy & Infrastructure", profession: "Engineer", attribute: "knowledge" },
  medicine: { name: "Medicine & Population", profession: "Medic", attribute: "knowledge" },
  knowledge: { name: "Knowledge & Education", profession: "Scientist", attribute: "knowledge" },
  society: { name: "Exploration & Society", profession: "Scout", attribute: "social" },
};

/**
 * How a project is run. steady: as is. careful: slower, rarely goes wrong.
 * bold: faster, goes wrong more (and sometimes leaps). frugal: spends less
 * knowledge, a little slower.
 */
export const PROJECT_APPROACHES = ["steady", "careful", "bold", "frugal"] as const;
export type ProjectApproach = (typeof PROJECT_APPROACHES)[number];
export const APPROACH_INFO: Record<ProjectApproach, { work: number; setback: number; breakthrough: number; knowledge: number }> = {
  steady: { work: 1, setback: 1, breakthrough: 1, knowledge: 1 },
  careful: { work: 0.85, setback: 0.3, breakthrough: 0.7, knowledge: 1 },
  bold: { work: 1.25, setback: 2.5, breakthrough: 1.6, knowledge: 1 },
  frugal: { work: 0.9, setback: 1, breakthrough: 1, knowledge: 0.65 },
};

export interface TechnologyInfo {
  id: string;
  name: string;
  branch: BranchId;
  /** 1–4: how far along its branch. */
  tier: number;
  /** Work a project needs to finish it. */
  cost: number;
  /** Materials spent when a project to build it starts. */
  materials: number;
  /** Tools and components spent when a project to build it starts (advanced work only). */
  parts: number;
  prerequisites: string[];
  /** Minimum living population required before a project can start. */
  minPopulation?: number;
  description: string;
  effect: string;
}

/** Work needed per tier, and materials per tier for building-heavy branches. */
const WORK = [0, 30, 80, 150, 240] as const;
const tech = (id: string, name: string, branch: BranchId, tier: 1 | 2 | 3 | 4, prerequisites: string[], description: string, effect: string, extra: Partial<TechnologyInfo> = {}): TechnologyInfo => ({
  id, name, branch, tier, cost: WORK[tier], materials: (branch === "industry" || branch === "energy" ? 40 : 20) * tier, parts: tier >= 3 && (branch === "industry" || branch === "energy") ? (tier - 2) * 12 : 0, prerequisites, description, effect, ...extra,
});

export const TECHNOLOGIES: readonly TechnologyInfo[] = [
  // Farming: seeds → fields → breeding → large-scale farming
  tech("hydroponics", "Seed Trays & Hydroponics", "farming", 1, [], "Saved seed and nutrient-loop grow racks that do not depend on poisoned soil.", "Food production +20%."),
  tech("irrigation", "Irrigated Fields", "farming", 2, ["hydroponics", "water_wheel"], "Channels and wheel-lifted water that turn surface ground into fields.", "Surface settlements: food production +25%."),
  tech("crop_genetics", "Selective Breeding", "farming", 3, ["irrigation", "schooling"], "Generations of careful selection for hardy, climate-resilient cultivars.", "Food production +15%."),
  tech("mass_farming", "Large-Scale Agriculture", "farming", 4, ["crop_genetics", "machining"], "Ploughs, seed drills and shared granaries feeding more than one town.", "Food production +15%, food spoils half as fast."),
  // Materials & industry: salvage → workshop → metallurgy → machine building
  tech("salvage_tools", "Salvage Tooling", "industry", 1, [], "Cutting rigs and hand tools reforged from ruin scrap.", "Materials production +40%."),
  tech("workshop", "Workshops", "industry", 2, ["salvage_tools", "archives"], "Benches, jigs and patterns so things are made, not only found.", "Materials +20%, settlements grow for less."),
  tech("metallurgy", "Metallurgy", "industry", 3, ["workshop", "mechanical_power"], "Furnaces hot enough to melt scrap into new metal.", "Materials +20%, settlement capacity +5."),
  tech("machining", "Machine Building", "industry", 4, ["metallurgy", "apprenticeship"], "Lathes and gears made by people who were taught to make them.", "Water and materials production +10%."),
  // Energy & infrastructure: water power → mechanical power → local electricity → grid
  tech("water_wheel", "Water Power", "energy", 1, [], "Wheels on the river that lift water and turn grindstones.", "Water +10%, materials +10%."),
  tech("mechanical_power", "Mechanical Power", "energy", 2, ["water_wheel", "workshop"], "Shafts, belts and pumps that carry the river's strength into workshops.", "Materials +10%."),
  tech("solar_power", "Local Electricity", "energy", 3, ["mechanical_power"], "Salvaged panels and a rebuilt dynamo: light after dark in one town.", "Knowledge +20%, materials +10%."),
  tech("power_grid", "Power Grid", "energy", 4, ["solar_power", "metallurgy"], "A shared electrical grid linking settlements.", "Settlement capacity +10, water and materials production +10%."),
  // Medicine & population: public health → clinics → antibiotics → population growth
  tech("water_purification", "Public Health", "medicine", 1, [], "Filters, boiling and latrines rebuilt from bunker manuals.", "Water +30%, health +4, fewer contamination events."),
  tech("field_medicine", "Clinics", "medicine", 2, ["water_purification", "apprenticeship"], "A place to bring the sick, and people trained to treat them.", "Mortality -20%, health recovers faster."),
  tech("antibiotics", "Antibiotics", "medicine", 3, ["field_medicine", "archives"], "Mould cultures coaxed into producing crude penicillin.", "Mortality -25%, outbreaks far less deadly."),
  tech("maternal_care", "Mother & Child Care", "medicine", 4, ["antibiotics", "irrigation"], "Midwives, clean births and enough food for the first years.", "More births, far fewer children die."),
  // Knowledge & education: records → apprenticeship → schools → research institutes
  tech("archives", "Record Keeping", "knowledge", 1, [], "Copying the bunker's failing drives and books onto things that last.", "Knowledge +15%."),
  tech("apprenticeship", "Apprenticeship", "knowledge", 2, ["archives"], "Every craft takes on the young and teaches them properly.", "Knowledge +10%, new adults start more skilled."),
  tech("schooling", "Schools", "knowledge", 3, ["apprenticeship", "homesteading"], "Children everywhere learn to read, count and ask why.", "Knowledge +25%."),
  tech("research_institute", "Research Institute", "knowledge", 4, ["schooling", "solar_power"], "A lit building where people's whole job is finding out.", "Knowledge +30%, projects need less knowledge."),
  // Exploration & society: exploration → settlements → trade → organisation & governance
  tech("pathfinding", "Pathfinding", "society", 1, [], "Maps, cairns and the safe roads between ruins.", "Exploration chance +30%."),
  tech("homesteading", "Homesteading", "society", 2, ["pathfinding", "salvage_tools"], "Knowing how to raise a town on open ground and keep it standing.", "New settlements start larger and stand on their own sooner."),
  tech("radio", "Shortwave Radio", "society", 2, ["pathfinding", "workshop"], "Rebuilt transceivers that can hear — and be heard — across the wastes.", "Exploration chance +50%."),
  tech("trade_routes", "Trade Routes", "society", 3, ["homesteading", "workshop"], "Regular caravans, fair measures and goods moving between towns.", "Morale +3, settlements share surplus more readily."),
  tech("civic_charter", "Civic Charter", "society", 4, ["trade_routes", "apprenticeship"], "A written compact for councils, justice and shared stores.", "Morale +10 baseline, fewer disputes.", { minPopulation: 150 }),
].map((t) => (t.id === "mass_farming" ? { ...t, parts: 15 } : t));

export const TECH_IDS = TECHNOLOGIES.map((t) => t.id);

/* ------------------------------------------------------------------ */
/* Things that stay: facilities, laws, specialties                     */
/* ------------------------------------------------------------------ */

/**
 * Buildings a settlement can have. Each has a condition (0–100); upkeep keeps
 * it up, neglect, storms and raids wear it down; below 30 it is broken and does
 * nothing until repaired.
 */
export const FACILITIES = ["granary", "well", "clinic", "forge", "schoolhouse", "palisade", "watchtower", "greenhouse", "meeting_hall", "fields", "watermill", "generator", "solar_array", "battery_bank", "power_lines", "lumber_camp", "mine", "workshop"] as const;
export type FacilityId = (typeof FACILITIES)[number];
export const FACILITY_INFO: Record<FacilityId, { name: string; effect: string }> = {
  granary: { name: "Granary", effect: "Food spoils half as fast." },
  well: { name: "Well", effect: "Water +10%." },
  clinic: { name: "Clinic", effect: "Health +5, fewer deaths." },
  forge: { name: "Forge", effect: "Smelts ore and fuel into usable metal; materials +10%." },
  schoolhouse: { name: "Schoolhouse", effect: "Knowledge +10%, children learn faster." },
  palisade: { name: "Palisade", effect: "Raids on this settlement take half as much and kill less." },
  watchtower: { name: "Watchtower", effect: "Exploration +20%, raids on it are less likely." },
  greenhouse: { name: "Greenhouse", effect: "Food +10%." },
  meeting_hall: { name: "Meeting Hall", effect: "Morale +3, splits half as likely." },
  fields: { name: "Fields", effect: "Sown surface land. Without fields a surface settlement grows only 60% of its food; irrigation adds 25% more." },
  watermill: { name: "Water Mill", effect: "Water power: water and materials +10% (needs a river)." },
  generator: { name: "Generator", effect: "A dynamo driven by the water mill: steady electric power, day and night." },
  solar_array: { name: "Solar Array", effect: "Electric power by day only; dark at night without a battery bank." },
  battery_bank: { name: "Battery Bank", effect: "Stores the day's solar power for the night." },
  power_lines: { name: "Power Lines", effect: "Joins the power grid: shares electricity with every other connected settlement." },
  lumber_camp: { name: "Lumber Camp", effect: "Cuts the site's timber; the forest grows back." },
  mine: { name: "Mine", effect: "Digs the site's ore. Ore is useless until a forge smelts it." },
  workshop: { name: "Workshop", effect: "Turns metal and timber into tools and components." },
};
export const FACILITY_WORKING = 30;
/** Finishing these technologies raises a building in the settlement that built them. */
export const TECH_FACILITY: Partial<Record<string, FacilityId>> = {
  hydroponics: "greenhouse", water_purification: "well", field_medicine: "clinic", workshop: "forge",
  schooling: "schoolhouse", civic_charter: "meeting_hall", mass_farming: "granary", pathfinding: "watchtower",
  water_wheel: "watermill", solar_power: "solar_array", power_grid: "power_lines",
};
/** Technologies whose benefit needs the building on site; knowing them elsewhere lets a settlement build it. */
export const INFRASTRUCTURE: Partial<Record<FacilityId, { tech: string; materials: number; parts?: number; seasons: number; needs?: LocationFeature; after?: FacilityId; deposit?: "timber" | "ore" }>> = {
  // Extraction and industry first: a settlement that can make its own goods can build everything else.
  lumber_camp: { tech: "salvage_tools", materials: 10, seasons: 1, deposit: "timber" },
  forge: { tech: "workshop", materials: 25, seasons: 2 },
  workshop: { tech: "workshop", materials: 20, seasons: 2 },
  mine: { tech: "workshop", materials: 30, seasons: 2, deposit: "ore" },
  watermill: { tech: "water_wheel", materials: 25, parts: 4, seasons: 2, needs: "river" },
  solar_array: { tech: "solar_power", materials: 40, parts: 12, seasons: 2 },
  battery_bank: { tech: "metallurgy", materials: 30, parts: 12, seasons: 2, after: "solar_array" },
  generator: { tech: "mechanical_power", materials: 35, parts: 10, seasons: 2, after: "watermill" },
  power_lines: { tech: "power_grid", materials: 30, parts: 12, seasons: 2 },
  well: { tech: "water_purification", materials: 15, seasons: 1 },
  clinic: { tech: "field_medicine", materials: 20, seasons: 2 },
  granary: { tech: "mass_farming", materials: 25, seasons: 2 },
};
/** Machinery needs tools and components to keep running; without them it slowly wears out. */
export const MECHANICAL: readonly FacilityId[] = ["watermill", "generator", "solar_array", "battery_bank", "power_lines", "mine", "forge", "workshop"];

/**
 * What a settlement manufactures, on top of the four shared resources.
 * Forest → timber; mine → ore; ore + fuel + forge → metal; metal/timber +
 * workshop + labour → tools and components. Timber is also the fuel.
 */
export const GOODS = ["timber", "ore", "metal", "parts", "medicine"] as const;
export type GoodId = (typeof GOODS)[number];
export const GOOD_INFO: Record<GoodId, { name: string; zh: string }> = {
  timber: { name: "Timber", zh: "木材" },
  ore: { name: "Ore", zh: "礦石" },
  metal: { name: "Metal", zh: "金屬" },
  parts: { name: "Tools & components", zh: "工具零件" },
  medicine: { name: "Medicine", zh: "藥品" },
};
export const INDUSTRY = {
  /** 2 ore + 1 timber (fuel) → 1 metal, at a working forge. */
  smelt: { ore: 2, timber: 1, metal: 1 },
  /** 1 metal + 1 timber → 2 tools and components, at a working workshop. */
  craft: { metal: 1, timber: 1, parts: 2 },
  /** Batches each engineer runs in a year as routine work. */
  smeltPerEngineer: 1.2,
  craftPerEngineer: 0.8,
  /** Routine work stops stocking a good beyond these. */
  target: { timber: 60, ore: 40, metal: 30, parts: 30 } as Record<"timber" | "ore" | "metal" | "parts", number>,
  /** Timber kept for fuel and tools before any is sawn into building materials. */
  timberReserve: 25,
  /** Metal kept for tools before any goes into building materials; one metal makes this many. */
  metalReserve: 15,
  metalToMaterials: 2,
  /** Metal goes into building materials only when stocks fall below this: finite ore is for making things. */
  enoughMaterials: 30,
  /** Scrap a working workshop with tools recovers from what wears out (engineers alone: 30%). */
  workshopRecycle: 0.6,
  /** Share of effort that goes to camps and mines while salvage still lasts. */
  extractionShare: 0.3,
  /** Tools worn per unit cut or dug; without tools extraction runs at half pace. */
  toolWear: 0.02,
  noTools: 0.5,
  /** Parts per working machine per year. */
  machineUpkeep: 0.2,
  /** What Haven Deep has left of the old world's tools and medicine. */
  havenParts: 40,
  havenMedicine: 12,
  founderParts: 4,
  /** Share of a machine's worn-out parts a workshop recovers as metal (each part holds half a metal). */
  scrapShare: 0.4,
  /** Ore a claimed site with a deposit yields its claimant each year, if they have tools. */
  claimOre: 8,
} as const;

/**
 * What a settlement has decided to put first. It is a decision people make (by
 * proposal), and it works only through what it changes: who the young train as
 * and what gets built next. "hoard" is the choice to build nothing new.
 */
export const PRIORITIES = ["food", "industry", "knowledge", "expansion", "health", "hoard"] as const;
export type PriorityId = (typeof PRIORITIES)[number];
export const PRIORITY_INFO: Record<PriorityId, { name: string; zh: string; profession: Profession | null; builds: FacilityId[] }> = {
  food: { name: "Food first", zh: "糧食優先", profession: "Farmer", builds: ["well", "watermill", "granary"] },
  industry: { name: "Industry first", zh: "工業優先", profession: "Engineer", builds: ["lumber_camp", "forge", "workshop", "mine", "watermill", "generator"] },
  knowledge: { name: "Learning first", zh: "學問優先", profession: "Scientist", builds: ["solar_array", "battery_bank", "power_lines", "generator"] },
  expansion: { name: "Reach outward", zh: "向外拓展", profession: "Scout", builds: ["well", "lumber_camp"] },
  health: { name: "Health first", zh: "健康優先", profession: "Medic", builds: ["well", "clinic"] },
  hoard: { name: "Build nothing new", zh: "暫停新建", profession: null, builds: [] },
};
/** Share of each new generation a priority pulls into its trade. */
export const PRIORITY_PULL = 0.14;
/** Share a place's land pulls by itself toward the trade it suits. */
export const LAND_PULL = 0.08;
/** Buildings a settlement puts up on its own initiative: this many, plus one per NPC_BUILD_PEOPLE residents. Players can go beyond it. */
export const NPC_BUILD_BASE = 2;
export const NPC_BUILD_PEOPLE = 25;

/** A season of relevant work is one point of practice; this many make a specialty. */
export const PRACTICE = { threshold: 8 } as const;

/** Everyday work a character chooses to do. Same rules for players and NPCs (systems/work.ts). */
export type WorkTarget = "facility_new" | "facility_repair" | "facility_upgrade" | "process" | "tech" | "branch" | "group" | "site_salvage" | "site_claim" | "patient";
export interface WorkActionInfo {
  id: string;
  profession: Profession;
  /** Seasons of the character's time it takes. */
  seasons: number;
  name: string;
  zh: string;
  hint: string;
  zhHint: string;
  /** Away from home while doing it. */
  away?: boolean;
  /** Changes a shared asset: only the person in charge acts directly, others propose it. */
  shared?: "domain" | "settlement";
  target?: WorkTarget;
  /** What can go wrong, in words (never the odds). */
  zhRisk?: string;
  risk?: string;
  /** Specialty this work counts as practice for. */
  practice?: SpecialtyId;
}
export const WORK_ACTIONS: readonly WorkActionInfo[] = [
  { id: "farm_clear", profession: "Farmer", seasons: 2, shared: "domain", name: "Break new fields", zh: "開墾田地", hint: "Turn open ground into working fields.", zhHint: "把荒地整成能播種的田，往後年年有收成。" },
  { id: "farm_tend", profession: "Farmer", seasons: 1, practice: "grafting", name: "Tend the crops", zh: "照料作物", hint: "More grain from what is in the ground (or from the racks).", zhHint: "除草、灌溉。田裡的作物收成更多；在地堡是照料種植架。" },
  { id: "farm_soil", profession: "Farmer", seasons: 2, name: "Improve the soil", zh: "改良土壤", hint: "Compost and marl: fertility stays up for years.", zhHint: "堆肥翻土，土壤肥力提升，往後每次收成都受益。" },
  { id: "farm_seed", profession: "Farmer", seasons: 1, practice: "grafting", name: "Select and save seed", zh: "選種留種", hint: "Pick the best grain and put it by as seed.", zhHint: "從存糧挑出好種，轉成來年的種子。" },
  { id: "eng_build", profession: "Engineer", seasons: 2, shared: "domain", target: "facility_new", name: "Build", zh: "興建設施", hint: "Raise a building the settlement knows how to make.", zhHint: "蓋一座聚落已經會蓋的設施。" },
  { id: "eng_inspect", profession: "Engineer", seasons: 1, practice: "wiring", name: "Inspect and service", zh: "巡檢保養", hint: "Every working building is a little better for it.", zhHint: "逐一檢查保養，所有運作中的設施狀況提升。" },
  { id: "eng_repair", profession: "Engineer", seasons: 1, target: "facility_repair", practice: "wiring", name: "Repair", zh: "修理設施", hint: "Restore a worn or broken building.", zhHint: "把破損的設施修回來。" },
  { id: "eng_improve", profession: "Engineer", seasons: 2, target: "facility_upgrade", practice: "smithing", name: "Improve", zh: "改良設施", hint: "A lasting upgrade: the building gives more.", zhHint: "加裝改良，設施的效果永久提升。" },
  { id: "eng_smelt", profession: "Engineer", seasons: 2, practice: "smithing", name: "Run the forge", zh: "開爐煉鐵", hint: "Ore and fuel into usable metal.", zhHint: "把礦石和燃料（木材）煉成能用的金屬。" },
  { id: "eng_craft", profession: "Engineer", seasons: 1, practice: "smithing", name: "Make tools", zh: "製作工具零件", hint: "Metal and timber into tools and components.", zhHint: "用金屬和木材做出工具與零件。" },
  { id: "sci_experiment", profession: "Scientist", seasons: 2, practice: "archivist", name: "Run an experiment", zh: "進行實驗", hint: "May fail. Success adds knowledge and helps the current project.", zhHint: "可能失敗。成功會增加知識，也推進手上的專案。" },
  { id: "sci_process", profession: "Scientist", seasons: 3, target: "process", name: "Improve a process", zh: "改良製程", hint: "A lasting gain in one kind of production.", zhHint: "讓聚落某一項生產永久提升。" },
  { id: "sci_investigate", profession: "Scientist", seasons: 4, target: "tech", practice: "archivist", name: "Investigate a lost technology", zh: "研究未知技術", hint: "A year of study: notes that give its project a head start.", zhHint: "花一整年研究，留下筆記，日後專案能少走一段路。" },
  { id: "sci_priority", profession: "Scientist", seasons: 1, shared: "settlement", target: "branch", name: "Argue for a research priority", zh: "提出研究方向", hint: "Goes to the settlement's governing body.", zhHint: "交給聚落的決策者決定下一個優先領域。" },
  { id: "med_treat", profession: "Medic", seasons: 1, target: "patient", practice: "midwifery", name: "Treat a patient", zh: "診治病人", hint: "One dose for the person who needs it most.", zhHint: "用一份藥治療一位病人。" },
  { id: "med_allocate", profession: "Medic", seasons: 1, target: "group", name: "Allocate the medicine", zh: "分配藥品", hint: "Four doses, one group. The others go without.", zhHint: "四份藥給一群人，其他人就沒有。" },
  { id: "med_prepare", profession: "Medic", seasons: 1, practice: "midwifery", name: "Prepare medicine", zh: "調製藥品", hint: "Turn food and scraps into a few doses.", zhHint: "把食物和物資調製成幾份藥。" },
  { id: "med_health", profession: "Medic", seasons: 2, name: "Improve public health", zh: "推動公共衛生", hint: "Better everyday health, for good.", zhHint: "教大家煮水、清理環境，聚落健康長期提升。" },
  { id: "sco_explore", profession: "Scout", seasons: 3, away: true, practice: "wayfinding", name: "Explore", zh: "探索未知", hint: "Three seasons away, looking for somewhere new.", zhHint: "離開三季，尋找地圖上沒有的地方。" },
  { id: "sco_salvage", profession: "Scout", seasons: 2, away: true, target: "site_salvage", practice: "wayfinding", name: "Salvage a site", zh: "搜刮遺址", hint: "Bring back what is left at a known site.", zhHint: "去已知的遺址，把還能用的帶回來。" },
  { id: "sco_expedition", profession: "Scout", seasons: 1, shared: "settlement", target: "site_claim", name: "Propose an outpost", zh: "提議建立據點", hint: "Claiming a site is the settlement's decision.", zhHint: "佔地是聚落的事，通過後由你帶隊前往。" },
];
const RISKS: Record<string, [string, string]> = {
  sci_experiment: ["可能失敗，用料照樣用掉。", "It can fail; the materials are spent either way."],
  sco_explore: ["可能空手而回，也可能受傷。", "You may find nothing, and may come back hurt."],
  sco_salvage: ["遺址可能已經被搜光。", "The site may already be picked clean."],
  sco_expedition: ["聚落可能不同意；佔地會讓鄰居眼紅。", "The settlement may refuse; claims breed envy."],
  med_allocate: ["沒分到的人會不滿，士氣下降。", "Those left out resent it; morale falls."],
  farm_tend: ["天候不好時，收成仍可能很差。", "A bad year can still ruin the harvest."],
};
for (const a of WORK_ACTIONS as WorkActionInfo[]) { const r = RISKS[a.id]; if (r) { a.zhRisk = r[0]; a.risk = r[1]; } }
export const WORK_BY_ID: Record<string, WorkActionInfo> = Object.fromEntries(WORK_ACTIONS.map((a) => [a.id, a]));

/** Kinds of production a scientist can improve, a few percent per level. */
export const PROCESSES = ["food", "water", "materials", "knowledge"] as const;
export type ProcessId = (typeof PROCESSES)[number];
export const PROCESS_BONUS = 0.04;
export const MAX_PROCESS = 3;
export const MAX_UPGRADE = 2;
export const UPGRADE_BONUS = 0.15;

/** Rules a settlement lives by. Enacted and repealed by its people (usually a vote). */
export const LAWS = ["rationing", "work_duty", "shared_stores", "curfew", "sanitation"] as const;
export type LawId = (typeof LAWS)[number];
export const LAW_INFO: Record<LawId, { name: string; effect: string }> = {
  rationing: { name: "Rationing", effect: "Hunger and thirst kill far fewer; morale -3." },
  work_duty: { name: "Work Duty", effect: "Projects here move 15% faster; morale -4." },
  shared_stores: { name: "Shared Stores", effect: "Aid goes out even to rivals (refused only above 70 tension); morale +2." },
  curfew: { name: "Curfew", effect: "Raids on this settlement 40% less likely; morale -2." },
  sanitation: { name: "Sanitation Rules", effect: "Boiled water, latrines, quarantine: health +4, 2 materials a year." },
};

/** Skills a person learns and can pass on to the young who grow up with them. */
export const SPECIALTIES = ["grafting", "smithing", "wiring", "midwifery", "archivist", "wayfinding"] as const;
export type SpecialtyId = (typeof SPECIALTIES)[number];
export const SPECIALTY_INFO: Record<SpecialtyId, { name: string; branch: BranchId; effect: string }> = {
  grafting: { name: "Grafting", branch: "farming", effect: "Works 50% harder on farming projects." },
  smithing: { name: "Smithing", branch: "industry", effect: "Works 50% harder on industry projects." },
  wiring: { name: "Wiring", branch: "energy", effect: "Works 50% harder on energy projects." },
  midwifery: { name: "Midwifery", branch: "medicine", effect: "Works 50% harder on medicine projects; more babies survive at home." },
  archivist: { name: "Archivist", branch: "knowledge", effect: "Works 50% harder on knowledge projects." },
  wayfinding: { name: "Wayfinding", branch: "society", effect: "Works 50% harder on society projects; safer in the wastes." },
};

/**
 * Finite things the land holds. Salvage (materials) is used up; wild food grows
 * back each year up to the cap. Settlements draw on their own site; claims on
 * the claimed site.
 */
export const LAND = {
  salvage: (features: readonly LocationFeature[]) => (features.includes("ruins") ? 2000 : features.includes("bunker") ? 4000 : 400),
  wildCap: (features: readonly LocationFeature[]) => (features.includes("fertile") ? 80 : features.includes("bunker") ? 0 : 40),
  wildRegrowth: 0.15,
  /** Standing timber per site (it grows back) and ore in the ground (it does not). */
  timberCap: { greenhollow: 400, ashford_crossing: 200, old_reservoir: 100 } as Partial<Record<string, number>>,
  timberRegrowth: 0.2,
  ore: { old_reservoir: 1500, cinder_flats: 800, greenhollow: 400, signal_tower: 1500 } as Partial<Record<string, number>>,
} as const;

/** Farm plans a settlement can follow (chosen by its farmers). */
export const FARM_PLANS = ["staple", "rotation", "seedsave"] as const;
export type FarmPlan = (typeof FARM_PLANS)[number];
export const FARM = {
  /** Seed each farmer can sow in a year, at full fields. */
  seedPerFarmer: 3,
  /** Grain back per seed sown, at fertility 100 and an ordinary year. */
  yieldPerSeed: 2.5,
  /** Share of the harvest kept back as next year's seed. */
  seedKeep: 0.35,
  /** Plans: yield, fertility change per harvest, extra seed kept. */
  plans: {
    staple: { yield: 1.15, fertility: -6, keep: 0 },
    rotation: { yield: 0.9, fertility: 4, keep: 0 },
    seedsave: { yield: 1, fertility: -2, keep: 0.15 },
  } as Record<FarmPlan, { yield: number; fertility: number; keep: number }>,
  /** Seed a new surface settlement's founders carry from home. */
  founderSeed: 15,
  /** Haven Deep's seed bank at the start. */
  havenSeed: 60,
} as const;

/** What a site gives whoever has claimed it, each year. Settled sites belong to the settlement on them. */
export const CLAIM_YIELD: Partial<Record<string, Partial<Record<ResourceId, number>>>> = {
  // Materials come out of the site's salvage and food out of its wild growth; both run out or must grow back.
  seed_vault: { knowledge: 1 },
  signal_tower: { knowledge: 3 },
  cinder_flats: { materials: 4 },
  old_reservoir: { water: 5 },
  ashford_crossing: { food: 3 },
  greenhollow: { food: 4 },
};
/** Seed a claimed site gives each year (the seed vault's cold rooms). */
export const CLAIM_SEED: Partial<Record<string, number>> = { seed_vault: 3 };
export const TECH_BY_ID: Record<string, TechnologyInfo> = Object.fromEntries(TECHNOLOGIES.map((t) => [t.id, t]));

export type LocationFeature = "bunker" | "river" | "fertile" | "ruins" | "seed_cache" | "relay" | "sealed_bunker" | "clean_aquifer";

export interface LocationInfo {
  id: string;
  name: string;
  description: string;
  features: LocationFeature[];
  settleable: boolean;
  /** 1 = adjacent, 3 = far. Affects exploration odds. */
  distance: number;
  /** Known at world start. */
  initiallyKnown: boolean;
  /** Hidden locations can only be revealed by narrative events, never by random scouting. */
  hidden: boolean;
}

export const LOCATIONS: readonly LocationInfo[] = [
  { id: "haven_deep", name: "Haven Deep", description: "Vault 7: a sealed bunker under the old Calder dam. Home to the first generation of survivors.", features: ["bunker"], settleable: false, distance: 0, initiallyKnown: true, hidden: false },
  { id: "ashford_crossing", name: "Ashford Crossing", description: "A collapsed bridge town on a slow river. The floodplain soil is dark and soft.", features: ["river", "fertile"], settleable: true, distance: 1, initiallyKnown: true, hidden: false },
  { id: "cinder_flats", name: "Cinder Flats", description: "A burnt-out logistics park stacked with rusting containers and usable scrap.", features: ["ruins"], settleable: true, distance: 1, initiallyKnown: true, hidden: false },
  { id: "old_reservoir", name: "Old Reservoir", description: "A drained municipal reservoir; its aquifer still runs clean beneath the cracked basin.", features: ["river", "clean_aquifer"], settleable: true, distance: 2, initiallyKnown: false, hidden: false },
  { id: "greenhollow", name: "Greenhollow", description: "A sheltered valley where the ash never settled. Wild orchards have gone feral.", features: ["fertile"], settleable: true, distance: 3, initiallyKnown: false, hidden: false },
  { id: "seed_vault", name: "Seed Vault Ruins", description: "An agricultural research station, half-buried. Cold rooms may still hold viable seed.", features: ["seed_cache"], settleable: false, distance: 2, initiallyKnown: false, hidden: false },
  { id: "signal_tower", name: "Signal Tower", description: "A lattice relay mast on Harrow Ridge. Its solar cells still twitch with charge.", features: ["relay", "ruins"], settleable: false, distance: 2, initiallyKnown: false, hidden: false },
  { id: "vault_12", name: "Vault 12", description: "A bunker absent from every Haven Deep map. Its blast door is welded shut from the inside.", features: ["sealed_bunker"], settleable: false, distance: 3, initiallyKnown: false, hidden: true },
];

export const LOCATION_IDS = LOCATIONS.map((l) => l.id);
export const LOCATION_BY_ID: Record<string, LocationInfo> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));

export interface SecretInfo {
  id: string;
  title: string;
  /** Public summary shown once revealed. */
  revelation: string;
}

/**
 * Secrets are hidden truths. They can ONLY become known through a REVEAL_SECRET
 * effect of an executed event — never via a raw flag write.
 */
export const SECRETS: readonly SecretInfo[] = [
  { id: "project_halcyon", title: "Project Halcyon", revelation: "The 2089 collapse began with Halcyon, a stratospheric cooling programme that failed catastrophically and was concealed by the governments that launched it." },
  { id: "vault12_fate", title: "The Fate of Vault 12", revelation: "Vault 12 sealed itself after its residents voted to quarantine a fever. Its logs record the last years of a community that chose to die rather than spread it." },
  { id: "founders_pact", title: "The Founders' Pact", revelation: "Haven Deep's founders were Halcyon engineers. They built the vault knowing the programme might fail." },
];

export const SECRET_IDS = SECRETS.map((s) => s.id);
export const SECRET_BY_ID: Record<string, SecretInfo> = Object.fromEntries(SECRETS.map((s) => [s.id, s]));

export const POLICIES = ["balanced", "expansionist", "scholarly", "cautious"] as const;
export type PolicyId = (typeof POLICIES)[number];

export const CHOICE_TAGS = ["cautious", "bold", "growth", "science", "community", "industry", "secrecy", "openness"] as const;
export type ChoiceTag = (typeof CHOICE_TAGS)[number];

export interface PolicyInfo {
  id: PolicyId;
  name: string;
  description: string;
  /** Target share of adults per profession when assigning new adults. */
  professionMix: Record<Profession, number>;
  /** Branches the council prefers to start projects in, most preferred first. */
  branchOrder: BranchId[];
  /** Fraction of capacity at which the agent tries to found a new settlement. */
  foundingPressure: number;
  /** Weights applied to choice tags when resolving narrative choices. */
  tagWeights: Record<ChoiceTag, number>;
}

export const POLICY_INFO: Record<PolicyId, PolicyInfo> = {
  balanced: {
    id: "balanced",
    name: "Balanced Council",
    description: "A pragmatic council that spreads effort across survival, research and growth.",
    professionMix: { Scientist: 0.2, Engineer: 0.25, Medic: 0.15, Scout: 0.15, Farmer: 0.25 },
    branchOrder: ["farming", "medicine", "industry", "knowledge", "society", "energy"],
    foundingPressure: 0.72,
    tagWeights: { cautious: 1.1, bold: 0.9, growth: 1.1, science: 1, community: 1.2, industry: 1, secrecy: 0.7, openness: 1.1 },
  },
  expansionist: {
    id: "expansionist",
    name: "Frontier Charter",
    description: "Push outward: scout aggressively, settle new ground early, accept risk.",
    professionMix: { Scientist: 0.12, Engineer: 0.3, Medic: 0.12, Scout: 0.26, Farmer: 0.2 },
    branchOrder: ["society", "industry", "farming", "energy", "medicine", "knowledge"],
    foundingPressure: 0.55,
    tagWeights: { cautious: 0.6, bold: 1.6, growth: 1.5, science: 0.8, community: 0.9, industry: 1.3, secrecy: 1, openness: 1 },
  },
  scholarly: {
    id: "scholarly",
    name: "Archive Doctrine",
    description: "Knowledge first: recover lost science before expanding.",
    professionMix: { Scientist: 0.32, Engineer: 0.2, Medic: 0.16, Scout: 0.12, Farmer: 0.2 },
    branchOrder: ["knowledge", "medicine", "farming", "energy", "industry", "society"],
    foundingPressure: 0.8,
    tagWeights: { cautious: 1, bold: 0.9, growth: 0.8, science: 1.8, community: 1, industry: 0.9, secrecy: 0.9, openness: 1.3 },
  },
  cautious: {
    id: "cautious",
    name: "Steward Protocol",
    description: "Protect what exists. Stockpile, heal, and avoid unnecessary risk.",
    professionMix: { Scientist: 0.16, Engineer: 0.24, Medic: 0.24, Scout: 0.12, Farmer: 0.24 },
    branchOrder: ["medicine", "farming", "knowledge", "industry", "energy", "society"],
    foundingPressure: 0.8,
    tagWeights: { cautious: 1.8, bold: 0.5, growth: 0.9, science: 1, community: 1.3, industry: 1, secrecy: 1.3, openness: 0.8 },
  },
};

export const SETTLEMENT_STATS = ["morale", "health", "capacity", "level"] as const;
export type SettlementStat = (typeof SETTLEMENT_STATS)[number];
/** Stats an event effect may change. `level` changes only through development rules. */
export const MUTABLE_SETTLEMENT_STATS = ["morale", "health", "capacity"] as const;

export const EVENT_CATEGORIES = ["resource", "health", "exploration", "technology", "social", "mystery", "environment", "governance"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_SCOPES = ["world", "settlement", "character"] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];

export const IMPORTANCE = ["minor", "notable", "major", "critical"] as const;
export type Importance = (typeof IMPORTANCE)[number];

/**
 * Flags that cannot hold at the same time: setting one clears the others in
 * its group (a later decision replaces an earlier one).
 */
export const EXCLUSIVE_FLAGS: readonly (readonly string[])[] = [
  ["society.surface_first", "society.bunker_first"],
  ["society.open_gates", "society.closed_gates"],
  ["governance.assembly", "governance.elder_council"],
  ["governance.water_council", "governance.engineer_control"],
  ["society.truth_known", "society.secret_kept"],
  ["mystery.vault12_opened", "mystery.vault12_left_sealed"],
];

/** Flags in these namespaces cannot be written by ADD/REMOVE_WORLD_FLAG. */
export const RESERVED_FLAG_PREFIXES = ["secret.", "system."] as const;
