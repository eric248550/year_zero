import {
  EFFECT_TYPES,
  EventDefinitionSchema,
  EXCLUSIVE_FLAGS,
  LOCATION_BY_ID,
  RESERVED_FLAG_PREFIXES,
  SECRET_BY_ID,
  StorylineSchema,
  TECH_BY_ID,
  type Condition,
  type Effect,
  type EventDefinition,
  type Storyline,
} from "@genesis/schemas";
import { templatePlaceholders } from "./template";

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  value: T | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationContext {
  knownEventIds: ReadonlySet<string>;
  knownStorylineIds: ReadonlySet<string>;
}

const EMPTY_CTX: ValidationContext = { knownEventIds: new Set(), knownStorylineIds: new Set() };

function zodIssues(error: { issues: { path: PropertyKey[]; message: string; code: string }[] }): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join(".") || "(root)", message: i.message, code: `schema.${i.code}` }));
}

/** Pre-parse check giving a clearer message for unsupported effect types (common in AI output). */
function findUnsupportedEffects(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = new Set<string>(EFFECT_TYPES);
  const visit = (effects: unknown, path: string) => {
    if (!Array.isArray(effects)) return;
    effects.forEach((e, i) => {
      const type = (e as { type?: unknown } | null)?.type;
      if (typeof type !== "string" || !allowed.has(type)) {
        issues.push({ path: `${path}.${i}.type`, code: "effect.unsupported", message: `Unsupported effect type "${String(type)}". Allowed: ${EFFECT_TYPES.join(", ")}` });
      }
    });
  };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    visit(r.effects, "effects");
    if (Array.isArray(r.choices)) {
      r.choices.forEach((c, i) => {
        const choice = c as Record<string, unknown> | null;
        visit(choice?.effects, `choices.${i}.effects`);
        visit((choice?.risk as Record<string, unknown> | undefined)?.effects, `choices.${i}.risk.effects`);
      });
    }
  }
  return issues;
}

type Interval = { lo: number; loInc: boolean; hi: number; hiInc: boolean };

function narrow(iv: Interval, op: Condition extends never ? never : string, v: number): Interval {
  const n = { ...iv };
  const setLo = (val: number, inc: boolean) => {
    if (val > n.lo || (val === n.lo && !inc)) { n.lo = val; n.loInc = inc; }
  };
  const setHi = (val: number, inc: boolean) => {
    if (val < n.hi || (val === n.hi && !inc)) { n.hi = val; n.hiInc = inc; }
  };
  switch (op) {
    case "<": setHi(v, false); break;
    case "<=": setHi(v, true); break;
    case ">": setLo(v, false); break;
    case ">=": setLo(v, true); break;
    case "==": setLo(v, true); setHi(v, true); break;
  }
  return n;
}

function isEmpty(iv: Interval): boolean {
  if (iv.lo > iv.hi) return true;
  if (iv.lo === iv.hi && !(iv.loInc && iv.hiInc)) return true;
  return false;
}

