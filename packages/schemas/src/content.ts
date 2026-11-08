import { z } from "zod";
import {
  CHOICE_TAGS,
  EVENT_CATEGORIES,
  EVENT_SCOPES,
  IMPORTANCE,
  MUTABLE_SETTLEMENT_STATS,
  PROFESSIONS,
  RESOURCES,
  SETTLEMENT_STATS,
  BRANCHES,
  FARM_PLANS,
  PROJECT_APPROACHES,
  FACILITIES,
  LAWS,
  SPECIALTIES, GOODS, PRIORITIES } from "./catalog";
import { ATTRIBUTES, FlagValueSchema } from "./world";

/* ------------------------------------------------------------------ */
/* Conditions (preconditions / choice requirements)                    */
/* ------------------------------------------------------------------ */

export const ComparisonOpSchema = z.enum(["<", "<=", ">", ">=", "==", "!="]);
export type ComparisonOp = z.infer<typeof ComparisonOpSchema>;

const ResourceIdSchema = z.enum(RESOURCES);
const ScopeRefSchema = z.enum(["target", "world"]).default("target");

export const ConditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resource"),
    resource: ResourceIdSchema,
    op: ComparisonOpSchema,
    value: z.number(),
    /** Compare per living resident instead of absolute stock. */
    perCapita: z.boolean().default(false),
    scope: ScopeRefSchema,
  }).strict(),
  z.object({ type: z.literal("population"), op: ComparisonOpSchema, value: z.number(), scope: ScopeRefSchema }).strict(),
  z.object({ type: z.literal("technology"), tech: z.string(), has: z.boolean() }).strict(),
  z.object({ type: z.literal("flag"), flag: z.string().min(1), present: z.boolean(), equals: FlagValueSchema.optional() }).strict(),
  z.object({ type: z.literal("secret"), secret: z.string(), revealed: z.boolean() }).strict(),
  z.object({ type: z.literal("settlement_stat"), stat: z.enum(SETTLEMENT_STATS), op: ComparisonOpSchema, value: z.number() }).strict(),
  z.object({ type: z.literal("settlement_kind"), kind: z.enum(["bunker", "settlement"]) }).strict(),
  z.object({ type: z.literal("world_tick"), op: ComparisonOpSchema, value: z.number().int() }).strict(),
  z.object({ type: z.literal("location"), location: z.string(), discovered: z.boolean() }).strict(),
  z.object({ type: z.literal("settlement_count"), op: ComparisonOpSchema, value: z.number().int() }).strict(),
  z.object({
    type: z.literal("event_occurred"),
    event: z.string(),
    occurred: z.boolean(),
    /** If set, only occurrences within the last N ticks count. */
    withinTicks: z.number().int().positive().optional(),
  }).strict(),
  z.object({ type: z.literal("shortage"), resource: z.enum(["food", "water"]), active: z.boolean() }).strict(),
  /** Tension between the target settlement and its rival (the settlement it is most at odds with). Fails when there is no other settlement. */
  z.object({ type: z.literal("tension"), op: ComparisonOpSchema, value: z.number() }).strict(),
  /** Years since the target settlement was founded (a field has to be sown before it is harvested). */
  z.object({ type: z.literal("settlement_age"), op: ComparisonOpSchema, value: z.number().int() }).strict(),
  /** At least one of these flags is set (or none is). */
  z.object({ type: z.literal("flag_any"), flags: z.array(z.string().min(1)).min(2), present: z.boolean() }).strict(),
  /** The target settlement's land can be farmed: fertile, by a river, or anywhere once irrigation is known. */
  z.object({ type: z.literal("farmable"), present: z.boolean() }).strict(),
  /** Salvage left on the target settlement's site. */
  z.object({ type: z.literal("salvage"), op: ComparisonOpSchema, value: z.number() }).strict(),
  /** Some building in the target settlement is worn below 70 and not already being repaired. */
  z.object({ type: z.literal("worn"), present: z.boolean() }).strict(),
  /** Seed in the target settlement's store. */
  z.object({ type: z.literal("seeds"), op: ComparisonOpSchema, value: z.number() }).strict(),
  /** Harvests the target settlement has brought in. */
  z.object({ type: z.literal("harvests"), op: ComparisonOpSchema, value: z.number().int() }).strict(),
  /** Electric power available to the target settlement (0–1: own sources and the grid). */
  z.object({ type: z.literal("power"), op: ComparisonOpSchema, value: z.number(), when: z.enum(["day", "night"]).optional() }).strict(),
  /** Someone is (or is not) building this technology right now. */
  z.object({ type: z.literal("project"), tech: z.string(), active: z.boolean() }).strict(),
  /** The target settlement has this building in working order (condition ≥ 30), or not. */
  z.object({ type: z.literal("facility"), facility: z.enum(FACILITIES), working: z.boolean() }).strict(),
  /** A law is (or is not) in force in the target settlement. */
  z.object({ type: z.literal("law"), law: z.enum(LAWS), active: z.boolean() }).strict(),
  /** How many sites the target settlement has claimed. */
  z.object({ type: z.literal("claims"), op: ComparisonOpSchema, value: z.number().int() }).strict(),
  /** Children (under 16) living in the target settlement. */
  z.object({ type: z.literal("children"), op: ComparisonOpSchema, value: z.number().int() }).strict(),
  /** The land the target settlement stands on has (or lacks) this feature: fertile, river, ruins… */
  z.object({ type: z.literal("site_feature"), feature: z.enum(["bunker", "river", "fertile", "ruins", "seed_cache", "relay", "sealed_bunker", "clean_aquifer"]), present: z.boolean() }).strict(),
  /** A site is claimed by anyone (or nobody). */
  z.object({ type: z.literal("site_claimed"), location: z.string(), claimed: z.boolean() }).strict(),
]);
export type Condition = z.infer<typeof ConditionSchema>;
export type ConditionInput = z.input<typeof ConditionSchema>;

