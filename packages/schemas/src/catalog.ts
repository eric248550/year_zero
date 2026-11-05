/**
 * Static world catalog — the closed vocabulary the simulation rules and the
 * narrative validator agree on. Event definitions (including AI drafts) may only
 * reference IDs declared here. Changing this file changes RULES_VERSION.
 */

export const RULES_VERSION = "rules-0.3.0";

export const START_YEAR = 2131;

export const RESOURCES = ["food", "water", "materials", "knowledge"] as const;
export type ResourceId = (typeof RESOURCES)[number];

export const RESOURCE_INFO: Record<ResourceId, { label: string; description: string }> = {
  food: { label: "Food", description: "Rations, grow-room yields and surface harvests. Consumed by every survivor each year." },
  water: { label: "Water", description: "Potable water from reclaimers, wells and rivers. Consumed by every survivor each year." },
  materials: { label: "Materials", description: "Salvage, timber and scrap used for construction, repairs and expeditions." },
  knowledge: { label: "Knowledge", description: "Recovered and newly produced know-how. Spent to research technologies." },
};

export const PROFESSIONS = ["Scientist", "Engineer", "Medic", "Scout"] as const;
export type Profession = (typeof PROFESSIONS)[number];

export const PROFESSION_INFO: Record<Profession, { description: string; output: string }> = {
  Scientist: { description: "Keepers of fragmentary pre-collapse science.", output: "+knowledge" },
  Engineer: { description: "Builders, fixers and salvagers.", output: "+materials, settlement development" },
  Medic: { description: "Healers in a world with almost no medicine.", output: "+health, lower mortality" },
  Scout: { description: "Surface walkers who map the ruins and forage.", output: "+food (foraging), exploration" },
};

export const ADULT_AGE = 16;
export const ELDER_AGE = 65;

export interface TechnologyInfo {
  id: string;
  name: string;
  cost: number;
  prerequisites: string[];
  /** Minimum living population required before research can complete. */
  minPopulation?: number;
  description: string;
  effect: string;
}

export const TECHNOLOGIES: readonly TechnologyInfo[] = [
  { id: "water_purification", name: "Water Purification", cost: 50, prerequisites: [], description: "Sand-charcoal filters and boiling protocols rebuilt from bunker manuals.", effect: "Water production +30%, reduces contamination events." },
  { id: "salvage_tools", name: "Salvage Tooling", cost: 45, prerequisites: [], description: "Cutting rigs and hand tools reforged from ruin scrap.", effect: "Materials production +40%." },
  { id: "field_medicine", name: "Field Medicine", cost: 55, prerequisites: [], description: "Triage, wound care and herbal pharmacology.", effect: "Mortality -20%, health recovers faster." },
  { id: "hydroponics", name: "Hydroponics", cost: 70, prerequisites: [], description: "Nutrient-loop grow racks that do not depend on poisoned soil.", effect: "Food production +25%." },
  { id: "irrigation", name: "Irrigation Networks", cost: 150, prerequisites: ["hydroponics", "water_purification"], description: "Channels and pumps that bring clean water to surface fields.", effect: "Surface settlements: food production +30%." },
  { id: "radio", name: "Shortwave Radio", cost: 120, prerequisites: ["salvage_tools"], description: "Rebuilt transceivers that can hear — and be heard — across the wastes.", effect: "Exploration chance +50%." },
  { id: "civic_charter", name: "Civic Charter", cost: 160, prerequisites: [], minPopulation: 30, description: "A written compact for councils, justice and shared stores.", effect: "Morale +10 baseline, fewer disputes." },
  { id: "antibiotics", name: "Antibiotics", cost: 260, prerequisites: ["field_medicine", "water_purification"], description: "Mould cultures coaxed into producing crude penicillin.", effect: "Mortality -25%, outbreaks far less deadly." },
  { id: "solar_power", name: "Solar Power", cost: 240, prerequisites: ["salvage_tools"], description: "Salvaged photovoltaic panels re-wired into working arrays.", effect: "Knowledge +20%, materials +10%." },
  { id: "power_grid", name: "Power Grid", cost: 400, prerequisites: ["solar_power", "civic_charter"], description: "A shared electrical grid linking settlements.", effect: "Settlement capacity +10, production +10%." },
  { id: "crop_genetics", name: "Crop Genetics", cost: 380, prerequisites: ["irrigation", "antibiotics"], description: "Selective breeding of hardy, climate-resilient cultivars.", effect: "Food production +30%." },
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
  /** Research preference order; earlier = preferred among available techs. */
  researchOrder: string[];
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
    professionMix: { Scientist: 0.25, Engineer: 0.3, Medic: 0.2, Scout: 0.25 },
    researchOrder: ["water_purification", "hydroponics", "field_medicine", "salvage_tools", "irrigation", "civic_charter", "radio", "antibiotics", "solar_power", "power_grid", "crop_genetics"],
    foundingPressure: 0.72,
    tagWeights: { cautious: 1.1, bold: 0.9, growth: 1.1, science: 1, community: 1.2, industry: 1, secrecy: 0.7, openness: 1.1 },
  },
  expansionist: {
    id: "expansionist",
    name: "Frontier Charter",
    description: "Push outward: scout aggressively, settle new ground early, accept risk.",
    professionMix: { Scientist: 0.15, Engineer: 0.35, Medic: 0.15, Scout: 0.35 },
    researchOrder: ["salvage_tools", "hydroponics", "water_purification", "radio", "irrigation", "field_medicine", "solar_power", "civic_charter", "power_grid", "antibiotics", "crop_genetics"],
    foundingPressure: 0.55,
    tagWeights: { cautious: 0.6, bold: 1.6, growth: 1.5, science: 0.8, community: 0.9, industry: 1.3, secrecy: 1, openness: 1 },
  },
  scholarly: {
    id: "scholarly",
    name: "Archive Doctrine",
    description: "Knowledge first: recover lost science before expanding.",
    professionMix: { Scientist: 0.4, Engineer: 0.25, Medic: 0.2, Scout: 0.15 },
    researchOrder: ["water_purification", "field_medicine", "hydroponics", "salvage_tools", "radio", "solar_power", "antibiotics", "civic_charter", "irrigation", "crop_genetics", "power_grid"],
    foundingPressure: 0.8,
    tagWeights: { cautious: 1, bold: 0.9, growth: 0.8, science: 1.8, community: 1, industry: 0.9, secrecy: 0.9, openness: 1.3 },
  },
  cautious: {
    id: "cautious",
    name: "Steward Protocol",
    description: "Protect what exists. Stockpile, heal, and avoid unnecessary risk.",
    professionMix: { Scientist: 0.2, Engineer: 0.3, Medic: 0.3, Scout: 0.2 },
    researchOrder: ["field_medicine", "water_purification", "hydroponics", "antibiotics", "salvage_tools", "civic_charter", "irrigation", "radio", "solar_power", "crop_genetics", "power_grid"],
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
