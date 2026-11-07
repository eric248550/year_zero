/**
 * Static world catalog — the closed vocabulary the simulation rules and the
 * narrative validator agree on. Event definitions (including AI drafts) may only
 * reference IDs declared here. Changing this file changes RULES_VERSION.
 */

export const RULES_VERSION = "rules-0.6.0";

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
  prerequisites: string[];
  /** Minimum living population required before a project can start. */
  minPopulation?: number;
  description: string;
  effect: string;
}

/** Work needed per tier, and materials per tier for building-heavy branches. */
const WORK = [0, 30, 80, 150, 240] as const;
const tech = (id: string, name: string, branch: BranchId, tier: 1 | 2 | 3 | 4, prerequisites: string[], description: string, effect: string, extra: Partial<TechnologyInfo> = {}): TechnologyInfo => ({
  id, name, branch, tier, cost: WORK[tier], materials: (branch === "industry" || branch === "energy" ? 40 : 20) * tier, prerequisites, description, effect, ...extra,
});

export const TECHNOLOGIES: readonly TechnologyInfo[] = [
  // Farming: seeds → fields → breeding → large-scale farming
  tech("hydroponics", "Seed Trays & Hydroponics", "farming", 1, [], "Saved seed and nutrient-loop grow racks that do not depend on poisoned soil.", "Food production +25%."),
  tech("irrigation", "Irrigated Fields", "farming", 2, ["hydroponics", "water_wheel"], "Channels and wheel-lifted water that turn surface ground into fields.", "Surface settlements: food production +30%."),
  tech("crop_genetics", "Selective Breeding", "farming", 3, ["irrigation", "schooling"], "Generations of careful selection for hardy, climate-resilient cultivars.", "Food production +30%."),
  tech("mass_farming", "Large-Scale Agriculture", "farming", 4, ["crop_genetics", "machining"], "Ploughs, seed drills and shared granaries feeding more than one town.", "Food production +30%, food keeps longer."),
  // Materials & industry: salvage → workshop → metallurgy → machine building
  tech("salvage_tools", "Salvage Tooling", "industry", 1, [], "Cutting rigs and hand tools reforged from ruin scrap.", "Materials production +40%."),
  tech("workshop", "Workshops", "industry", 2, ["salvage_tools", "archives"], "Benches, jigs and patterns so things are made, not only found.", "Materials +20%, settlements grow for less."),
  tech("metallurgy", "Metallurgy", "industry", 3, ["workshop", "mechanical_power"], "Furnaces hot enough to melt scrap into new metal.", "Materials +20%, settlement capacity +5."),
  tech("machining", "Machine Building", "industry", 4, ["metallurgy", "apprenticeship"], "Lathes and gears made by people who were taught to make them.", "All production +10%."),
  // Energy & infrastructure: water power → mechanical power → local electricity → grid
  tech("water_wheel", "Water Power", "energy", 1, [], "Wheels on the river that lift water and turn grindstones.", "Water +10%, materials +10%."),
  tech("mechanical_power", "Mechanical Power", "energy", 2, ["water_wheel", "workshop"], "Shafts, belts and pumps that carry the river's strength into workshops.", "Food +10%, materials +10%."),
  tech("solar_power", "Local Electricity", "energy", 3, ["mechanical_power"], "Salvaged panels and a rebuilt dynamo: light after dark in one town.", "Knowledge +20%, materials +10%."),
  tech("power_grid", "Power Grid", "energy", 4, ["solar_power", "metallurgy"], "A shared electrical grid linking settlements.", "Settlement capacity +10, production +10%."),
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
];

export const TECH_IDS = TECHNOLOGIES.map((t) => t.id);
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

/** Flags in these namespaces cannot be written by ADD/REMOVE_WORLD_FLAG. */
export const RESERVED_FLAG_PREFIXES = ["secret.", "system."] as const;
