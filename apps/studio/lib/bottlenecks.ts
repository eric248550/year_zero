import type { Character, Settlement, WorldState } from "@genesis/schemas";
import { professionName } from "@genesis/narrative";
import { activeProjects, milestoneBlockers, workOptions, type PlanStep } from "@genesis/simulation";

export interface BottleneckView {
  key: string;
  titleKey: string;
  routeLabel: string | null;
  open: boolean;
  steps: Pick<PlanStep, "id" | "label" | "status" | "detail">[];
  next: string[];
  action: { label: string; action: Record<string, unknown> } | null;
}

/** The first thing that can be moved, read from the plan. */
function firstMovable(steps: PlanStep[]): PlanStep | undefined {
  return steps.find((x) => x.status === "ready" || x.status === "blocked" || x.status === "building") ?? steps.find((x) => x.status !== "done");
}

/**
 * What the current stage still needs from this settlement. With a character,
 * it also says what that person could do about it, and offers the action when
 * the rules allow it this minute.
 */
export function bottlenecksFor(state: WorldState, s: Settlement, c: Character | null, zh: boolean): BottleneckView[] {
  const options = c ? workOptions(state, c) : [];
  const say = (a: string, b: string) => (zh ? a : b);
  return milestoneBlockers(state, s).slice(0, 4).map((b, i) => {
    const step = firstMovable(b.steps);
    const next: string[] = [];
    let action: BottleneckView["action"] = null;
    if (step) {
      if (step.detail && step.status !== "ready") next.push(`${step.label}：${step.detail}`.replace("：", zh ? "：" : ": "));
      for (const sol of step.solvers.slice(0, 2)) {
        const who = sol.profession ? professionName(state, sol.profession) : null;
        if (!c || !sol.profession || sol.profession === c.profession) next.push(sol.label);
        else if (who) next.push(say(`需要${who}：${sol.label}`, `Needs a ${who}: ${sol.label}`));
      }
      if (step.status === "waiting" && step.kind === "decision") next.push(say("到「待決定」表達你的意見。", "Say where you stand under your decisions."));
      if (c && step.profession === c.profession) {
        if (step.kind === "tech" && step.tech) {
          const open = activeProjects(state).find((p) => p.techId === step.tech);
          if (open && !open.memberIds.includes(c.id)) action = { label: say("加入專案", "Join the project"), action: { type: "JOIN_PROJECT", projectId: open.id } };
          else if (!open && step.status === "ready") action = { label: say("帶頭開這個專案", "Lead this project"), action: { type: "START_PROJECT", tech: step.tech } };
        } else if (step.kind === "facility" && step.facility) {
          const t = options.find((o) => o.id === "eng_build")?.targets?.find((x) => x.id === step.facility);
          const proposes = options.find((o) => o.id === "eng_build")?.proposes;
          if (t && !t.blocker) action = { label: proposes ? say("提出興建提案", "Propose building it") : say("開工興建", "Start building"), action: { type: "START_WORK", action: "eng_build", target: step.facility } };
        }
      }
    }
    return { key: `${b.stage}.${b.milestone}`, titleKey: `civ.m.${b.stage}.${b.milestone}`, routeLabel: b.routeLabel, open: i === 0, steps: b.steps.map(({ id, label, status, detail }) => ({ id, label, status, detail })), next: [...new Set(next)], action };
  }).filter((b) => b.steps.length > 0);
}
