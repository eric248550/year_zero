import {
  POLICY_INFO,
  type Character,
  type Choice,
  type ChoiceTag,
  type EventDefinition,
  type HistoricalEvent,
  type PendingDecision,
  type PolicyId,
  type Rng,
  type WorldState,
} from "@genesis/schemas";
import { applyEffects, newRecorder, spendResources, transact, type ChangeRecorder, type EffectContext } from "./effects";
import { EffectError } from "./errors";
import { allocateHistoryId, characterAge, currentYear, fullName, getCharacter, round2 } from "./queries";
import { renderTemplate } from "./template";
import { listNames, say, templateValues } from "./texts";

/** Minimum age to take part in an "everyone" event. */
export const PARTICIPATION_MIN_AGE = 12;

/** Ticks a pending decision stays open (1 tick = 1 real day in the live game). */
export const DECISION_WINDOW_TICKS = 1;

/**
 * How personality bends an autopilot decision. A character's traits multiply
 * the policy weight of each choice tag. Used for NPCs and for players who did
 * not answer in time.
 */
export const TRAIT_TAG_WEIGHTS: Record<string, Partial<Record<ChoiceTag, number>>> = {
  stubborn: { cautious: 1.2, openness: 0.8 },
  curious: { science: 1.4, openness: 1.2, bold: 1.1 },
  gentle: { community: 1.4, bold: 0.7 },
  restless: { bold: 1.4, growth: 1.2, cautious: 0.7 },
  devout: { community: 1.2, secrecy: 1.1, science: 0.8 },
  pragmatic: { industry: 1.3, cautious: 1.1 },
  haunted: { cautious: 1.4, secrecy: 1.2 },
  cheerful: { community: 1.2, openness: 1.2 },
  secretive: { secrecy: 1.6, openness: 0.6 },
  brave: { bold: 1.5, cautious: 0.7 },
};

export function personalScore(choice: Choice, policy: PolicyId, traits: readonly string[]): number {
  if (choice.tags.length === 0) return 1;
  const weights = POLICY_INFO[policy].tagWeights;
  const total = choice.tags.reduce((sum, tag) => {
    const personal = traits.reduce((m, t) => m * (TRAIT_TAG_WEIGHTS[t]?.[tag] ?? 1), 1);
    return sum + weights[tag] * personal;
  }, 0);
  return total / choice.tags.length;
}

export function isPlayerControlled(c: Character | undefined): boolean {
  return !!c && c.deathTick === null && !!c.controllerId;
}

/**
 * Characters who decide for themselves when this event fires.
 * - "roles": the role holders.
 * - "everyone": every living resident aged 12+ of the anchor (or the world).
 */
export function participantsFor(state: WorldState, def: EventDefinition, settlementId: string | null, roles: Record<string, string>): string[] {
  if ((def.participation ?? "roles") === "everyone") {
    return state.characters
      .filter((c) => c.deathTick === null && (settlementId === null || c.homeId === settlementId) && characterAge(state, c) >= PARTICIPATION_MIN_AGE)
      .map((c) => c.id);
  }
  return [...new Set(Object.values(roles))];
}

/**
 * Which participants get a pending decision. In "roles" events only players
 * decide (NPC role holders follow along); in "everyone" events NPCs decide
 * for themselves at resolution time, so everyone is listed.
 */
export function decidersFor(state: WorldState, def: EventDefinition, participants: readonly string[]): string[] {
  if ((def.participation ?? "roles") === "everyone") return [...participants];
  return participants.filter((id) => isPlayerControlled(getCharacter(state, id)));
}

