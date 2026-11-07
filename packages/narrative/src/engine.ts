import {
  POLICY_INFO,
  type Character,
  type Choice,
  type ConditionTrace,
  type EventDefinition,
  type HistoricalEvent,
  type Player,
  type PolicyId,
  type Rng,
  type Settlement,
  type WorldState,
} from "@genesis/schemas";
import { causesFor, evaluateAll } from "./conditions";
import { applyEffects, canAfford, newRecorder, spendResources, transact, type EffectContext } from "./effects";
import { EffectError } from "./errors";
import { activeSettlements, allocateHistoryId, currentYear, fullName, getCharacter, round2 } from "./queries";
import { candidatesForRole, resolveRoles, rolesSatisfiable } from "./roles";
import { renderTemplate } from "./template";
import { DECISION_WINDOW_TICKS, decidersFor, isPlayerControlled, participantsFor } from "./decisions";
import { isZh, listNames, say, templateValues } from "./texts";

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export interface AnchorReport {
  settlementId: string | null;
  settlementName: string | null;
  eligible: boolean;
  traces: ConditionTrace[];
  rolesOk: boolean;
  choicesOk: boolean;
}

export interface EligibilityReport {
  definitionId: string;
  eligible: boolean;
  blockedBy: string | null;
  anchors: AnchorReport[];
}

export function cooldownRemaining(state: WorldState, def: EventDefinition): number {
  const last = state.eventMemory.lastFiredTick[def.id];
  if (last === undefined) return 0;
  return Math.max(0, def.cooldown - (state.tick - last));
}

function anchorsFor(state: WorldState, def: EventDefinition): (Settlement | null)[] {
  if (def.scope === "world") return [null];
  return activeSettlements(state);
}

/** Full eligibility analysis — used both by the engine and by the Studio's "why / why not" views. */
export function checkEligibility(state: WorldState, def: EventDefinition): EligibilityReport {
  const base = { definitionId: def.id, anchors: [] as AnchorReport[] };
  if (def.status !== "published") return { ...base, eligible: false, blockedBy: `Status is ${def.status}, not published` };
  const count = state.eventMemory.counts[def.id] ?? 0;
  if (def.maxOccurrences !== null && count >= def.maxOccurrences) {
    return { ...base, eligible: false, blockedBy: `Already occurred ${count}/${def.maxOccurrences} times` };
  }
  const cd = cooldownRemaining(state, def);
  if (cd > 0) return { ...base, eligible: false, blockedBy: `On cooldown for ${cd} more tick(s)` };

  const anchors = anchorsFor(state, def).map((s): AnchorReport => {
    const { passed, traces } = evaluateAll(state, def.preconditions, { settlement: s });
    const rolesOk = passed && rolesSatisfiable(state, def.roles, s?.id ?? null);
    // Which roles could be filled at all (approximation used to check choice role requirements).
    const fillable: Record<string, string> = {};
    if (rolesOk) for (const r of def.roles) if (candidatesForRole(state, r, s?.id ?? null, new Set()).length > 0) fillable[r.id] = "?";
    const choicesOk = rolesOk && (def.choices.length === 0 || def.choices.some((c) => choiceAvailability(state, c, s, fillable).available));
    return {
      settlementId: s?.id ?? null,
      settlementName: s?.name ?? null,
      eligible: passed && rolesOk && choicesOk,
      traces,
      rolesOk,
      choicesOk,
    };
  });
  const eligible = anchors.some((a) => a.eligible);
  let blockedBy: string | null = null;
  if (!eligible) {
    if (anchors.length === 0) blockedBy = "No active settlement to host this event";
    else if (anchors.every((a) => a.traces.some((t) => !t.passed))) blockedBy = "Preconditions not met";
    else if (anchors.some((a) => !a.rolesOk)) blockedBy = "No living characters can fill the required roles";
    else blockedBy = "No choice is currently available (requirements or costs)";
  }
  return { ...base, eligible, blockedBy, anchors };
}