/** Detect preconditions that can never be simultaneously true. */
function checkSatisfiability(conds: readonly Condition[], basePath: string, scope: string, errors: ValidationIssue[]) {
  const numeric = new Map<string, { iv: Interval; label: string }>();
  const bool = new Map<string, boolean>();

  conds.forEach((c, i) => {
    const path = `${basePath}.${i}`;
    let key: string | null = null;
    let label = "";
    let domain: Interval = { lo: -Infinity, loInc: false, hi: Infinity, hiInc: false };
    switch (c.type) {
      case "resource":
        key = `resource:${c.scope}:${c.resource}:${c.perCapita}`; label = `${c.resource}${c.perCapita ? " per capita" : ""}`;
        domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "population":
        key = `population:${c.scope}`; label = "population";
        domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "settlement_stat":
        key = `stat:${c.stat}`; label = c.stat;
        domain = c.stat === "morale" || c.stat === "health"
          ? { lo: 0, loInc: true, hi: 100, hiInc: true }
          : c.stat === "level" ? { lo: 1, loInc: true, hi: 5, hiInc: true } : { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "world_tick":
        key = "tick"; label = "world tick"; domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "settlement_count":
        key = "settlement_count"; label = "settlement count"; domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "technology": {
        const k = `tech:${c.tech}`;
        if (bool.has(k) && bool.get(k) !== c.has) errors.push({ path, code: "precondition.contradiction", message: `Technology ${c.tech} is required to be both present and absent` });
        bool.set(k, c.has);
        break;
      }
      case "flag": {
        const k = `flag:${c.flag}`;
        if (bool.has(k) && bool.get(k) !== c.present) errors.push({ path, code: "precondition.contradiction", message: `Flag ${c.flag} is required to be both set and unset` });
        bool.set(k, c.present);
        break;
      }
      case "secret": {
        const k = `secret:${c.secret}`;
        if (bool.has(k) && bool.get(k) !== c.revealed) errors.push({ path, code: "precondition.contradiction", message: `Secret ${c.secret} is required to be both revealed and hidden` });
        bool.set(k, c.revealed);
        break;
      }
      case "location": {
        const k = `location:${c.location}`;
        if (bool.has(k) && bool.get(k) !== c.discovered) errors.push({ path, code: "precondition.contradiction", message: `Location ${c.location} is required to be both discovered and undiscovered` });
        bool.set(k, c.discovered);
        break;
      }
      case "settlement_kind": {
        const k = "kind";
        const v = c.kind === "bunker";
        if (bool.has(k) && bool.get(k) !== v) errors.push({ path, code: "precondition.contradiction", message: "Settlement cannot be both a bunker and a surface settlement" });
        bool.set(k, v);
        break;
      }
      case "shortage": {
        const k = `shortage:${c.resource}`;
        if (bool.has(k) && bool.get(k) !== c.active) errors.push({ path, code: "precondition.contradiction", message: `${c.resource} shortage is required to be both active and inactive` });
        bool.set(k, c.active);
        break;
      }
      case "settlement_age":
        key = "settlement_age"; label = "settlement age"; domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "tension":
        key = "tension"; label = "tension"; domain = { lo: 0, loInc: true, hi: 100, hiInc: true };
        break;
      case "facility": { const k = `facility:${c.facility}`; if (bool.has(k) && bool.get(k) !== c.working) errors.push({ path, code: "precondition.contradiction", message: `${c.facility} must be both working and not` }); bool.set(k, c.working); break; }
      case "law": { const k = `law:${c.law}`; if (bool.has(k) && bool.get(k) !== c.active) errors.push({ path, code: "precondition.contradiction", message: `Law ${c.law} must be both in force and not` }); bool.set(k, c.active); break; }
      case "site_claimed": { const k = `claim:${c.location}`; if (bool.has(k) && bool.get(k) !== c.claimed) errors.push({ path, code: "precondition.contradiction", message: `${c.location} must be both claimed and not` }); bool.set(k, c.claimed); break; }
      case "flag_any":
      case "worn":
        break;
      case "salvage": case "seeds": case "harvests": case "power":
        key = c.type; label = c.type; domain = c.type === "power" ? { lo: 0, loInc: true, hi: 1, hiInc: true } : { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "farmable": { const k = "farmable"; if (bool.has(k) && bool.get(k) !== c.present) errors.push({ path, code: "precondition.contradiction", message: "Land must be both farmable and not" }); bool.set(k, c.present); break; }
      case "children":
        key = "children"; label = "children"; domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "site_feature": { const k = `feature:${c.feature}`; if (bool.has(k) && bool.get(k) !== c.present) errors.push({ path, code: "precondition.contradiction", message: `Land must both have and lack ${c.feature}` }); bool.set(k, c.present); break; }
      case "claims":
        key = "claims"; label = "claims"; domain = { lo: 0, loInc: true, hi: Infinity, hiInc: false };
        break;
      case "project": {
        const k = `project:${c.tech}`;
        if (bool.has(k) && bool.get(k) !== c.active) errors.push({ path, code: "precondition.contradiction", message: `A project for ${c.tech} is required to be both active and inactive` });
        bool.set(k, c.active);
        break;
      }
      case "event_occurred":
        break;
    }
    if (key && "op" in c && c.op !== "!=") {
      const prev = numeric.get(key)?.iv ?? domain;
      const next = narrow(prev, c.op, c.value);
      if (isEmpty(next)) {
        errors.push({ path, code: "precondition.impossible", message: `Condition on ${label} (${c.op} ${c.value}) can never be satisfied together with the other constraints / valid range` });
      }
      numeric.set(key, { iv: next, label });
    }
  });

  // A tech cannot be present while one of its prerequisites is absent.
  for (const [k, has] of bool) {
    if (!k.startsWith("tech:") || !has) continue;
    const tech = TECH_BY_ID[k.slice(5)];
    for (const pre of tech?.prerequisites ?? []) {
      if (bool.get(`tech:${pre}`) === false) {
        errors.push({ path: basePath, code: "precondition.impossible", message: `Requires ${tech!.id} but forbids its prerequisite ${pre}` });
      }
    }
  }

  if (scope === "world") {
    conds.forEach((c, i) => {
      const settlementOnly = c.type === "settlement_stat" || c.type === "settlement_kind" || c.type === "shortage" || c.type === "tension" || c.type === "settlement_age" || c.type === "facility" || c.type === "law" || c.type === "claims" || c.type === "children" || c.type === "site_feature" || c.type === "farmable" || c.type === "worn" || c.type === "salvage" || c.type === "seeds" || c.type === "harvests" || c.type === "power"
        || ((c.type === "resource" || c.type === "population") && c.scope === "target");
      if (settlementOnly) {
        errors.push({ path: `${basePath}.${i}`, code: "scope.mismatch", message: `World-scoped events have no target settlement; use scope "world" on this condition or change the event scope` });
      }
    });
  }
}

function checkConditionRefs(conds: readonly Condition[], basePath: string, ctx: ValidationContext, selfId: string, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  conds.forEach((c, i) => {
    const path = `${basePath}.${i}`;
    if (c.type === "site_claimed" && !LOCATION_BY_ID[c.location]) errors.push({ path, code: "ref.location", message: `Unknown location "${c.location}"` });
    if (c.type === "project" && c.tech !== "any" && !TECH_BY_ID[c.tech]) errors.push({ path, code: "ref.technology", message: `Unknown technology "${c.tech}"` });
    if (c.type === "technology" && !TECH_BY_ID[c.tech]) errors.push({ path, code: "ref.technology", message: `Unknown technology "${c.tech}"` });
    if (c.type === "location" && !LOCATION_BY_ID[c.location]) errors.push({ path, code: "ref.location", message: `Unknown location "${c.location}"` });
    if (c.type === "secret" && !SECRET_BY_ID[c.secret]) errors.push({ path, code: "ref.secret", message: `Unknown secret "${c.secret}"` });
    if (c.type === "event_occurred" && c.event !== selfId && !ctx.knownEventIds.has(c.event)) {
      warnings.push({ path, code: "ref.event", message: `Event "${c.event}" is not a known event definition` });
    }
    if (c.type === "flag" && c.flag.startsWith("secret.")) {
      warnings.push({ path, code: "flag.secret", message: `Use a "secret" condition instead of a flag in the secret.* namespace` });
    }
  });
}

function checkEffects(def: EventDefinition, effects: readonly Effect[], basePath: string, errors: ValidationIssue[], warnings: ValidationIssue[], extraRoles: readonly string[] = []) {
  const roleIds = new Set([...def.roles.map((r) => r.id), ...extraRoles]);
  const guaranteedTech = new Set(def.preconditions.filter((c) => c.type === "technology" && c.has).map((c) => (c as { tech: string }).tech));
  effects.forEach((e, i) => {
    const path = `${basePath}.${i}`;
    switch (e.type) {
      case "ADJUST_RESOURCE":
      case "CHANGE_SETTLEMENT_STAT":
        if (def.scope === "world" && e.target === "settlement") {
          errors.push({ path, code: "scope.mismatch", message: `World-scoped events must use target "all_settlements"` });
        }
        if (e.type === "ADJUST_RESOURCE" && Math.abs(e.amount) > 200) {
          warnings.push({ path, code: "balance.large", message: `Large resource swing (${e.amount}) may destabilise the simulation` });
        }
        break;
      case "CHANGE_RELATIONSHIP":
        if (!roleIds.has(e.a)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.a}"` });
        if (!roleIds.has(e.b)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.b}"` });
        if (e.a === e.b) errors.push({ path, code: "effect.invalid", message: "Relationship roles must be different" });
        break;
      case "ADD_LIFE_EVENT":
        if (!roleIds.has(e.role)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.role}"` });
        break;
      case "ADJUST_ATTRIBUTE":
        if (!roleIds.has(e.role)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.role}"` });
        break;
      case "CHANGE_PROJECT":
        if ((e.role === undefined) === (e.tech === undefined)) errors.push({ path, code: "effect.invalid", message: "CHANGE_PROJECT needs exactly one of role or tech" });
        if (e.role !== undefined && !roleIds.has(e.role)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.role}"` });
        if (e.tech !== undefined && !TECH_BY_ID[e.tech]) errors.push({ path, code: "ref.technology", message: `Unknown technology "${e.tech}"` });
        if (e.progress === undefined && e.approach === undefined) errors.push({ path, code: "effect.invalid", message: "CHANGE_PROJECT changes nothing" });
        break;
      case "ADD_SPECIALTY":
      case "PRACTICE":
        if (!roleIds.has(e.role)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.role}"` });
        break;
      case "CLAIM_SITE":
        if (e.location === "nearest") break;
        if (!LOCATION_BY_ID[e.location]) errors.push({ path, code: "ref.location", message: `Unknown location "${e.location}"` });
        else if (LOCATION_BY_ID[e.location]!.hidden || e.location === "haven_deep") errors.push({ path, code: "effect.invalid", message: `${e.location} cannot be claimed` });
        if (def.scope === "world") errors.push({ path, code: "scope.mismatch", message: "Claims need a target settlement" });
        break;
      case "PROPOSE": {
        const inner = e.effects as Effect[];
        if (inner.some((x) => x.type === "PROPOSE" || x.type === "RESOLVE_PROPOSAL")) errors.push({ path, code: "effect.invalid", message: "A proposal cannot contain another proposal" });
        if (e.kind === "domain" && !e.domain) errors.push({ path, code: "effect.invalid", message: "A domain proposal needs the domain (profession) that decides it" });
        if (def.scope === "world") errors.push({ path, code: "scope.mismatch", message: "Proposals belong to a settlement" });
        checkEffects(def, inner, `${path}.effects`, errors, warnings, extraRoles);
        break;
      }
      case "RESOLVE_PROPOSAL":
        if (!def.tags.includes("proposal")) errors.push({ path, code: "effect.invalid", message: "Only the proposal vote can resolve proposals" });
        break;
      case "SPEND":
        if (def.scope === "world") errors.push({ path, code: "scope.mismatch", message: "Spending needs a target settlement" });
        break;
      case "AFTER": {
        for (const r of e.away ?? []) if (!roleIds.has(r)) errors.push({ path, code: "ref.role", message: `Unknown role "${r}"` });
        const inner = [...e.effects, ...(e.risk?.effects ?? [])] as Effect[];
        if (inner.some((x) => x.type === "AFTER" || x.type === "SCHEDULE_EVENT")) errors.push({ path, code: "effect.invalid", message: "An AFTER outcome cannot schedule more follow-ups" });
        checkEffects(def, inner, `${path}.effects`, errors, warnings, extraRoles);
        break;
      }
      case "SCHEDULE_EVENT":
        for (const r of e.away ?? []) if (!roleIds.has(r)) errors.push({ path, code: "ref.role", message: `Unknown role "${r}"` });
        if (e.event === def.id) errors.push({ path, code: "effect.invalid", message: "An event cannot schedule itself" });
        break;
      case "ADD_SEEDS":
      case "CHANGE_FERTILITY":
      case "SET_FARM_PLAN":
      case "CHANGE_CROPS":
        if (def.scope === "world") errors.push({ path, code: "scope.mismatch", message: "Farm effects need a target settlement" });
        break;
      case "PRIORITIZE_BRANCH":
        break;
      case "BUILD_FACILITY":
      case "CHANGE_FACILITY":
      case "ENACT_LAW":
      case "REPEAL_LAW":
      case "CEDE_CLAIM":
      case "EXCHANGE":
      case "CHANGE_TENSION":
        if (def.scope === "world") errors.push({ path, code: "scope.mismatch", message: "Tension needs a target settlement; world-scoped events cannot change it" });
        break;
      case "ADD_CARETAKER":
        if (!roleIds.has(e.caretaker)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.caretaker}"` });
        if (!roleIds.has(e.ward)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.ward}"` });
        break;
      case "CHARACTER_DEATH":
        if (!roleIds.has(e.role)) errors.push({ path, code: "ref.role", message: `Unknown role "${e.role}"` });
        warnings.push({ path, code: "effect.lethal", message: `This effect kills the character in role "${e.role}"` });
        break;
      case "DISCOVER_LOCATION":
        if (e.location !== "nearest" && !LOCATION_BY_ID[e.location]) errors.push({ path, code: "ref.location", message: `Unknown location "${e.location}"` });
        break;
      case "UNLOCK_TECHNOLOGY": {
        const tech = TECH_BY_ID[e.tech];
        if (!tech) {
          errors.push({ path, code: "ref.technology", message: `Unknown technology "${e.tech}"` });
          break;
        }
        const unguarded = tech.prerequisites.filter((p) => !guaranteedTech.has(p));
        if (unguarded.length > 0) {
          warnings.push({ path, code: "tech.prerequisites", message: `Preconditions do not guarantee prerequisites (${unguarded.join(", ")}); the event will be rejected at runtime if they are missing` });
        }
        break;
      }
      case "REVEAL_SECRET":
        if (!SECRET_BY_ID[e.secret]) errors.push({ path, code: "ref.secret", message: `Unknown secret "${e.secret}"` });
        break;
      case "ADD_WORLD_FLAG":
      case "REMOVE_WORLD_FLAG": {
        if (RESERVED_FLAG_PREFIXES.some((p) => e.flag.startsWith(p))) {
          errors.push({ path, code: "flag.reserved", message: `Flag "${e.flag}" is reserved. Secrets may only be revealed with REVEAL_SECRET` });
        }
        const group = e.type === "ADD_WORLD_FLAG" ? EXCLUSIVE_FLAGS.find((g) => g.includes(e.flag)) : undefined;
        if (group) warnings.push({ path, code: "flag.exclusive", message: `Setting ${e.flag} clears ${group.filter((f) => f !== e.flag).join(", ")}` });
        break;
      }
      case "CREATE_HISTORICAL_EVENT":
        break;
    }
  });
}

/**
 * Validate an event definition: structure (Zod) then rules (references,
 * scope, contradictions, unsupported operations). Pure; no side effects.
 */
export function validateEventDefinition(raw: unknown, ctx: ValidationContext = EMPTY_CTX): ValidationResult<EventDefinition> {
  const unsupported = findUnsupportedEffects(raw);
  const parsed = EventDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = [...unsupported, ...zodIssues(parsed.error).filter((i) => !unsupported.some((u) => i.path.startsWith(u.path.replace(/\.type$/, ""))))];
    return { valid: false, value: null, errors, warnings: [] };
  }
  const def = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Roles
  const roleIds = new Set<string>();
  def.roles.forEach((r, i) => {
    if (roleIds.has(r.id)) errors.push({ path: `roles.${i}.id`, code: "role.duplicate", message: `Duplicate role "${r.id}"` });
    roleIds.add(r.id);
    if (r.minAge !== undefined && r.maxAge !== undefined && r.minAge > r.maxAge) {
      errors.push({ path: `roles.${i}`, code: "role.impossible", message: `minAge ${r.minAge} > maxAge ${r.maxAge}` });
    }
    if (r.familiarWith !== undefined && !def.roles.slice(0, i).some((x) => x.id === r.familiarWith)) {
      errors.push({ path: `roles.${i}.familiarWith`, code: "ref.role", message: `familiarWith must name an earlier role ("${r.familiarWith}")` });
    }
    if (r.minAge !== undefined && r.minAge > 110) errors.push({ path: `roles.${i}.minAge`, code: "role.impossible", message: "No character lives that long" });
  });
  if (def.scope === "character" && !def.roles.some((r) => !r.optional)) {
    errors.push({ path: "roles", code: "scope.mismatch", message: "Character-scoped events need at least one required role" });
  }

  // Preconditions
  checkConditionRefs(def.preconditions, "preconditions", ctx, def.id, errors, warnings);
  checkSatisfiability(def.preconditions, "preconditions", def.scope, errors);
  for (const c of def.preconditions) {
    if (c.type === "event_occurred" && c.event === def.id && c.occurred && def.maxOccurrences === 1) {
      errors.push({ path: "preconditions", code: "precondition.impossible", message: "A one-shot event cannot require that it already occurred" });
    }
  }

  // Effects & choices
  checkEffects(def, def.effects, "effects", errors, warnings);
  const choiceIds = new Set<string>();
  def.choices.forEach((ch, i) => {
    if (choiceIds.has(ch.id)) errors.push({ path: `choices.${i}.id`, code: "choice.duplicate", message: `Duplicate choice "${ch.id}"` });
    choiceIds.add(ch.id);
    checkConditionRefs(ch.requires, `choices.${i}.requires`, ctx, def.id, errors, warnings);
    checkSatisfiability([...def.preconditions, ...ch.requires], `choices.${i}.requires`, def.scope, errors);
    ch.requiresRoles.forEach((r, j) => {
      if (!roleIds.has(r)) errors.push({ path: `choices.${i}.requiresRoles.${j}`, code: "ref.role", message: `Unknown role "${r}"` });
    });
    if (ch.costs && Object.values(ch.costs).some((v) => (v ?? 0) > 0) && def.scope === "world") {
      errors.push({ path: `choices.${i}.costs`, code: "scope.mismatch", message: "World-scoped events cannot charge a settlement for a choice" });
    }
    checkEffects(def, ch.effects, `choices.${i}.effects`, errors, warnings, ["actor"]);
    if (ch.memberEffects) checkEffects(def, ch.memberEffects, `choices.${i}.memberEffects`, errors, warnings, ["actor"]);
    if (ch.risk) checkEffects(def, ch.risk.effects, `choices.${i}.risk.effects`, errors, warnings, ["actor"]);
  });
  if (def.choices.length > 0 && def.choices.every((c) => (c.costs && Object.keys(c.costs).length > 0) || c.requires.length > 0 || c.requiresRoles.length > 0)) {
    warnings.push({ path: "choices", code: "choice.gated", message: "Every choice is gated by costs or requirements; the event may rarely be able to fire" });
  }

  // Storylines
  def.storylineIds.forEach((s, i) => {
    if (!ctx.knownStorylineIds.has(s)) errors.push({ path: `storylineIds.${i}`, code: "ref.storyline", message: `Unknown storyline "${s}"` });
  });

  // Templates
  def.roles.forEach((r, i) => {
    if (r.bondWith && !def.roles.some((o) => o.id === r.bondWith!.role && o !== r)) errors.push({ path: `roles.${i}.bondWith`, code: "ref.role", message: `Unknown role "${r.bondWith.role}"` });
  });

  // Shared goods are settled once per choice, never once per person who chose it.
  def.choices.forEach((c, i) => {
    for (const e of c.memberEffects ?? []) {
      const shared = (e.type === "ADJUST_RESOURCE" && e.amount > 0) || ["EXCHANGE", "BUILD_FACILITY", "ADD_SEEDS", "CLAIM_SITE", "ADD_WORLD_FLAG", "ENACT_LAW", "CHANGE_PROJECT", "PROPOSE", "SPEND"].includes(e.type);
      if (shared) errors.push({ path: `choices.${i}.memberEffects`, code: "effect.shared", message: `${e.type} changes shared state and would repeat for every member; put it in effects` });
    }
  });

  // Generated drafts tell stories; they do not get to rewrite the world's fixed facts.
  if (/^(ai|mock):/.test(def.source)) {
    const fixed = new Set(["UNLOCK_TECHNOLOGY", "REVEAL_SECRET", "SCHEDULE_EVENT", "CEDE_CLAIM", "CLAIM_SITE"]);
    const effects = [...def.effects, ...def.choices.flatMap((c) => [...c.effects, ...(c.memberEffects ?? []), ...(c.risk?.effects ?? [])])];
    effects.forEach((e) => {
      if (fixed.has(e.type)) errors.push({ path: "effects", code: "ai.restricted", message: `Generated events cannot use ${e.type}; technology, secrets, claims and follow-ups come from the simulation and hand-written content` });
      if (e.type === "ADJUST_RESOURCE" && Math.abs(e.amount) > 30) errors.push({ path: "effects", code: "ai.restricted", message: `Generated events cannot move more than 30 of a resource at once (${e.amount})` });
    });
    if (def.scheduledOnly) errors.push({ path: "scheduledOnly", code: "ai.restricted", message: "Generated events cannot be scheduled-only follow-ups" });
  }

  // Several people deciding for themselves must not be able to set rival outcomes at once.
  if ((def.participation ?? "roles") === "everyone" && def.resolution !== "vote") {
    const setters = def.choices.filter((c) => c.effects.some((e) => e.type === "ADD_WORLD_FLAG" || e.type === "REMOVE_WORLD_FLAG"));
    if (setters.length >= 2) {
      errors.push({ path: "resolution", code: "decision.conflict", message: `Choices ${setters.map((c) => c.id).join(", ")} change world flags and everyone decides; groups would all apply. Use "resolution": "vote" for a collective decision` });
    }
  }

  const allowedPlaceholders = new Set(["settlement", "rival", "project", "proposal", "year", "world", "choice", ...[...roleIds, "actor"].flatMap((r) => [r, `${r}.profession`])]);
  const templates: [string, string][] = [["narrative.headline", def.narrative.headline], ["narrative.text", def.narrative.text]];
  def.choices.forEach((c, i) => {
    if (c.outcome) templates.push([`choices.${i}.outcome`, c.outcome]);
    if (c.risk) templates.push([`choices.${i}.risk.description`, c.risk.description]);
  });
  for (const [path, tpl] of templates) {
    for (const ph of templatePlaceholders(tpl)) {
      if (!allowedPlaceholders.has(ph)) warnings.push({ path, code: "template.placeholder", message: `Unknown placeholder {{${ph}}} will be shown literally` });
    }
  }
  if (def.scope === "world" && templates.some(([, t]) => t.includes("{{settlement}}"))) {
    warnings.push({ path: "narrative", code: "template.placeholder", message: "{{settlement}} renders as 'the settlements' in world-scoped events" });
  }

  // Pacing
  if (def.cooldown === 0 && def.maxOccurrences === null) {
    warnings.push({ path: "cooldown", code: "pacing.spam", message: "No cooldown and unlimited occurrences: may fire every tick while eligible" });
  }
  if (def.effects.length === 0 && def.choices.every((c) => c.effects.length === 0 && !c.costs)) {
    warnings.push({ path: "effects", code: "effect.none", message: "Event has no state effects; it will only add a history entry" });
  }

  return { valid: errors.length === 0, value: def, errors, warnings };
}

export function validateStoryline(raw: unknown, ctx: ValidationContext = EMPTY_CTX): ValidationResult<Storyline> {
  const parsed = StorylineSchema.safeParse(raw);
  if (!parsed.success) return { valid: false, value: null, errors: zodIssues(parsed.error), warnings: [] };
  const warnings: ValidationIssue[] = [];
  parsed.data.beats.forEach((b, i) => {
    b.eventIds.forEach((e, j) => {
      if (!ctx.knownEventIds.has(e)) warnings.push({ path: `beats.${i}.eventIds.${j}`, code: "ref.event", message: `Event "${e}" is not defined` });
    });
  });
  return { valid: true, value: parsed.data, errors: [], warnings };
}

/** Flags the simulation itself reads or writes (outside content). */
export const ENGINE_FLAGS = new Set([
  "world.surface_open", "food.heirloom_seeds", "mystery.halcyon_archive", "mystery.vault12_opened", "society.truth_known",
  "society.surface_first", "society.bunker_first", "society.open_gates", "society.closed_gates",
  "governance.water_council", "governance.engineer_control", "society.founders_repudiated",
  // Read by the civilization line.
  "food.surface_farming", "culture.school", "trade.caravan", "governance.assembly", "power.first_light",
]);

function allEffects(d: EventDefinition): Effect[] {
  const top = [...d.effects, ...d.choices.flatMap((c) => [...c.effects, ...(c.memberEffects ?? []), ...(c.risk?.effects ?? [])])];
  // Look inside proposals and timed outcomes too (two levels: a proposal may hold a trip).
  const inner = (e: Effect): Effect[] => e.type === "AFTER" ? ([...e.effects, ...(e.risk?.effects ?? [])] as Effect[]) : e.type === "PROPOSE" ? (e.effects as Effect[]) : [];
  const level1 = top.flatMap(inner);
  return [...top, ...level1, ...level1.flatMap(inner)];
}
function allConditions(d: EventDefinition): Condition[] {
  return [...d.preconditions, ...d.choices.flatMap((c) => c.requires)];
}

/**
 * Checks across the whole content set that one definition alone cannot see:
 * follow-ups that do not exist or are not scheduled-only, scheduled-only
 * events nobody schedules (unreachable), conditions on flags nothing sets, and
 * flags that are set but never read.
 */
export function validateBundle(events: readonly EventDefinition[]): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const byId = new Map(events.map((e) => [e.id, e]));
  const scheduled = new Set<string>();
  const setFlags = new Set<string>();
  const readFlags = new Set<string>();
  for (const d of events) {
    for (const e of allEffects(d)) {
      if (e.type === "SCHEDULE_EVENT") {
        scheduled.add(e.event);
        const t = byId.get(e.event);
        if (!t) errors.push({ path: `${d.id}`, code: "ref.event", message: `${d.id} schedules unknown event "${e.event}"` });
        else if (!t.scheduledOnly) errors.push({ path: `${d.id}`, code: "schedule.target", message: `${d.id} schedules ${e.event}, which is not scheduledOnly and could also fire by chance` });
      }
      if (e.type === "ADD_WORLD_FLAG") setFlags.add(e.flag);
    }
    for (const c of allConditions(d)) {
      if (c.type === "flag") readFlags.add(c.flag);
      if (c.type === "flag_any") c.flags.forEach((f) => readFlags.add(f));
    }
  }
  for (const d of events) {
    if (d.scheduledOnly && !scheduled.has(d.id) && !d.tags.includes("proposal")) errors.push({ path: d.id, code: "event.unreachable", message: `${d.id} is scheduledOnly but nothing schedules it` });
    for (const c of allConditions(d)) {
      if (c.type === "flag" && c.present && !setFlags.has(c.flag) && !ENGINE_FLAGS.has(c.flag)) {
        errors.push({ path: d.id, code: "event.unreachable", message: `${d.id} needs flag ${c.flag}, which nothing sets` });
      }
    }
  }
  // One side of a rival pair counts as read when the other side is: it is what clears it.
  const read = (f: string) => readFlags.has(f) || ENGINE_FLAGS.has(f);
  for (const f of setFlags) {
    const group = EXCLUSIVE_FLAGS.find((g) => g.includes(f));
    if (!read(f) && !(group && group.some(read))) warnings.push({ path: f, code: "flag.unread", message: `Flag ${f} is set but nothing reads it` });
  }
  return { errors, warnings };
}