/** Players currently waiting on a decision, by character. */
export function pendingFor(state: WorldState, characterId: string): PendingDecision[] {
  return (state.pendingDecisions ?? []).filter((p) => p.participants.includes(characterId));
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface DecisionRejection {
  definitionId: string;
  reason: string;
}

interface Pick {
  characterId: string;
  choiceId: string;
  decidedBy: "player" | "autopilot" | "npc";
}

function availableChoices(
  state: WorldState,
  def: EventDefinition,
  p: PendingDecision,
  available: (state: WorldState, choice: Choice) => boolean,
): Choice[] {
  return def.choices.filter((c) => available(state, c) && c.requiresRoles.every((r) => p.roles[r] !== undefined));
}

/**
 * Resolve every pending decision whose deadline has arrived. Participants are
 * grouped by what they chose; each group's choice runs once, `memberEffects`
 * and risk run once per member. Larger groups share the risk: each member's
 * risk chance is divided by sqrt(group size).
 */
export function resolvePendingDecisions(
  state: WorldState,
  definitions: readonly EventDefinition[],
  rng: Rng,
  isAvailable: (state: WorldState, choice: Choice, settlementId: string | null) => boolean,
): { state: WorldState; events: HistoricalEvent[]; rejections: DecisionRejection[] } {
  const due = (state.pendingDecisions ?? []).filter((p) => p.resolveTick <= state.tick);
  if (due.length === 0) return { state, events: [], rejections: [] };

  let current = structuredClone(state);
  current.pendingDecisions = (current.pendingDecisions ?? []).filter((p) => p.resolveTick > current.tick);
  const events: HistoricalEvent[] = [];
  const rejections: DecisionRejection[] = [];

  for (const p of due) {
    const def = definitions.find((d) => d.id === p.definitionId);
    if (!def) {
      rejections.push({ definitionId: p.definitionId, reason: "Definition is no longer in this run's content" });
      continue;
    }
    const settlement = p.settlementId ? current.settlements.find((s) => s.id === p.settlementId) ?? null : null;
    if (p.settlementId && (!settlement || settlement.status !== "active")) {
      rejections.push({ definitionId: def.id, reason: "The settlement is no longer active" });
      continue;
    }
    const choices = availableChoices(current, def, p, (st, c) => isAvailable(st, c, p.settlementId));
    if (choices.length === 0) {
      rejections.push({ definitionId: def.id, reason: "No choice is available any more" });
      continue;
    }

    // Each living participant decides for themselves.
    const picks: Pick[] = [];
    for (const id of p.participants) {
      const c = getCharacter(current, id);
      if (!c || c.deathTick !== null) continue;
      const answered = p.responses[id];
      const valid = answered ? choices.find((ch) => ch.id === answered) : undefined;
      if (valid) {
        picks.push({ characterId: id, choiceId: valid.id, decidedBy: "player" });
        continue;
      }
      const auto = rng.weighted(choices, (ch) => Math.pow(personalScore(ch, current.policy, c.traits), 4));
      picks.push({ characterId: id, choiceId: auto.id, decidedBy: c.controllerId ? "autopilot" : "npc" });
    }
    if (picks.length === 0) {
      rejections.push({ definitionId: def.id, reason: "Every participant died before deciding" });
      continue;
    }

    for (const choice of choices) {
      const members = picks.filter((x) => x.choiceId === choice.id);
      if (members.length === 0) continue;
      const result = resolveGroup(current, def, p, choice, members, rng);
      if ("error" in result) {
        rejections.push({ definitionId: def.id, reason: `${choice.label}: ${result.error}` });
        continue;
      }
      current = result.state;
      events.push(result.event, ...result.childEvents);
    }
  }
  return { state: current, events, rejections };
}

function resolveGroup(
  state: WorldState,
  def: EventDefinition,
  p: PendingDecision,
  choice: Choice,
  members: Pick[],
  rng: Rng,
): { state: WorldState; event: HistoricalEvent; childEvents: HistoricalEvent[] } | { error: string } {
  const settlement = p.settlementId ? state.settlements.find((s) => s.id === p.settlementId) ?? null : null;
  const riskChance = choice.risk ? round2(choice.risk.chance / Math.sqrt(members.length)) : 0;
  const riskRolls = members.map(() => (choice.risk ? rng.next() : 1));

  const baseCtx = (draft: WorldState, historyId: string, actor: string): EffectContext => ({
    tick: draft.tick,
    settlementId: p.settlementId,
    roles: { ...p.roles, actor },
    historyId,
    title: def.title,
    scope: def.scope,
    category: def.category,
    storylineIds: def.storylineIds,
  });

  // Group-level part: costs + choice effects, once. Atomic.
  let historyId = "";
  const rec: ChangeRecorder = newRecorder();
  let next: WorldState;
  try {
    next = transact(state, (draft) => {
      historyId = allocateHistoryId(draft);
      const draftSettlement = p.settlementId ? draft.settlements.find((s) => s.id === p.settlementId)! : null;
      if (choice.costs && Object.keys(choice.costs).length > 0) {
        if (!draftSettlement) throw new EffectError("Choice costs require a target settlement");
        spendResources(draftSettlement, choice.costs, rec);
      }
      applyEffects(draft, choice.effects, baseCtx(draft, historyId, members[0]!.characterId), rec);
    }).state;
  } catch (err) {
    if (err instanceof EffectError) return { error: err.message };
    throw err;
  }

  // Member-level part: personal effects and personal risk. Each member is atomic on their own.
  const struck: string[] = [];
  members.forEach((m, i) => {
    const memberRec = newRecorder();
    try {
      next = transact(next, (draft) => {
        const ctx = baseCtx(draft, historyId, m.characterId);
        const c = getCharacter(draft, m.characterId);
        if (!c || c.deathTick !== null) return;
        if (choice.memberEffects?.length) applyEffects(draft, choice.memberEffects, ctx, memberRec);
        // Seasoned survivors are harder to hurt: survival 50 = as written, 100 = 30% less, 0 = 30% more.
        const survival = draft.attributesEnabled ? c.attributes?.survival : undefined;
        const personal = survival === undefined ? riskChance : riskChance * Math.min(1.3, Math.max(0.7, 1.3 - (survival / 100) * 0.6));
        if (choice.risk && riskRolls[i]! < personal) {
          applyEffects(draft, choice.risk.effects, ctx, memberRec);
          struck.push(m.characterId);
        }
      }).state;
      rec.changes.push(...memberRec.changes);
      rec.childEvents.push(...memberRec.childEvents);
    } catch (err) {
      if (!(err instanceof EffectError)) throw err;
    }
  });

  const names = (ids: readonly string[]) => ids.map((id) => getCharacter(state, id)).filter((c): c is Character => !!c).map(fullName);
  const values = { ...templateValues(state, settlement, { ...p.roles, actor: members[0]!.characterId }), choice: choice.label };

  const memberNames = names(members.map((m) => m.characterId));
  const parts = [say(state).chose(listNames(state, memberNames), choice.label)];
  if (choice.outcome) parts.push(renderTemplate(choice.outcome, values));
  if (choice.risk && struck.length > 0) {
    for (const id of struck) parts.push(renderTemplate(choice.risk.description, { ...values, actor: names([id])[0] ?? "" }));
  }
  const counts = { player: 0, autopilot: 0, npc: 0 };
  for (const m of members) counts[m.decidedBy] += 1;
  const decidedBy = (Object.entries(counts) as [string, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join(", ");

  const event: HistoricalEvent = {
    id: historyId,
    tick: next.tick,
    year: currentYear(next),
    kind: "narrative",
    definitionId: def.id,
    definitionVersion: def.version,
    category: def.category,
    scope: def.scope,
    importance: def.importance,
    title: `${renderTemplate(def.narrative.headline, values)} — ${choice.label}`,
    text: parts.join("\n\n"),
    settlementIds: p.settlementId ? [p.settlementId] : [],
    characterIds: members.map((m) => m.characterId),
    storylineIds: def.storylineIds,
    causeIds: [p.id],
    parentId: p.id,
    trigger: {
      summary: `Resolved the decision opened in year ${next.startYear + p.firedTick}; ${members.length} participant(s) chose "${choice.label}"`,
      chance: null,
      roll: null,
      priority: def.priority,
      conditions: [],
      roles: p.roles,
    },
    choice: {
      id: choice.id,
      label: choice.label,
      decidedBy,
      alternatives: def.choices.map((c) => ({ id: c.id, label: c.label, available: true, reason: null, score: null })),
      risk: choice.risk
        ? { chance: riskChance, roll: round2(Math.min(...riskRolls)), triggered: struck.length > 0, description: choice.risk.description }
        : null,
    },
    changes: rec.changes,
  };
  for (const m of members) {
    const c = next.characters.find((x) => x.id === m.characterId);
    if (c && c.deathTick === null) c.lifeEvents.push({ tick: next.tick, text: event.title, historyId });
  }
  return { state: next, event, childEvents: rec.childEvents };
}
