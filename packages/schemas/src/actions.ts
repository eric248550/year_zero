import { z } from "zod";
import { PROFESSIONS, RESOURCES } from "./catalog";
import { PolicySchema } from "./world";

/**
 * Developer / player actions. Every action is validated by the simulation
 * before being applied, and every accepted action is logged so runs can be
 * replayed without any external input.
 */
const PlayerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "player ids are 1-64 letters, digits, _ or -");
const InviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{4,32}$/, "invite codes are 4-32 letters, digits, _ or -");

/** Ways a new player can enter the world. Most unlock as the world develops. */
export const ORIGIN_IDS = ["haven_deep", "surface_born", "wanderer", "vault12"] as const;
export type OriginId = (typeof ORIGIN_IDS)[number];

/** Actions taken by individual players (as opposed to developer/council directives). */
export const PLAYER_ACTION_TYPES = ["JOIN_WORLD", "CHOOSE", "CONTINUE_AS", "CARE_FOR", "INVITE", "LEAVE_WORLD"] as const;

export const PlayerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("JOIN_WORLD"),
    playerId: PlayerIdSchema,
    playerName: z.string().min(1).max(40),
    /** Where the new character comes from. Ignored when joining by invite. */
    origin: z.enum(ORIGIN_IDS).optional(),
    /** Take over an existing uncontrolled character of that origin instead of creating one. */
    characterId: z.string().optional(),
    /** Settlement to arrive at / grow up in (surface_born, wanderer, vault12). */
    settlementId: z.string().optional(),
    givenName: z.string().min(1).max(30).optional(),
    profession: z.enum(PROFESSIONS).optional(),
    inviteCode: InviteCodeSchema.optional(),
  }).strict(),
  z.object({ type: z.literal("CHOOSE"), playerId: PlayerIdSchema, decisionId: z.string(), choiceId: z.string() }).strict(),
  z.object({
    type: z.literal("CONTINUE_AS"),
    playerId: PlayerIdSchema,
    /** random = reborn as an uncontrolled child somewhere; character = a child, ward or close companion. */
    mode: z.enum(["random", "character"]),
    characterId: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal("CARE_FOR"), playerId: PlayerIdSchema, characterId: z.string() }).strict(),
  z.object({
    type: z.literal("INVITE"),
    playerId: PlayerIdSchema,
    code: InviteCodeSchema,
    /** Omit to invite a friend to be your next child. */
    characterId: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal("LEAVE_WORLD"), playerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("SET_POLICY"), policy: PolicySchema }).strict(),
  z.object({ type: z.literal("SET_RESEARCH_FOCUS"), tech: z.string().nullable() }).strict(),
  z.object({
    type: z.literal("FOUND_SETTLEMENT"),
    locationId: z.string(),
    fromSettlementId: z.string(),
    settlers: z.number().int().min(4).max(40),
  }).strict(),
  z.object({ type: z.literal("LAUNCH_EXPEDITION"), settlementId: z.string() }).strict(),
  z.object({ type: z.literal("ASSIGN_PROFESSION"), characterId: z.string(), profession: z.enum(PROFESSIONS) }).strict(),
  z.object({
    type: z.literal("TRANSFER_RESOURCES"),
    fromSettlementId: z.string(),
    toSettlementId: z.string(),
    resource: z.enum(RESOURCES),
    amount: z.number().positive().max(1000),
  }).strict(),
]);
export type PlayerAction = z.infer<typeof PlayerActionSchema>;
