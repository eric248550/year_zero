import {
  LOCATION_BY_ID,
  SECRET_BY_ID,
  TECH_BY_ID,
  type ComparisonOp,
  type Condition,
  type ConditionTrace,
  type Settlement,
  type WorldState,
} from "@genesis/schemas";
import { activeSettlements, population, rivalOf, round2, tensionBetween, totalResource } from "./queries";

export function compare(actual: number, op: ComparisonOp, expected: number): boolean {
  switch (op) {
    case "<": return actual < expected;
    case "<=": return actual <= expected;
    case ">": return actual > expected;
    case ">=": return actual >= expected;
    case "==": return actual === expected;
    case "!=": return actual !== expected;
  }
}

/** Human-readable description of a condition, used in traces and the Studio. */
export function describeCondition(c: Condition): string {
  switch (c.type) {
    case "resource":
      return `${c.scope === "world" ? "World" : "Settlement"} ${c.resource}${c.perCapita ? " per capita" : ""} ${c.op} ${c.value}`;
    case "population":
      return `${c.scope === "world" ? "World" : "Settlement"} population ${c.op} ${c.value}`;
    case "technology":
      return `${c.has ? "Has" : "Lacks"} technology ${TECH_BY_ID[c.tech]?.name ?? c.tech}`;
    case "flag":
      return c.present
        ? `Flag "${c.flag}" is set${c.equals !== undefined ? ` to ${String(c.equals)}` : ""}`
        : `Flag "${c.flag}" is not set`;
    case "secret":
      return `Secret "${SECRET_BY_ID[c.secret]?.title ?? c.secret}" is ${c.revealed ? "revealed" : "still hidden"}`;
    case "settlement_stat":
      return `Settlement ${c.stat} ${c.op} ${c.value}`;
    case "settlement_kind":
      return `Settlement is a ${c.kind}`;
    case "world_tick":
      return `World tick ${c.op} ${c.value}`;
    case "location":
      return `${LOCATION_BY_ID[c.location]?.name ?? c.location} is ${c.discovered ? "discovered" : "undiscovered"}`;
    case "settlement_count":
      return `Active settlements ${c.op} ${c.value}`;
    case "event_occurred":
      return `Event "${c.event}" has ${c.occurred ? "" : "not "}occurred${c.withinTicks ? ` within ${c.withinTicks} ticks` : ""}`;
    case "shortage":
      return `Settlement ${c.resource} shortage is ${c.active ? "active" : "not active"}`;
    case "tension":
      return `Tension with rival settlement ${c.op} ${c.value}`;
    case "project":
      return `A project for ${TECH_BY_ID[c.tech]?.name ?? c.tech} is ${c.active ? "under way" : "not under way"}`;
    case "settlement_age":
      return `Settlement founded ${c.op} ${c.value} years ago`;
  }
}

export interface EvalContext {
  settlement: Settlement | null;
}

/**
 * Evaluate a condition against world state. Settlement-scoped conditions fail
 * (rather than throw) when no target settlement exists.
 */
export function evaluateCondition(state: WorldState, c: Condition, ctx: EvalContext): ConditionTrace {
  const description = describeCondition(c);
  const result = (actual: number | string | boolean | null, passed: boolean): ConditionTrace => ({
    description,
    actual: typeof actual === "number" ? round2(actual) : actual,
    passed,
  });
  const s = ctx.settlement;

  switch (c.type) {
    case "resource": {
      if (c.scope === "target" && !s) return result(null, false);
      const stock = c.scope === "world" || !s ? totalResource(state, c.resource) : s.resources[c.resource];
      const pop = c.scope === "world" || !s ? population(state) : population(state, s.id);
      const actual = c.perCapita ? (pop > 0 ? stock / pop : 0) : stock;
      return result(actual, compare(actual, c.op, c.value));
    }
    case "population": {
      if (c.scope === "target" && !s) return result(null, false);
      const actual = c.scope === "world" || !s ? population(state) : population(state, s.id);
      return result(actual, compare(actual, c.op, c.value));
    }
    case "technology": {
      const has = state.technologies.includes(c.tech);
      return result(has, has === c.has);
    }
    case "flag": {
      const value = state.flags[c.flag];
      const present = value !== undefined;
      if (!c.present) return result(present ? value : null, !present);
      if (!present) return result(null, false);
      return result(value, c.equals === undefined || value === c.equals);
    }
    case "secret": {
      const revealed = state.secrets[c.secret] !== undefined;
      return result(revealed, revealed === c.revealed);
    }
    case "settlement_stat": {
      if (!s) return result(null, false);
      return result(s[c.stat], compare(s[c.stat], c.op, c.value));
    }
    case "settlement_kind": {
      if (!s) return result(null, false);
      return result(s.kind, s.kind === c.kind);
    }
    case "world_tick":
      return result(state.tick, compare(state.tick, c.op, c.value));
    case "location": {
      const loc = state.locations.find((l) => l.id === c.location);
      const discovered = loc?.discovered ?? false;
      return result(discovered, discovered === c.discovered);
    }
    case "settlement_count": {
      const n = activeSettlements(state).length;
      return result(n, compare(n, c.op, c.value));
    }
    case "event_occurred": {
      const last = state.eventMemory.lastFiredTick[c.event];
      const occurred = last !== undefined && (c.withinTicks === undefined || state.tick - last <= c.withinTicks);
      return result(last ?? null, occurred === c.occurred);
    }
    case "shortage": {
      if (!s) return result(null, false);
      const active = s.shortage[c.resource] > 0;
      return result(s.shortage[c.resource], active === c.active);
    }
    case "tension": {
      const rival = s ? rivalOf(state, s) : null;
      if (!s || !rival) return result(null, false);
      const t = tensionBetween(state, s.id, rival.id);
      return result(t, compare(t, c.op, c.value));
    }
    case "project": {
      const active = (state.projects ?? []).some((p) => p.techId === c.tech);
      return result(active, active === c.active);
    }
    case "settlement_age": {
      if (!s) return result(null, false);
      const age = state.tick - s.foundedTick;
      return result(age, compare(age, c.op, c.value));
    }
  }
}

export function evaluateAll(state: WorldState, conditions: readonly Condition[], ctx: EvalContext) {
  const traces = conditions.map((c) => evaluateCondition(state, c, ctx));
  return { passed: traces.every((t) => t.passed), traces };
}

/** History ids that "caused" a set of satisfied conditions (provenance). */
export function causesFor(state: WorldState, conditions: readonly Condition[], settlement: Settlement | null): string[] {
  const causes = new Set<string>();
  for (const c of conditions) {
    if (c.type === "flag" && c.present) {
      const origin = state.flagOrigins[c.flag];
      if (origin) causes.add(origin);
    } else if (c.type === "event_occurred" && c.occurred) {
      const origin = state.eventMemory.lastHistoryId[c.event];
      if (origin) causes.add(origin);
    } else if (c.type === "secret" && c.revealed) {
      const origin = state.secrets[c.secret]?.historyId;
      if (origin) causes.add(origin);
    } else if (c.type === "shortage" && c.active && settlement) {
      const origin = settlement.shortageOrigin[c.resource];
      if (origin) causes.add(origin);
    }
  }
  return [...causes];
}
