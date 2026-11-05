import { z } from "zod";
import { EVENT_CATEGORIES, EVENT_SCOPES, IMPORTANCE } from "./catalog";

export const ChangeValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);

/** One atomic, recorded state transition. */
export const StateChangeSchema = z.object({
  path: z.string(),
  label: z.string(),
  before: ChangeValueSchema,
  after: ChangeValueSchema,
});
export type StateChange = z.infer<typeof StateChangeSchema>;

export const ConditionTraceSchema = z.object({
  description: z.string(),
  actual: ChangeValueSchema,
  passed: z.boolean(),
});
export type ConditionTrace = z.infer<typeof ConditionTraceSchema>;

export const HISTORY_CATEGORIES = [...EVENT_CATEGORIES, "demographic", "settlement", "milestone"] as const;

/** A thing that ACTUALLY happened. Immutable once committed. */
export const HistoricalEventSchema = z.object({
  id: z.string(),
  tick: z.number().int(),
  year: z.number().int(),
  kind: z.enum(["narrative", "system"]),
  definitionId: z.string().nullable(),
  definitionVersion: z.number().int().nullable(),
  category: z.enum(HISTORY_CATEGORIES),
  scope: z.enum(EVENT_SCOPES),
  importance: z.enum(IMPORTANCE),
  title: z.string(),
  text: z.string(),
  settlementIds: z.array(z.string()),
  characterIds: z.array(z.string()),
  storylineIds: z.array(z.string()),
  /** History ids that causally led to this event. */
  causeIds: z.array(z.string()),
  /** Set for sub-events created via CREATE_HISTORICAL_EVENT. */
  parentId: z.string().nullable(),
  trigger: z.object({
    summary: z.string(),
    chance: z.number().nullable(),
    roll: z.number().nullable(),
    priority: z.number().nullable(),
    conditions: z.array(ConditionTraceSchema),
    roles: z.record(z.string(), z.string()),
  }).nullable(),
  choice: z.object({
    id: z.string(),
    label: z.string(),
    decidedBy: z.string(),
    alternatives: z.array(z.object({ id: z.string(), label: z.string(), available: z.boolean(), reason: z.string().nullable(), score: z.number().nullable() })),
    risk: z.object({ chance: z.number(), roll: z.number(), triggered: z.boolean(), description: z.string() }).nullable(),
  }).nullable(),
  changes: z.array(StateChangeSchema),
});
export type HistoricalEvent = z.infer<typeof HistoricalEventSchema>;
