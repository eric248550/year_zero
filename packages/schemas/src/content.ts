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
} from "./catalog";
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
  /** Minimum attribute values (worlds without attributes treat everyone as 50). */
  minAttributes: z.object({ health: z.number(), social: z.number(), knowledge: z.number(), survival: z.number() }).partial().strict().optional(),
}).strict();
export type Role = z.infer<typeof RoleSchema>;

/* ------------------------------------------------------------------ */
/* Effects — the ONLY way narrative content can change world state     */
/* ------------------------------------------------------------------ */

const SettlementTargetSchema = z.enum(["settlement", "all_settlements"]).default("settlement");

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
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export const EffectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ADJUST_RESOURCE"),
    resource: ResourceIdSchema,
    /** Positive = gain. Negative = loss, clamped at zero (losses never go negative). */
    amount: z.number().finite().min(-500).max(500),
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
]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectInput = z.input<typeof EffectSchema>;

/* ------------------------------------------------------------------ */
/* Choices                                                             */
/* ------------------------------------------------------------------ */

export const CostSchema = z.object({
  food: z.number().min(0).optional(),
  water: z.number().min(0).optional(),
  materials: z.number().min(0).optional(),
  knowledge: z.number().min(0).optional(),
}).strict();

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
