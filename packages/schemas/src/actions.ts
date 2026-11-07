import { z } from "zod";
import { PROFESSIONS, PROJECT_APPROACHES, RESOURCES } from "./catalog";
import { PolicySchema } from "./world";

/**
 * Developer / player actions. Every action is validated by the simulation
 * before being applied, and every accepted action is logged so runs can be
 * replayed without any external input.
 */
const PlayerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "player ids are 1-64 letters, digits, _ or -");
/** One part of a character's name. Trimmed; no control characters. */
const NamePartSchema = z.string().trim().min(1).max(20).regex(/^[^\p{C}]+$/u, "names cannot contain control characters");
const InviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{4,32}$/, "invite codes are 4-32 letters, digits, _ or -");

/** Ways a new player can enter the world. Most unlock as the world develops. */
export const ORIGIN_IDS = ["haven_deep", "surface_born", "wanderer", "vault12"] as const;
export type OriginId = (typeof ORIGIN_IDS)[number];

/** Actions taken by individual players (as opposed to developer/council directives). */
export const PLAYER_ACTION_TYPES = ["JOIN_WORLD", "CHOOSE", "CONTINUE_AS", "CARE_FOR", "INVITE", "LEAVE_WORLD", "PROLOGUE", "RENAME", "START_PROJECT", "JOIN_PROJECT", "PROJECT_APPROACH", "DONATE_PROJECT"] as const;

/** The first-session prologue: three small choices whose results show at once. Order matters. */
export const PROLOGUE_STEPS = {
  first_climb: ["surface", "repair"],
  water: ["share", "refuse"],
  static: ["tell", "keep"],
} as const;
export type PrologueStep = keyof typeof PROLOGUE_STEPS;
export const PROLOGUE_ORDER = Object.keys(PROLOGUE_STEPS) as PrologueStep[];

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
    givenName: NamePartSchema.optional(),
    familyName: NamePartSchema.optional(),
    profession: z.enum(PROFESSIONS).optional(),
    /** Personality trait (validated against the simulation's trait list). */
    trait: z.string().max(24).optional(),
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
  z.object({ type: z.literal("RENAME"), playerId: PlayerIdSchema, givenName: NamePartSchema, familyName: NamePartSchema.or(z.literal("")) }).strict(),
  z.object({
    type: z.literal("PROLOGUE"),
    playerId: PlayerIdSchema,
    step: z.enum(["first_climb", "water", "static"]),
    choiceId: z.string(),
  }).strict(),
  /** Start a project in your own settlement and lead it. */
  z.object({ type: z.literal("START_PROJECT"), playerId: PlayerIdSchema, tech: z.string() }).strict(),
  /** Join a project in your settlement; null leaves the one you are on. */
  z.object({ type: z.literal("JOIN_PROJECT"), playerId: PlayerIdSchema, projectId: z.string().nullable() }).strict(),
  /** The lead decides how their project is run. */
  z.object({ type: z.literal("PROJECT_APPROACH"), playerId: PlayerIdSchema, approach: z.enum(PROJECT_APPROACHES) }).strict(),
  /** A member puts some of the settlement's materials into their project (once a year). */
  z.object({ type: z.literal("DONATE_PROJECT"), playerId: PlayerIdSchema, amount: z.number().int().min(5).max(50) }).strict(),
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
