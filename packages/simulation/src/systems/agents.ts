import { LOCATION_BY_ID, PLAYER_ACTION_TYPES, POLICY_INFO, PlayerActionSchema, TECH_BY_ID, type PlayerAction, type ResourceId } from "@genesis/schemas";
import { activeSettlements, characterAge, fullName, getSettlement, newRecorder, population, professionName, residents, resourceName, round2, say, spendResources } from "@genesis/narrative";
import type { TickContext } from "../context";
import { attemptExploration, researchable } from "./progress";
import { foundSettlement, foundingBlocker } from "./settlements";
import { applyPlayerAction, validatePlayerAction, type IndividualAction } from "./players";
import { enableAttributes } from "./attributes";

const INDIVIDUAL = new Set<string>(PLAYER_ACTION_TYPES);
function isIndividual(a: PlayerAction): a is IndividualAction {
  return INDIVIDUAL.has(a.type);
}

/** Validate a developer/player action against the current state. Returns a reason when invalid. */
export function validateAction(ctx: TickContext, raw: unknown): string | null {
  const parsed = PlayerActionSchema.safeParse(raw);
  if (!parsed.success) return `Malformed action: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
  const a = parsed.data;
  if (isIndividual(a)) return validatePlayerAction(ctx, a);
  const st = ctx.state;
  switch (a.type) {
    case "SET_POLICY":
      return null;
    case "ENABLE_ATTRIBUTES":
      return st.attributesEnabled ? "This world already has attributes" : null;
    case "SET_RESEARCH_FOCUS": {
      if (a.tech === null) return null;
      const t = TECH_BY_ID[a.tech];
      if (!t) return `Unknown technology ${a.tech}`;
      if (st.technologies.includes(a.tech)) return `${t.name} is already known`;
      if (!t.prerequisites.every((p) => st.technologies.includes(p))) return `${t.name} prerequisites are not met`;
      return null;
    }
    case "FOUND_SETTLEMENT": {
      const from = getSettlement(st, a.fromSettlementId);
      if (!from) return `Unknown settlement ${a.fromSettlementId}`;
      return foundingBlocker(ctx, a.locationId, from, a.settlers);
    }
    case "LAUNCH_EXPEDITION": {
      const s = getSettlement(st, a.settlementId);
      if (!s || s.status !== "active") return "Settlement is not active";
      if (!residents(st, s.id).some((c) => c.profession === "Scout" && characterAge(st, c) >= 16)) return `${s.name} has no scouts`;
      if (s.resources.food < 10 || s.resources.materials < 10) return `${s.name} needs 10 food and 10 materials to supply an expedition`;
      return null;
    }
    case "ASSIGN_PROFESSION": {
      const c = st.characters.find((x) => x.id === a.characterId);
      if (!c) return "Unknown character";
      if (c.deathTick !== null) return `${fullName(c)} is dead and cannot act`;
      if (characterAge(st, c) < 16) return `${fullName(c)} is too young`;
      return null;
    }
    case "TRANSFER_RESOURCES": {
      const from = getSettlement(st, a.fromSettlementId);
      const to = getSettlement(st, a.toSettlementId);
      if (!from || !to || from.status !== "active" || to.status !== "active") return "Both settlements must be active";
      if (from.id === to.id) return "Choose two different settlements";
      if (from.resources[a.resource] < a.amount) return `${from.name} has only ${round2(from.resources[a.resource])} ${a.resource}`;
      return null;
    }
  }
}

function directive(ctx: TickContext, title: string, text: string, settlementIds: string[] = [], changes = newRecorder().changes) {
  return ctx.system({
    category: "governance",
    importance: "notable",
    title,
    text,
    settlementIds,
    changes,
    summary: "Developer action submitted through Genesis Studio (logged for replay)",
  });
}

/** Apply a validated action. Caller must call validateAction first. */
export function applyAction(ctx: TickContext, a: PlayerAction): void {
  if (isIndividual(a)) return applyPlayerAction(ctx, a);
  const st = ctx.state;
  switch (a.type) {
    case "SET_POLICY": {
      const before = st.policy;
      st.policy = a.policy;
      directive(ctx, `Council adopts the ${POLICY_INFO[a.policy].name}`, POLICY_INFO[a.policy].description, [], [{ path: "policy", label: "Policy", before, after: a.policy }]);
      return;
    }
    case "SET_RESEARCH_FOCUS": {
      const before = st.researchFocus;
      st.researchFocus = a.tech;
      directive(ctx, a.tech ? `Research focus: ${TECH_BY_ID[a.tech]!.name}` : "Research focus cleared", "The archivists redirect their work.", [], [{ path: "researchFocus", label: "Research focus", before, after: a.tech }]);
      return;
    }
    case "FOUND_SETTLEMENT": {
      const from = getSettlement(st, a.fromSettlementId)!;
      foundSettlement(ctx, a.locationId, from, a.settlers, "Founding ordered by developer action");
      return;
    }
    case "ENABLE_ATTRIBUTES":
      enableAttributes(ctx);
      directive(ctx, "Attributes enabled", "Every living person now has health, social, knowledge and survival.");
      return;
    case "LAUNCH_EXPEDITION": {
      const s = getSettlement(st, a.settlementId)!;
      const rec = newRecorder();
      spendResources(s, { food: 10, materials: 10 }, rec);
      const found = attemptExploration(ctx, s, 0.45, "Supplied expedition ordered by developer action");
      if (!found) {
        directive(ctx, `Expedition from ${s.name} returns empty-handed`, "The scouts found nothing new beyond the known ruins.", [s.id], rec.changes);
      }
      return;
    }
    case "ASSIGN_PROFESSION": {
      const c = st.characters.find((x) => x.id === a.characterId)!;
      const before = c.profession;
      c.profession = a.profession;
      c.lifeEvents.push({ tick: st.tick, text: say(st).reassigned(professionName(st, a.profession)), historyId: null });
      directive(ctx, `${fullName(c)} becomes a ${a.profession}`, `${fullName(c)} leaves work as a ${before ?? "youth"}.`, [c.homeId], [{ path: `characters.${c.id}.profession`, label: `${fullName(c)} profession`, before, after: a.profession }]);
      return;
    }
    case "TRANSFER_RESOURCES": {
      const from = getSettlement(st, a.fromSettlementId)!;
      const to = getSettlement(st, a.toSettlementId)!;
      const rec = newRecorder();
      spendResources(from, { [a.resource]: a.amount }, rec);
      const before = to.resources[a.resource];
      to.resources[a.resource] = round2(before + a.amount);
      rec.changes.push({ path: `settlements.${to.id}.resources.${a.resource}`, label: `${to.name} ${a.resource}`, before, after: to.resources[a.resource] });
      directive(ctx, `Caravan: ${a.amount} ${a.resource} from ${from.name} to ${to.name}`, "Supplies are hauled across the wastes.", [from.id, to.id], rec.changes);
      return;
    }
  }
}

/**
 * The simulated council (non-LLM agent). Deterministic given state + RNG.
 * Decides on founding new settlements and emergency caravans.
 */
export function councilDecisions(ctx: TickContext): void {
  const st = ctx.state;
  const policy = POLICY_INFO[st.policy];

  // 1. Expansion: relieve crowded settlements by founding on a known site.
  // Pioneering worlds: the first surface settlement does not wait for the bunker to fill up.
  const pioneers = !!st.pioneering && st.tick >= 3 && !activeSettlements(st).some((x) => x.kind === "settlement");
  for (const s of activeSettlements(st)) {
    const pop = population(st, s.id);
    if (pop < s.capacity * policy.foundingPressure && !pioneers) continue;
    const sites = st.locations
      .filter((l) => l.discovered && !l.settlementId && LOCATION_BY_ID[l.id]!.settleable)
      .sort((a, b) => LOCATION_BY_ID[a.id]!.distance - LOCATION_BY_ID[b.id]!.distance || (a.id < b.id ? -1 : 1));
    const site = sites[0];
    if (!site) break;
    const settlers = Math.min(14, Math.max(6, Math.floor(pop * 0.35)));
    if (foundingBlocker(ctx, site.id, s, settlers) !== null || s.resources.food < 25) continue;
    foundSettlement(ctx, site.id, s, settlers, pioneers
      ? `No one lives on the surface yet; ${s.name} sends its first settlers`
      : `${s.name} reached ${Math.round((pop / s.capacity) * 100)}% of capacity (policy threshold ${Math.round(policy.foundingPressure * 100)}%)`);
    break; // at most one founding per tick
  }

  // 2. Emergency caravans: move food/water from the best-stocked settlement to one in shortage.
  const active = activeSettlements(st);
  for (const needy of active) {
    for (const r of ["food", "water"] as ResourceId[]) {
      if (r !== "food" && r !== "water") continue;
      if (needy.shortage[r] === 0) continue;
      const donor = active
        .filter((d) => d.id !== needy.id && d.shortage[r] === 0)
        .sort((a, b) => b.resources[r] / Math.max(1, population(st, b.id)) - a.resources[r] / Math.max(1, population(st, a.id)))[0];
      if (!donor) continue;
      const surplus = donor.resources[r] - population(st, donor.id) * 1.5;
      if (surplus < 5) continue;
      const amount = round2(Math.min(surplus * 0.5, population(st, needy.id) * 1.5));
      const rec = newRecorder();
      spendResources(donor, { [r]: amount }, rec);
      const before = needy.resources[r];
      needy.resources[r] = round2(before + amount);
      rec.changes.push({ path: `settlements.${needy.id}.resources.${r}`, label: `${needy.name} ${r}`, before, after: needy.resources[r] });
      ctx.system({
        category: "resource",
        importance: "minor",
        title: say(st).reliefTitle(amount, resourceName(st, r), needy.name),
        text: say(st).reliefText(donor.name, amount, resourceName(st, r), needy.name),
        settlementIds: [donor.id, needy.id],
        causeIds: needy.shortageOrigin[r] ? [needy.shortageOrigin[r]!] : [],
        changes: rec.changes,
        summary: "Council rule: share surplus with a settlement in shortage",
      });
    }
  }

  // 3. Clear an obsolete research focus.
  if (st.researchFocus) {
    const t = TECH_BY_ID[st.researchFocus];
    if (!t || st.technologies.includes(t.id)) st.researchFocus = null;
    else if (!researchable(ctx, t) && !t.prerequisites.every((p) => st.technologies.includes(p))) st.researchFocus = null;
  }
}