/* ------------------------------------------------------------------ */
/* Roles — eligible character targets                                  */
/* ------------------------------------------------------------------ */

export const RoleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "role ids are lower_snake_case"),
  description: z.string().optional(),
  profession: z.enum(PROFESSIONS).optional(),
  minAge: z.number().int().min(0).optional(),
  maxAge: z.number().int().min(0).optional(),
  /** Optional roles do not block eligibility when nobody qualifies. */
  optional: z.boolean().default(false),
  /** Only player-controlled characters can fill this role (personal events). */
  player: z.boolean().optional(),
  /** Only children whose parents are all dead and who have nobody caring for them. */
  orphan: z.boolean().optional(),
  /**
   * Prefer people who already have history with the character in this other
   * role (friends and enemies alike), so relationships keep developing.
   */
  familiarWith: z.string().optional(),
  /** Only characters working on an active project (optionally of this branch). Fills {{project}}. */
  onProject: z.union([z.literal(true), z.enum(BRANCHES), z.array(z.enum(BRANCHES)).min(1)]).optional(),
  /** Only characters with this relationship strength toward the character in another role. */
  bondWith: z.object({ role: z.string(), min: z.number().min(-100).max(100).optional(), max: z.number().min(-100).max(100).optional() }).strict().optional(),
  /** Only characters born before this tick (e.g. -10: old enough to remember the bunker before the doors opened). */
  bornBefore: z.number().int().optional(),
  /** Only characters who have learned this specialty. */
  specialty: z.enum(SPECIALTIES).optional(),
  /** Minimum attribute values (worlds without attributes treat everyone as 50). */
  minAttributes: z.object({ health: z.number(), social: z.number(), knowledge: z.number(), survival: z.number() }).partial().strict().optional(),
}).strict();
export type Role = z.infer<typeof RoleSchema>;

/* ------------------------------------------------------------------ */
/* Effects — the ONLY way narrative content can change world state     */
/* ------------------------------------------------------------------ */

const SettlementTargetSchema = z.enum(["settlement", "all_settlements"]).default("settlement");

export const CostSchema = z.object({
  food: z.number().min(0).optional(),
  water: z.number().min(0).optional(),
  materials: z.number().min(0).optional(),
  knowledge: z.number().min(0).optional(),
}).strict();