/* ------------------------------------------------------------------ */
/* Choices                                                             */
/* ------------------------------------------------------------------ */

export interface ChoiceAvailability {
  available: boolean;
  reason: string | null;
}

export function choiceAvailability(
  state: WorldState,
  choice: Choice,
  settlement: Settlement | null,
  roles: Record<string, string> | null,
): ChoiceAvailability {
  if (choice.costs && Object.keys(choice.costs).length > 0) {
    if (!settlement) return { available: false, reason: "Costs require a target settlement" };
    if (!canAfford(settlement, choice.costs)) return { available: false, reason: "Insufficient resources" };
  }
  const req = evaluateAll(state, choice.requires, { settlement });
  if (!req.passed) return { available: false, reason: req.traces.find((t) => !t.passed)?.description ?? "Requirement failed" };
  if (roles) {
    const missing = choice.requiresRoles.find((r) => roles[r] === undefined);
    if (missing) return { available: false, reason: `Nobody available for role "${missing}"` };
  }
  return { available: true, reason: null };
}

export function scoreChoice(choice: Choice, policy: PolicyId): number {
  if (choice.tags.length === 0) return 1;
  const weights = POLICY_INFO[policy].tagWeights;
  return choice.tags.reduce((sum, t) => sum + weights[t], 0) / choice.tags.length;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface NarrativeOptions {
  maxEventsPerTick: number;
  /** Developer decisions: definitionId -> choiceId. Logged and replayed. */
  choiceOverrides?: Record<string, string>;
}

export interface EventRejection {
  definitionId: string;
  reason: string;
}

export interface ExecutionResult {
  state: WorldState;
  events: HistoricalEvent[];
}

/** Execute a single event definition against a specific anchor. Atomic: throws without mutating on failure. */
export function executeEvent(
  state: WorldState,
  def: EventDefinition,
  settlementId: string | null,
  rng: Rng,
  meta: { chance: number | null; roll: number | null; choiceOverride?: string | undefined; forcedRoles?: Record<string, string> },
): ExecutionResult {
  const settlement = settlementId ? state.settlements.find((s) => s.id === settlementId) ?? null : null;
  const roles = resolveRoles(state, def.roles, settlementId, rng, meta.forcedRoles);
  if (!roles) throw new EffectError("Required roles could not be filled");

  const { passed, traces } = evaluateAll(state, def.preconditions, { settlement });
  if (!passed) throw new EffectError("Preconditions no longer hold");

  // Decide choice before mutation so the decision is based on pre-event state.
  const options = def.choices.map((c) => ({ choice: c, ...choiceAvailability(state, c, settlement, roles), score: round2(scoreChoice(c, state.policy)) }));
  const available = options.filter((o) => o.available);
  if (def.choices.length > 0 && available.length === 0) throw new EffectError("No available choice");

  // Players decide for themselves: open a pending decision instead of letting the council choose.
  const deciders = decidersFor(state, def, participantsFor(state, def, settlementId, roles));
  if (available.length > 0 && deciders.some((id) => isPlayerControlled(getCharacter(state, id)))) {
    return openDecision(state, def, settlementId, roles, deciders, traces, meta);
  }

  let chosen: (typeof options)[number] | undefined;
  let decidedBy = `policy:${state.policy}`;
  const override = meta.choiceOverride ? available.find((o) => o.choice.id === meta.choiceOverride) : undefined;
  if (override) {
    chosen = override;
    decidedBy = "developer override";
  } else if (available.length > 0) {
    chosen = rng.weighted(available, (o) => Math.pow(o.score, 4));
  }
  const riskRoll = chosen?.choice.risk ? rng.next() : null;

  const { state: next, result } = transact(state, (draft) => {
    const historyId = allocateHistoryId(draft);
    const rec = newRecorder();
    const ctx: EffectContext = {
      tick: draft.tick,
      settlementId,
      roles,
      historyId,
      title: def.title,
      scope: def.scope,
      category: def.category,
      storylineIds: def.storylineIds,
    };
    const draftSettlement = settlementId ? draft.settlements.find((s) => s.id === settlementId)! : null;

    applyEffects(draft, def.effects, ctx, rec);
    let riskTriggered = false;
    if (chosen) {
      if (chosen.choice.costs) {
        if (!draftSettlement) throw new EffectError("Choice costs require a target settlement");
        spendResources(draftSettlement, chosen.choice.costs, rec);
      }
      applyEffects(draft, chosen.choice.effects, ctx, rec);
      if (chosen.choice.risk && riskRoll !== null && riskRoll < chosen.choice.risk.chance) {
        riskTriggered = true;
        applyEffects(draft, chosen.choice.risk.effects, ctx, rec);
      }
    }

    // Template values use pre-event names; dead participants still have names.
    const values = templateValues(state, settlement, roles);
    if (chosen) values.choice = chosen.choice.label;

    const parts = [renderTemplate(def.narrative.text, values)];
    if (chosen) {
      parts.push(`${say(state).decision(chosen.choice.label)}${chosen.choice.outcome ? `${isZh(state) ? "" : " "}${renderTemplate(chosen.choice.outcome, values)}` : ""}`);
      if (riskTriggered && chosen.choice.risk) parts.push(renderTemplate(chosen.choice.risk.description, values));
    }

    const conditionsCauses = causesFor(state, def.preconditions, settlement);
    const event: HistoricalEvent = {
      id: historyId,
      tick: draft.tick,
      year: currentYear(draft),
      kind: "narrative",
      definitionId: def.id,
      definitionVersion: def.version,
      category: def.category,
      scope: def.scope,
      importance: def.importance,
      title: renderTemplate(def.narrative.headline, values),
      text: parts.join("\n\n"),
      settlementIds: settlementId ? [settlementId] : [],
      characterIds: Object.values(roles),
      storylineIds: def.storylineIds,
      causeIds: conditionsCauses,
      parentId: null,
      trigger: {
        summary: `${def.title} became eligible (${traces.length} precondition${traces.length === 1 ? "" : "s"} met) and fired with chance ${def.chance}`,
        chance: meta.chance,
        roll: meta.roll === null ? null : round2(meta.roll),
        priority: def.priority,
        conditions: traces,
        roles,
      },
      choice: chosen
        ? {
            id: chosen.choice.id,
            label: chosen.choice.label,
            decidedBy,
            alternatives: options.map((o) => ({ id: o.choice.id, label: o.choice.label, available: o.available, reason: o.reason, score: o.score })),
            risk: chosen.choice.risk && riskRoll !== null
              ? { chance: chosen.choice.risk.chance, roll: round2(riskRoll), triggered: riskTriggered, description: chosen.choice.risk.description }
              : null,
          }
        : null,
      changes: rec.changes,
    };

    for (const id of Object.values(roles)) {
      const c = draft.characters.find((x) => x.id === id);
      if (c && c.deathTick === null) c.lifeEvents.push({ tick: draft.tick, text: event.title, historyId });
    }
    draft.eventMemory.lastFiredTick[def.id] = draft.tick;
    draft.eventMemory.counts[def.id] = (draft.eventMemory.counts[def.id] ?? 0) + 1;
    draft.eventMemory.lastHistoryId[def.id] = historyId;
    return [event, ...rec.childEvents];
  });

  return { state: next, events: result };
}

/** Fire an event whose choice belongs to its participants. Base effects apply now; choices resolve next tick. */
function openDecision(
  state: WorldState,
  def: EventDefinition,
  settlementId: string | null,
  roles: Record<string, string>,
  deciders: string[],
  traces: ConditionTrace[],
  meta: { chance: number | null; roll: number | null },
): ExecutionResult {
  const settlement = settlementId ? state.settlements.find((s) => s.id === settlementId) ?? null : null;
  const { state: next, result } = transact(state, (draft) => {
    const historyId = allocateHistoryId(draft);
    const rec = newRecorder();
    const ctx: EffectContext = {
      tick: draft.tick,
      settlementId,
      roles,
      historyId,
      title: def.title,
      scope: def.scope,
      category: def.category,
      storylineIds: def.storylineIds,
    };
    applyEffects(draft, def.effects, ctx, rec);

    const values = templateValues(state, settlement, roles);
    const players = deciders.map((id) => getCharacter(state, id)).filter((c) => c?.controllerId).map((c) => fullName(c!));
    const resolveTick = draft.tick + DECISION_WINDOW_TICKS;
    const event: HistoricalEvent = {
      id: historyId,
      tick: draft.tick,
      year: currentYear(draft),
      kind: "narrative",
      definitionId: def.id,
      definitionVersion: def.version,
      category: def.category,
      scope: def.scope,
      importance: def.importance,
      title: renderTemplate(def.narrative.headline, values),
      text: [
        renderTemplate(def.narrative.text, values),
        say(state).eachDecides(listNames(state, players), deciders.length - players.length, draft.startYear + resolveTick),
      ].join("\n\n"),
      settlementIds: settlementId ? [settlementId] : [],
      characterIds: [...new Set([...Object.values(roles), ...deciders.filter((id) => getCharacter(state, id)?.controllerId)])],
      storylineIds: def.storylineIds,
      causeIds: causesFor(state, def.preconditions, settlement),
      parentId: null,
      trigger: {
        summary: `${def.title} became eligible and fired with chance ${def.chance}; waiting for ${deciders.length} participant decision(s)`,
        chance: meta.chance,
        roll: meta.roll === null ? null : round2(meta.roll),
        priority: def.priority,
        conditions: traces,
        roles,
      },
      choice: null,
      changes: rec.changes,
    };
    (draft.pendingDecisions ??= []).push({
      id: historyId,
      definitionId: def.id,
      definitionVersion: def.version,
      settlementId,
      roles,
      participants: deciders,
      firedTick: draft.tick,
      resolveTick,
      responses: {},
    });
    for (const id of Object.values(roles)) {
      const c = draft.characters.find((x) => x.id === id);
      if (c && c.deathTick === null) c.lifeEvents.push({ tick: draft.tick, text: event.title, historyId });
    }
    draft.eventMemory.lastFiredTick[def.id] = draft.tick;
    draft.eventMemory.counts[def.id] = (draft.eventMemory.counts[def.id] ?? 0) + 1;
    draft.eventMemory.lastHistoryId[def.id] = historyId;
    return [event, ...rec.childEvents];
  });
  return { state: next, events: result };
}

/**
 * Narrative phase of a tick: evaluate every published definition, then let
 * eligible ones fire (highest priority first) subject to their chance.
 */
export function runNarrativePhase(
  state: WorldState,
  definitions: readonly EventDefinition[],
  rng: Rng,
  options: NarrativeOptions,
): { state: WorldState; events: HistoricalEvent[]; rejections: EventRejection[] } {
  const ordered = [...definitions]
    .filter((d) => d.status === "published" && !(state.personalEvents && isPersonalEvent(d)))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  let current = state;
  const events: HistoricalEvent[] = [];
  const rejections: EventRejection[] = [];
  let fired = 0;

  for (const def of ordered) {
    if (fired >= options.maxEventsPerTick) break;
    const report = checkEligibility(current, def);
    if (!report.eligible) continue;
    const roll = rng.next();
    if (roll >= def.chance) continue;
    const anchors = report.anchors.filter((a) => a.eligible);
    const anchor = rng.pick(anchors);
    try {
      const result = executeEvent(current, def, anchor.settlementId, rng, {
        chance: def.chance,
        roll,
        choiceOverride: options.choiceOverrides?.[def.id],
      });
      current = result.state;
      events.push(...result.events);
      fired++;
    } catch (err) {
      if (err instanceof EffectError) rejections.push({ definitionId: def.id, reason: err.message });
      else throw err;
    }
  }
  return { state: current, events, rejections };
}

/* ------------------------------------------------------------------ */
/* Personal events                                                     */
/* ------------------------------------------------------------------ */

/** An event about one player: it has a role only a player can fill. */
export function isPersonalEvent(def: EventDefinition): boolean {
  return def.roles.some((r) => r.player);
}

export const PERSONAL_EVENTS = {
  /** Chance each year that something finds each player; a second thing is rarer. */
  chances: [0.85, 0.25] as readonly number[],
};

/** Whether `def` could happen to this player now. Per-player cooldown and occurrences; consumes no randomness. */
export function personalEligible(state: WorldState, def: EventDefinition, player: Player, me: Character): boolean {
  if (def.status !== "published" || !isPersonalEvent(def)) return false;
  const mem = player.personal?.[def.id];
  if (mem && state.tick - mem.last < Math.max(1, def.cooldown)) return false;
  if (mem && def.maxOccurrences !== null && mem.count >= def.maxOccurrences) return false;
  const home = state.settlements.find((s) => s.id === me.homeId && s.status === "active");
  if (!home) return false;
  const settlement = def.scope === "world" ? null : home;
  if (!evaluateAll(state, def.preconditions, { settlement }).passed) return false;
  const youRole = def.roles.find((r) => r.player)!;
  const anchorId = def.scope === "world" ? null : home.id;
  if (!candidatesForRole(state, youRole, anchorId, new Set()).some((c) => c.id === me.id)) return false;
  const others = def.roles.filter((r) => r !== youRole && !r.optional);
  return others.every((r) => candidatesForRole(state, r, anchorId, new Set([me.id])).length > 0);
}

/**
 * Every year, each player (in id order) may run into something personal:
 * one event picked from those that fit them, weighted by the event's chance.
 * Nobody gets more than two open decisions in a year.
 */
export function runPersonalPhase(
  state: WorldState,
  definitions: readonly EventDefinition[],
  rng: Rng,
): { state: WorldState; events: HistoricalEvent[]; rejections: EventRejection[] } {
  if (!state.personalEvents || !state.players) return { state, events: [], rejections: [] };
  let current = state;
  const events: HistoricalEvent[] = [];
  const rejections: EventRejection[] = [];
  const personal = definitions.filter(isPersonalEvent).sort((a, b) => (a.id < b.id ? -1 : 1));
  const playerIds = Object.keys(state.players).sort();
  for (const pid of playerIds) {
    for (const chance of PERSONAL_EVENTS.chances) {
      const player = current.players![pid]!;
      if (player.status !== "active" || !player.characterId || (player.prologue?.length ?? 0) < 3) break;
      const me = getCharacter(current, player.characterId);
      if (!me || me.deathTick !== null) break;
      // Never more than two open decisions at once (world events this year count too).
      if ((current.pendingDecisions ?? []).filter((p) => p.participants.includes(me.id)).length >= 2) break;
      const roll = rng.next();
      if (roll >= chance) break;
      const pool = personal.filter((d) => personalEligible(current, d, player, me));
      if (pool.length === 0) break;
      const def = rng.weighted(pool, (d) => Math.max(0.01, d.chance));
      const youRole = def.roles.find((r) => r.player)!;
      try {
        const result = executeEvent(current, def, def.scope === "world" ? null : me.homeId, rng, {
          chance,
          roll,
          forcedRoles: { [youRole.id]: me.id },
        });
        current = result.state;
        events.push(...result.events);
        const p = current.players![pid]!;
        const prev = p.personal?.[def.id];
        p.personal = { ...p.personal, [def.id]: { last: current.tick, count: (prev?.count ?? 0) + 1 } };
      } catch (err) {
        if (err instanceof EffectError) rejections.push({ definitionId: def.id, reason: err.message });
        else throw err;
        break;
      }
    }
  }
  return { state: current, events, rejections };
}
