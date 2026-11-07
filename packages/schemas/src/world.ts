import { z } from "zod";
import { FACILITIES, LAWS, POLICIES, PROFESSIONS, PROJECT_APPROACHES, SPECIALTIES } from "./catalog";

export const ResourceSetSchema = z.object({
  food: z.number().min(0),
  water: z.number().min(0),
  materials: z.number().min(0),
  knowledge: z.number().min(0),
});
export type ResourceSet = z.infer<typeof ResourceSetSchema>;

export const ProfessionSchema = z.enum(PROFESSIONS);
export const PolicySchema = z.enum(POLICIES);

export const SettlementSchema = z.object({
  id: z.string(),
  name: z.string(),
  locationId: z.string(),
  kind: z.enum(["bunker", "settlement"]),
  status: z.enum(["active", "abandoned"]),
  foundedTick: z.number().int(),
  abandonedTick: z.number().int().nullable(),
  level: z.number().int().min(1).max(5),
  morale: z.number().min(0).max(100),
  health: z.number().min(0).max(100),
  capacity: z.number().int().min(0),
  resources: ResourceSetSchema,
  /** Consecutive ticks in shortage, per resource. */
  shortage: z.object({ food: z.number().int().min(0), water: z.number().int().min(0) }),
  /** History id of the event that opened the current shortage (causal link for deaths). */
  shortageOrigin: z.object({ food: z.string().nullable(), water: z.string().nullable() }),
  /** An outpost: the settlement that founded it keeps it supplied until it can stand on its own. */
  supportedBy: z.string().nullable().optional(),
  /** Buildings and their condition (0–100). */
  facilities: z.partialRecord(z.enum(FACILITIES), z.number().min(0).max(100)).optional(),
  /** Buildings under construction: facility -> season index it is finished. */
  building: z.partialRecord(z.enum(FACILITIES), z.number().int()).optional(),
  /** Laws in force. */
  laws: z.array(z.enum(LAWS)).optional(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const LocationStateSchema = z.object({
  id: z.string(),
  discovered: z.boolean(),
  discoveredTick: z.number().int().nullable(),
  settlementId: z.string().nullable(),
  /** Settlement that has staked a claim to this site (and takes what it yields). */
  claimedBy: z.string().nullable().optional(),
});
export type LocationState = z.infer<typeof LocationStateSchema>;

export const LifeEventSchema = z.object({
  tick: z.number().int(),
  text: z.string(),
  historyId: z.string().nullable(),
});
export type LifeEvent = z.infer<typeof LifeEventSchema>;

/** Personal attributes, 0–100. */
export const ATTRIBUTES = ["health", "social", "knowledge", "survival"] as const;
export type AttributeId = (typeof ATTRIBUTES)[number];
export const AttributesSchema = z.object({
  health: z.number().min(0).max(100),
  social: z.number().min(0).max(100),
  knowledge: z.number().min(0).max(100),
  survival: z.number().min(0).max(100),
});
export type Attributes = z.infer<typeof AttributesSchema>;

export const CharacterSchema = z.object({
  id: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  birthTick: z.number().int(),
  deathTick: z.number().int().nullable(),
  causeOfDeath: z.string().nullable(),
  profession: ProfessionSchema.nullable(),
  homeId: z.string(),
  parentIds: z.array(z.string()),
  traits: z.array(z.string()),
  lifeEvents: z.array(LifeEventSchema),
  /** Player currently controlling this character. Absent = NPC run by the simulation. */
  controllerId: z.string().optional(),
  /** Characters who adopted or cared for this one (succession candidates for their players). */
  caretakerIds: z.array(z.string()).optional(),
  /** Present in worlds with attributes enabled. */
  attributes: AttributesSchema.optional(),
  /** Skills learned along the way; the young can pick them up from parents and carers. */
  specialties: z.array(z.enum(SPECIALTIES)).optional(),
  /** Away (on an expedition, a long job) until this season index (tick * 4 + season). */
  awayUntil: z.number().int().optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const FlagValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type FlagValue = z.infer<typeof FlagValueSchema>;

export const PLAYER_STATUSES = ["active", "awaiting_succession", "awaiting_birth", "left"] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** A human player taking part in this world. Players control at most one living character. */
export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  joinedTick: z.number().int(),
  status: z.enum(PLAYER_STATUSES),
  characterId: z.string().nullable(),
  /** Every character this player has controlled, oldest first. */
  lineage: z.array(z.string()),
  /** Prologue steps completed (first session only). */
  prologue: z.array(z.string()).optional(),
  /** Personal events this player has had: definition id -> last tick and count. */
  personal: z.record(z.string(), z.object({ last: z.number().int(), count: z.number().int() })).optional(),
});
export type Player = z.infer<typeof PlayerSchema>;

/**
 * A narrative event waiting for player decisions. Created when an event fires
 * with player-controlled participants; resolved at `resolveTick`. Every
 * participant decides for themselves — nobody decides for anyone else.
 */
export const PendingDecisionSchema = z.object({
  /** History id of the event that opened this decision. */
  id: z.string(),
  definitionId: z.string(),
  definitionVersion: z.number().int(),
  settlementId: z.string().nullable(),
  roles: z.record(z.string(), z.string()),
  participants: z.array(z.string()),
  firedTick: z.number().int(),
  resolveTick: z.number().int(),
  /** characterId -> choiceId, submitted by players before the deadline. */
  responses: z.record(z.string(), z.string()),
});
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const INVITE_KINDS = ["child", "ward", "companion", "next_child"] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

/** A player inviting a friend to play a character close to their own. */
export const InviteSchema = z.object({
  code: z.string(),
  fromPlayerId: z.string(),
  fromCharacterId: z.string(),
  /** null = the inviter's next child, assigned when born. */
  characterId: z.string().nullable(),
  kind: z.enum(INVITE_KINDS),
  createdTick: z.number().int(),
  expiresTick: z.number().int(),
  acceptedBy: z.string().nullable(),
});
export type Invite = z.infer<typeof InviteSchema>;

/**
 * A shared undertaking that turns into a technology when its work is done:
 * a water wheel, a school, a charter. Started by the council or by a player;
 * the people working on it are what move it forward.
 */
export const ProjectSchema = z.object({
  id: z.string(),
  techId: z.string(),
  settlementId: z.string(),
  startedTick: z.number().int(),
  startedBy: z.enum(["council", "player"]),
  /** Character leading the work. */
  leadId: z.string(),
  /** Player characters who joined. They stay on it until they leave, move or die. */
  memberIds: z.array(z.string()),
  /** Non-player characters working on it this year (recomputed each year). */
  crewIds: z.array(z.string()),
  progress: z.number().min(0),
  /** Work gained last year, for display. */
  lastGain: z.number().min(0),
  /** Consecutive years with nobody working on it. */
  idleYears: z.number().int().min(0),
  /** Work each person has put in so far (character id -> work), kept for history. */
  contributions: z.record(z.string(), z.number()).optional(),
  /** Tick each player last put materials into it (once a year each). */
  donations: z.record(z.string(), z.number().int()).optional(),
  /** Last few things that happened to it, newest last (for players to see). */
  log: z.array(z.object({ tick: z.number().int(), text: z.string() })).optional(),
  /** How it is being run (chosen by its lead). Absent = steady. */
  approach: z.enum(PROJECT_APPROACHES).optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Seasons: a world year has four. Season index = tick * 4 + season (0 spring … 3 winter). */
export const SEASONS_PER_YEAR = 4;

export const ScheduledEventSchema = z.object({
  id: z.string(),
  /** The scheduledOnly event to fire, or "" for an inline AFTER outcome. */
  definitionId: z.string(),
  /** Inline outcome (AFTER effect): what happens and how it reads. */
  inline: z.object({
    title: z.string(),
    text: z.string(),
    effects: z.array(z.unknown()),
    risk: z.object({ chance: z.number(), text: z.string(), effects: z.array(z.unknown()) }).optional(),
    /** Roles that went away: if one has died, the outcome is lost. */
    away: z.array(z.string()),
    category: z.string(),
  }).optional(),
  /** Season index it happens in. */
  dueSeason: z.number().int(),
  settlementId: z.string().nullable(),
  /** Roles carried over from the event that scheduled it. */
  roles: z.record(z.string(), z.string()),
  /** History id of that event. */
  causeId: z.string(),
  /** Roles that went away for it: if one of them has died, it is lost. */
  away: z.array(z.string()).optional(),
});
export type ScheduledEvent = z.infer<typeof ScheduledEventSchema>;

export const WORLD_LOCALES = ["en", "zh-TW"] as const;
export type WorldLocale = (typeof WORLD_LOCALES)[number];

export const WorldStateSchema = z.object({
  schemaVersion: z.literal(1),
  /** Language of engine-generated text. Absent = English (worlds created before locales existed). */
  locale: z.enum(WORLD_LOCALES).optional(),
  rulesVersion: z.string(),
  worldName: z.string(),
  seed: z.number().int(),
  /** Authoritative simulation time. One tick = one year in this MVP. */
  tick: z.number().int().min(0),
  ticksPerYear: z.number().int().min(1),
  startYear: z.number().int(),
  /** Deterministic RNG state (uint32). */
  rng: z.number().int().min(0),
  policy: PolicySchema,
  researchFocus: z.string().nullable(),
  settlements: z.array(SettlementSchema),
  locations: z.array(LocationStateSchema),
  characters: z.array(CharacterSchema),
  technologies: z.array(z.string()),
  techUnlockedAt: z.record(z.string(), z.number().int()),
  flags: z.record(z.string(), FlagValueSchema),
  /** flag -> history id that set it (provenance). */
  flagOrigins: z.record(z.string(), z.string()),
  /** Revealed secrets only. Unrevealed secrets are simply absent. */
  secrets: z.record(z.string(), z.object({ revealedTick: z.number().int(), historyId: z.string() })),
  /** Undirected relationship strength keyed "charA|charB" (sorted ids), -100..100. */
  relationships: z.record(z.string(), z.number()),
  eventMemory: z.object({
    lastFiredTick: z.record(z.string(), z.number().int()),
    counts: z.record(z.string(), z.number().int()),
    lastHistoryId: z.record(z.string(), z.string()),
  }),
  counters: z.object({ nextCharacter: z.number().int(), nextHistory: z.number().int(), nextSettlement: z.number().int(), nextProject: z.number().int().optional() }),
  milestones: z.array(z.string()),
  stats: z.object({ births: z.number().int(), deaths: z.number().int(), peakPopulation: z.number().int() }),
  /**
   * Multiplayer state. Optional so worlds that never had a player keep the
   * exact shape (and hash) they had before players existed.
   */
  players: z.record(z.string(), PlayerSchema).optional(),
  pendingDecisions: z.array(PendingDecisionSchema).optional(),
  invites: z.record(z.string(), InviteSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  /** Tension between two settlements, keyed "idA|idB" (sorted), 0 (at peace) to 100 (open hostility). */
  tensions: z.record(z.string(), z.number()).optional(),
  /** Follow-up events waiting for their season (an expedition's return, a harvest). */
  scheduled: z.array(ScheduledEventSchema).optional(),
});
export type WorldState = z.infer<typeof WorldStateSchema>;