export const EFFECT_TYPES = [
  "ADJUST_RESOURCE",
  "CHANGE_RELATIONSHIP",
  "DISCOVER_LOCATION",
  "UNLOCK_TECHNOLOGY",
  "CHANGE_SETTLEMENT_STAT",
  "ADD_WORLD_FLAG",
  "REMOVE_WORLD_FLAG",
  "CREATE_HISTORICAL_EVENT",
  "REVEAL_SECRET",
  "ADD_LIFE_EVENT",
  "CHARACTER_DEATH",
  "ADJUST_ATTRIBUTE",
  "ADD_CARETAKER",
  "CHANGE_TENSION",
  "EXCHANGE",
  "CHANGE_PROJECT",
  "BUILD_FACILITY",
  "CHANGE_FACILITY",
  "ENACT_LAW",
  "REPEAL_LAW",
  "CLAIM_SITE",
  "CEDE_CLAIM",
  "ADD_SPECIALTY",
  "PRACTICE",
  "SCHEDULE_EVENT",
  "AFTER",
  "ADD_SEEDS",
  "CHANGE_FERTILITY",
  "SET_FARM_PLAN",
  "CHANGE_CROPS",
  "PRIORITIZE_BRANCH",
  "SET_PRIORITY",
  "PROPOSE",
  "RESOLVE_PROPOSAL",
  "SPEND",
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export const EffectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ADJUST_RESOURCE"),
    resource: ResourceIdSchema,
    /** Positive = gain. Negative = loss, clamped at zero (losses never go negative). */
    amount: z.number().finite().min(-500).max(500),
    /** Where a gain comes from: the site's salvage (used up) or its wild growth (grows back). Only what is there is gained. */
    from: z.enum(["salvage", "wild"]).optional(),
    target: SettlementTargetSchema,
  }).strict(),
  z.object({
    type: z.literal("CHANGE_RELATIONSHIP"),
    a: z.string(),
    b: z.string(),
    delta: z.number().min(-100).max(100),
  }).strict(),
  z.object({ type: z.literal("DISCOVER_LOCATION"), location: z.string() }).strict(),
  z.object({ type: z.literal("UNLOCK_TECHNOLOGY"), tech: z.string() }).strict(),
  z.object({
    type: z.literal("CHANGE_SETTLEMENT_STAT"),
    stat: z.enum(MUTABLE_SETTLEMENT_STATS),
    delta: z.number().min(-100).max(100),
    target: SettlementTargetSchema,
  }).strict(),
  z.object({ type: z.literal("ADD_WORLD_FLAG"), flag: z.string().regex(/^[a-z0-9_.]+$/, "flags are lowercase dotted identifiers"), value: FlagValueSchema.default(true) }).strict(),
  z.object({ type: z.literal("REMOVE_WORLD_FLAG"), flag: z.string() }).strict(),
  z.object({
    type: z.literal("CREATE_HISTORICAL_EVENT"),
    title: z.string().min(1).max(160),
    description: z.string().max(2000),
    importance: z.enum(IMPORTANCE).default("notable"),
  }).strict(),
  z.object({ type: z.literal("REVEAL_SECRET"), secret: z.string() }).strict(),
  z.object({ type: z.literal("ADD_LIFE_EVENT"), role: z.string(), text: z.string().min(1).max(400) }).strict(),
  z.object({ type: z.literal("CHARACTER_DEATH"), role: z.string(), cause: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("ADJUST_ATTRIBUTE"), role: z.string(), attribute: z.enum(ATTRIBUTES), delta: z.number().int().min(-50).max(50) }).strict(),
  /** `caretaker` now looks after `ward` (adoption, nursing, apprenticeship). */
  z.object({ type: z.literal("ADD_CARETAKER"), caretaker: z.string(), ward: z.string() }).strict(),
  /** Change tension between the target settlement and its rival ({{rival}}). */
  z.object({ type: z.literal("CHANGE_TENSION"), delta: z.number().int().min(-50).max(50) }).strict(),
  /**
   * Goods move between the target settlement and its rival ({{rival}}): `get`
   * comes out of the rival's stores (only what it has), `give` goes the other
   * way, scaled down by the same share. Nothing is created.
   */
  z.object({
    type: z.literal("EXCHANGE"),
    get: z.object({ resource: ResourceIdSchema, amount: z.number().positive().max(200) }).strict(),
    give: z.object({ resource: ResourceIdSchema, amount: z.number().positive().max(200) }).strict().optional(),
  }).strict(),
  /**
   * Change a project: the one `role` is working on, or the active one building `tech`.
   * `progress` is a share of its total work (0.2 = a fifth). No project: nothing happens.
   */
  z.object({
    type: z.literal("CHANGE_PROJECT"),
    role: z.string().optional(),
    tech: z.string().optional(),
    progress: z.number().min(-0.5).max(0.5).optional(),
    approach: z.enum(PROJECT_APPROACHES).optional(),
  }).strict(),
  /** Raise (or fully rebuild) a building in the target settlement. */
  /** Raise a building; with `seasons` it is a construction site until then (and works only once finished). */
  z.object({ type: z.literal("BUILD_FACILITY"), facility: z.union([z.enum(FACILITIES), z.literal("worst")]), seasons: z.number().int().min(1).max(12).optional() }).strict(),
  /** Wear down or repair a building that exists; "any" picks the one in best shape. */
  z.object({ type: z.literal("CHANGE_FACILITY"), facility: z.union([z.enum(FACILITIES), z.literal("any"), z.literal("worst")]), delta: z.number().int().min(-100).max(100) }).strict(),
  z.object({ type: z.literal("ENACT_LAW"), law: z.enum(LAWS) }).strict(),
  z.object({ type: z.literal("REPEAL_LAW"), law: z.enum(LAWS) }).strict(),
  /** The target settlement stakes a claim to a discovered, unsettled site (taking it from whoever held it). */
  z.object({ type: z.literal("CLAIM_SITE"), location: z.string() }).strict(),
  /** Seed into (or out of) the target settlement's store. */
  z.object({ type: z.literal("ADD_SEEDS"), amount: z.number().int().min(-100).max(100) }).strict(),
  z.object({ type: z.literal("CHANGE_FERTILITY"), delta: z.number().int().min(-50).max(50) }).strict(),
  z.object({ type: z.literal("SET_FARM_PLAN"), plan: z.enum(FARM_PLANS) }).strict(),
  /** Damage (negative) the crops now in the ground, as a share of them. */
  z.object({ type: z.literal("CHANGE_CROPS"), fraction: z.number().min(-1).max(0) }).strict(),
  /**
   * Propose a change to shared state instead of making it. A domain change
   * (`domain`: the head of that profession decides) runs at once if the
   * proposer is that head; otherwise, and for every settlement change, the
   * right people decide next year. Recorded: who proposed, who approved.
   */
  z.object({
    type: z.literal("PROPOSE"),
    kind: z.enum(["domain", "settlement"]),
    domain: z.enum(PROFESSIONS).optional(),
    title: z.string().min(1).max(120),
    tags: z.array(z.enum(CHOICE_TAGS)).default([]),
    effects: z.array(z.lazy((): z.ZodTypeAny => EffectSchema)).min(1),
  }).strict(),
  /** Used by the approval vote: carry out (or drop) the proposal it is about. */
  z.object({ type: z.literal("RESOLVE_PROPOSAL"), approve: z.boolean() }).strict(),
  /** Pay from the target settlement; the whole outcome fails if it cannot be paid. */
  z.object({ type: z.literal("SPEND"), costs: CostSchema, goods: z.partialRecord(z.enum(GOODS), z.number().min(0)).optional() }).strict(),
  /** The council starts the next project in this branch first (sets the research focus). */
  z.object({ type: z.literal("PRIORITIZE_BRANCH"), branch: z.enum(BRANCHES) }).strict(),
  z.object({ type: z.literal("SET_PRIORITY"), priority: z.enum(PRIORITIES).nullable() }).strict(),
  /** The target settlement hands its oldest claim to its rival. */
  z.object({ type: z.literal("CEDE_CLAIM") }).strict(),
  z.object({ type: z.literal("ADD_SPECIALTY"), role: z.string(), specialty: z.enum(SPECIALTIES) }).strict(),
  /** Relevant work toward a specialty; it is learned once enough has been done. */
  z.object({ type: z.literal("PRACTICE"), role: z.string(), specialty: z.enum(SPECIALTIES), amount: z.number().min(0.5).max(4).default(1) }).strict(),
  /**
   * Something that takes time: `event` (a scheduledOnly event) happens `seasons`
   * seasons from now with the same roles. Roles in `away` are gone until then
   * (no other events, no work).
   */
  z.object({
    type: z.literal("SCHEDULE_EVENT"),
    event: z.string(),
    seasons: z.number().int().min(1).max(16),
    away: z.array(z.string()).optional(),
  }).strict(),
  /**
   * An outcome that takes time, without a separate event: after `seasons` the
   * `effects` apply and a history entry is written. If anyone in `away` has
   * died meanwhile, nothing is delivered and the loss is recorded instead.
   */
  z.object({
    type: z.literal("AFTER"),
    seasons: z.number().int().min(1).max(16),
    away: z.array(z.string()).optional(),
    title: z.string().min(1).max(160),
    text: z.string().min(1).max(1000),
    effects: z.array(z.lazy((): z.ZodTypeAny => EffectSchema)).default([]),
    risk: z.object({ chance: z.number().min(0).max(1), text: z.string().min(1).max(400), effects: z.array(z.lazy((): z.ZodTypeAny => EffectSchema)).min(1) }).strict().optional(),
  }).strict(),
]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectInput = z.input<typeof EffectSchema>;

