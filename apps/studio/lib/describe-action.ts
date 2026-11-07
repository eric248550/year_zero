import type { PlayerAction } from "@genesis/schemas";
import type { I18n } from "./i18n/core";

/** Human-readable summary of a developer action (shared by server and client components). */
export function describeAction(a: PlayerAction, { t, term }: Pick<I18n, "t" | "term">): string {
  switch (a.type) {
    case "SET_POLICY": return t("action.desc.policy", { policy: term.policyName(a.policy) });
    case "SET_RESEARCH_FOCUS": return a.tech ? t("action.desc.focus", { tech: term.techName(a.tech) }) : t("action.desc.clearFocus");
    case "FOUND_SETTLEMENT": return t("action.desc.found", { location: term.locationName(a.locationId), settlers: a.settlers, from: a.fromSettlementId });
    case "LAUNCH_EXPEDITION": return t("action.desc.expedition", { from: a.settlementId });
    case "ASSIGN_PROFESSION": return t("action.desc.assign", { character: a.characterId, profession: term.profession(a.profession) });
    case "JOIN_WORLD": return a.inviteCode
      ? t("action.desc.joinInvite", { player: a.playerName, code: a.inviteCode })
      : t("action.desc.join", { player: a.playerName, origin: a.origin ?? "haven_deep" });
    case "CHOOSE": return t("action.desc.choose", { player: a.playerId, choice: a.choiceId, decision: a.decisionId });
    case "CONTINUE_AS": return a.mode === "random" || !a.characterId
      ? t("action.desc.continueRandom", { player: a.playerId })
      : t("action.desc.continueAs", { player: a.playerId, character: a.characterId });
    case "CARE_FOR": return t("action.desc.care", { player: a.playerId, character: a.characterId });
    case "INVITE": return t("action.desc.invite", { player: a.playerId, code: a.code });
    case "LEAVE_WORLD": return t("action.desc.leave", { player: a.playerId });
    case "RENAME": return t("action.desc.rename", { player: a.playerId, name: `${a.familyName} ${a.givenName}`.trim() });
    case "PROLOGUE": return t("action.desc.prologue", { player: a.playerId, step: a.step, choice: a.choiceId });
    case "START_PROJECT": return t("action.desc.startProject", { player: a.playerId, tech: term.techName(a.tech) });
    case "JOIN_PROJECT": return a.projectId ? t("action.desc.joinProject", { player: a.playerId, project: a.projectId }) : t("action.desc.leaveProject", { player: a.playerId });
    case "PROJECT_APPROACH": return t("action.desc.approach", { player: a.playerId, approach: a.approach });
    case "DONATE_PROJECT": return t("action.desc.donate", { player: a.playerId, amount: a.amount });
    case "TRANSFER_RESOURCES": return t("action.desc.transfer", { amount: a.amount, resource: term.resource(a.resource), from: a.fromSettlementId, to: a.toSettlementId });
  }
}
