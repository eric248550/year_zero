import { LOCATION_BY_ID, SECRET_BY_ID, TECH_BY_ID, type Effect } from "@genesis/schemas";

/** Human-readable summary of a typed effect (for the Studio and reviews). */
export function describeEffect(e: Effect): string {
  const where = (t: "settlement" | "all_settlements") => (t === "all_settlements" ? "every settlement" : "target settlement");
  switch (e.type) {
    case "ADJUST_RESOURCE": return `${e.amount >= 0 ? "+" : ""}${e.amount} ${e.resource} (${where(e.target)})`;
    case "CHANGE_SETTLEMENT_STAT": return `${e.delta >= 0 ? "+" : ""}${e.delta} ${e.stat} (${where(e.target)})`;
    case "CHANGE_RELATIONSHIP": return `Relationship ${e.a} ↔ ${e.b} ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "DISCOVER_LOCATION": return `Discover ${LOCATION_BY_ID[e.location]?.name ?? e.location}`;
    case "UNLOCK_TECHNOLOGY": return `Unlock ${TECH_BY_ID[e.tech]?.name ?? e.tech} (prerequisites enforced)`;
    case "ADD_WORLD_FLAG": return `Set flag ${e.flag} = ${String(e.value)}`;
    case "REMOVE_WORLD_FLAG": return `Remove flag ${e.flag}`;
    case "CREATE_HISTORICAL_EVENT": return `Append history: “${e.title}” (${e.importance})`;
    case "REVEAL_SECRET": return `Reveal secret: ${SECRET_BY_ID[e.secret]?.title ?? e.secret}`;
    case "ADD_LIFE_EVENT": return `Life event for ${e.role}: “${e.text}”`;
    case "CHARACTER_DEATH": return `${e.role} dies (${e.cause})`;
    case "ADJUST_ATTRIBUTE": return `${e.role} ${e.attribute} ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "ADD_CARETAKER": return `${e.caretaker} starts looking after ${e.ward}`;
    case "EXCHANGE": return `Exchange with rival: get ${e.get.amount} ${e.get.resource}${e.give ? `, give ${e.give.amount} ${e.give.resource}` : ""}`;
    case "CHANGE_PROJECT": return `Project of ${e.role ?? e.tech}: ${[e.progress !== undefined ? `${e.progress >= 0 ? "+" : ""}${Math.round(e.progress * 100)}% work` : "", e.approach ? `run ${e.approach}` : ""].filter(Boolean).join(", ")}`;
    case "BUILD_FACILITY": return `Build ${e.facility}`;
    case "CHANGE_FACILITY": return `${e.facility} condition ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "ENACT_LAW": return `Enact ${e.law}`;
    case "REPEAL_LAW": return `Repeal ${e.law}`;
    case "CLAIM_SITE": return `Claim ${LOCATION_BY_ID[e.location]?.name ?? e.location}`;
    case "CEDE_CLAIM": return "Hand a claimed site to the rival";
    case "ADD_SPECIALTY": return `${e.role} learns ${e.specialty}`;
    case "PRACTICE": return `${e.role} practises ${e.specialty}`;
    case "ADD_SEEDS": return `${e.amount >= 0 ? "+" : ""}${e.amount} seed`;
    case "CHANGE_FERTILITY": return `Fertility ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "SET_FARM_PLAN": return `Farm plan: ${e.plan}`;
    case "CHANGE_CROPS": return `Crops ${Math.round(e.fraction * 100)}%`;
    case "PRIORITIZE_BRANCH": return `Council prioritises ${e.branch}`;
    case "PROPOSE": return `Propose (${e.kind}${e.domain ? ` · ${e.domain}` : ""}): ${e.title}`;
    case "RESOLVE_PROPOSAL": return e.approve ? "Carry out the proposal" : "Drop the proposal";
    case "SPEND": return `Pay ${Object.entries(e.costs).map(([k, v]) => `${v} ${k}`).join(", ")}`;
    case "AFTER": return `After ${e.seasons} season(s): ${e.title}`;
    case "SCHEDULE_EVENT": return `${e.event} follows in ${e.seasons} season(s)${e.away?.length ? ` (${e.away.join(", ")} away)` : ""}`;
    case "CHANGE_TENSION": return `Tension with rival ${e.delta >= 0 ? "+" : ""}${e.delta}`;
  }
}