/* ------------------------------------------------------------------ */
/* Choices                                                             */
/* ------------------------------------------------------------------ */



export const ChoiceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  tags: z.array(z.enum(CHOICE_TAGS)).default([]),
  /** Resources that must be spent from the target settlement. Choice is unavailable if unaffordable. */
  costs: CostSchema.optional(),
  requires: z.array(ConditionSchema).default([]),
  /** Roles that must have been filled for this choice to be available. */
  requiresRoles: z.array(z.string()).default([]),
  effects: z.array(EffectSchema).default([]),
  /**
   * Applied once for EACH participant who picks this choice, with the role
   * "actor" bound to that participant. Use for personal outcomes.
   */
  memberEffects: z.array(EffectSchema).optional(),
  risk: z.object({
    chance: z.number().min(0).max(1),
    description: z.string().max(400),
    effects: z.array(EffectSchema).min(1),
  }).strict().optional(),
  outcome: z.string().max(1000).optional(),
}).strict();
export type Choice = z.infer<typeof ChoiceSchema>;

/* ------------------------------------------------------------------ */
/* Event definitions — things that MAY happen                          */
/* ------------------------------------------------------------------ */

export const DEFINITION_STATUSES = ["draft", "validated", "published", "archived"] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export const EventIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "event ids are kebab-case");

