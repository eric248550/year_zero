import { z } from "zod";
import { POLICIES, PROFESSIONS } from "./catalog";

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
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const LocationStateSchema = z.object({
  id: z.string(),
  discovered: z.boolean(),
  discoveredTick: z.number().int().nullable(),
  settlementId: z.string().nullable(),
});
export type LocationState = z.infer<typeof LocationStateSchema>;

export const LifeEventSchema = z.object({
  tick: z.number().int(),
  text: z.string(),
  historyId: z.string().nullable(),
});
export type LifeEvent = z.infer<typeof LifeEventSchema>;

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

export const WorldStateSchema = z.object({
  schemaVersion: z.literal(1),
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
  counters: z.object({ nextCharacter: z.number().int(), nextHistory: z.number().int(), nextSettlement: z.number().int() }),
  milestones: z.array(z.string()),
  stats: z.object({ births: z.number().int(), deaths: z.number().int(), peakPopulation: z.number().int() }),
  /**
   * Multiplayer state. Optional so worlds that never had a player keep the
   * exact shape (and hash) they had before players existed.
   */
  players: z.record(z.string(), PlayerSchema).optional(),
  pendingDecisions: z.array(PendingDecisionSchema).optional(),
  invites: z.record(z.string(), InviteSchema).optional(),
});
export type WorldState = z.infer<typeof WorldStateSchema>;