export const EventDefinitionSchema = z.object({
  id: EventIdSchema,
  version: z.number().int().min(1).default(1),
  title: z.string().min(1).max(120),
  scope: z.enum(EVENT_SCOPES),
  category: z.enum(EVENT_CATEGORIES),
  description: z.string().min(1).max(2000),
  preconditions: z.array(ConditionSchema).default([]),
  roles: z.array(RoleSchema).default([]),
  /** Effects applied whenever the event fires, before the choice. */
  effects: z.array(EffectSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  /**
   * Who decides. "roles" (default): the characters filling the roles.
   * "everyone": every resident aged 12+ of the anchor settlement chooses for
   * themselves (e.g. some join an expedition, some stay home).
   */
  participation: z.enum(["roles", "everyone"]).optional(),
  /**
   * How several deciders' answers combine. "each" (default): every group does
   * what it chose (some go on the caravan, some stay). "vote": one collective
   * decision. Every answer is collected first, then the winning choice's effects
   * run once; memberEffects still follow what each person voted for.
   */
  resolution: z.enum(["each", "vote"]).optional(),
  /** Only happens when another event schedules it (SCHEDULE_EVENT), never by chance. */
  scheduledOnly: z.boolean().optional(),
  priority: z.number().int().min(1).max(10).default(5),
  /** Probability per tick of firing while eligible. */
  chance: z.number().min(0).max(1).default(0.3),
  cooldown: z.number().int().min(0).default(5),
  maxOccurrences: z.number().int().min(1).nullable().default(null),
  storylineIds: z.array(z.string()).default([]),
  importance: z.enum(IMPORTANCE).default("notable"),
  narrative: z.object({
    headline: z.string().min(1).max(200),
    text: z.string().min(1).max(3000),
  }).strict(),
  status: z.enum(DEFINITION_STATUSES).default("draft"),
  source: z.string().default("manual"),
  tags: z.array(z.string()).default([]),
}).strict();
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;
export type EventDefinitionInput = z.input<typeof EventDefinitionSchema>;

/* ------------------------------------------------------------------ */
/* Storylines — groups of related narrative possibilities              */
/* ------------------------------------------------------------------ */

export const StorylineSchema = z.object({
  id: EventIdSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(2000),
  themes: z.array(z.string()).default([]),
  /** Possible beats. Not an ordered script — beats activate when their events' preconditions hold. */
  beats: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    eventIds: z.array(z.string()),
  }).strict()).default([]),
  possibleOutcomes: z.array(z.string()).default([]),
  status: z.enum(DEFINITION_STATUSES).default("published"),
}).strict();
export type Storyline = z.infer<typeof StorylineSchema>;

/** Frozen content bundle a run is executed against. */
export interface ContentBundle {
  version: string;
  events: EventDefinition[];
  storylines: Storyline[];
}
