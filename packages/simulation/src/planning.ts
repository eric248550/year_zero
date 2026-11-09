import {
  ADULT_AGE,
  BRANCH_INFO,
  FACILITY_WORKING,
  INFRASTRUCTURE,
  LOCATION_BY_ID,
  MAJOR_WORKS,
  PLANNING,
  PRIORITY_INFO,
  TECH_BY_ID,
  type FacilityId,
  type Profession,
  type Settlement,
  type WorldState,
} from "@genesis/schemas";
import { activeSettlements, characterAge, facilityName, good, isZh, population, powerAt, residents, techText } from "@genesis/narrative";
import { check, civilization, CIV_STAGES, linkedSettlements, type MilestoneCheck } from "./civilization";
import { buildReserve, whyNotBuild, type BuildConstraint } from "./systems/legacy";
import { activeProjects, projectBlocker } from "./systems/projects";

/**
 * What stands between a settlement and a goal, read from the world as it is
 * now. Nothing here changes anything, and nothing is stored: every plan is
 * worked out again from the current state, so it follows the world as supplies,
 * people and decisions change. NPC leaders act on it and players read it.
 */
export type StepStatus = "done" | "building" | "ready" | "waiting" | "blocked";

export interface PlanSolver {
  kind: "project" | "join" | "build" | "produce" | "wait";
  label: string;
  tech?: string;
  facility?: FacilityId;
  profession?: Profession;
}

export interface PlanStep {
  id: string;
  kind: "tech" | "facility" | "supply" | "people" | "decision" | "world";
  label: string;
  status: StepStatus;
  /** Why it is not done, in the player's language. */
  detail: string | null;
  profession: Profession | null;
  solvers: PlanSolver[];
  tech?: string;
  facility?: FacilityId;
}

export type Goal = "night_power" | "grid" | "institute";

export interface GoalPlan {
  goal: Goal;
  settlementId: string;
  /** The way chosen: the cheapest one this settlement can still take. */
  route: "solar" | "water" | "line" | "grid" | "institute" | "working";
  routeLabel: string;
  ready: boolean;
  steps: PlanStep[];
  /** What is still to be paid, and how long the building takes. */
  remaining: { materials: number; parts: number; seasons: number };
  proposal: { status: "none" | "open" | "rejected" | "failed"; year: number | null; facility: FacilityId | null };
}

const tx = (st: WorldState, zh: string, en: string) => (isZh(st) ? zh : en);
const working = (s: Settlement, f: FacilityId) => (s.facilities?.[f] ?? 0) >= FACILITY_WORKING;
const key = (f: FacilityId) => `facility:${f}`;

/** The last time this was put to the settlement, if it matters any more. */
export function lastProposal(st: WorldState, s: Settlement, f: FacilityId) {
  return (st.proposals ?? []).filter((p) => p.settlementId === s.id && p.key === key(f)).sort((a, b) => (b.resolvedTick ?? b.createdTick) - (a.resolvedTick ?? a.createdTick))[0];
}

export type MajorDelay = BuildConstraint | "pressing" | "surplus" | "cooldown" | "open" | "leader";

/**
 * Why a settlement's own leaders would not put this major work forward now.
 * They weigh it against everything else the settlement needs; a player
 * proposing the same work is held only by what can actually be paid.
 */
export function majorWorkDelay(st: WorldState, s: Settlement, f: FacilityId): MajorDelay | null {
  const info = INFRASTRUCTURE[f];
  if (!info) return null;
  const last = lastProposal(st, s, f);
  if (last?.status === "open") return "open";
  if (last && (last.status === "rejected" || last.status === "failed") && st.tick - (last.resolvedTick ?? last.createdTick) < (last.status === "rejected" ? PLANNING.afterRejected : PLANNING.afterFailed)) return "cooldown";
  const why = whyNotBuild(st, s, f);
  if (why && why !== "materials" && why !== "parts") return why;
  // People first: a hungry settlement does not spend on the grid.
  if (s.shortage.food > 0 || s.shortage.water > 0 || s.morale < 35 || residents(st, s.id).length < 12) return "pressing";
  const ambitious = !!s.priority && PRIORITY_INFO[s.priority].ambitious;
  if (s.resources.materials < info.materials + buildReserve(s) + (ambitious ? 0 : PLANNING.surplusMaterials)) return ambitious || s.resources.materials < info.materials + buildReserve(s) ? "materials" : "surplus";
  const parts = (info.parts ?? 0) + PLANNING.partsReserve;
  if (good(s, "parts") < parts + (ambitious ? 0 : PLANNING.surplusParts)) return ambitious || good(s, "parts") < parts ? "parts" : "surplus";
  if (!residents(st, s.id).some((c) => !c.controllerId && c.profession === "Engineer" && characterAge(st, c) >= ADULT_AGE && (c.attributes?.knowledge ?? 0) >= PLANNING.competence)) return "leader";
  return null;
}

function delayText(st: WorldState, why: MajorDelay, f: FacilityId, s: Settlement): string {
  const info = INFRASTRUCTURE[f]!;
  switch (why) {
    case "hoard": return tx(st, "聚落決定暫停新建", "The settlement has chosen to build nothing new");
    case "engineers": return tx(st, "工程師不夠，照顧不了更多機器", "Not enough engineers to tend more machines");
    case "trade": return tx(st, "目前靠鄰居供應", "It relies on a neighbour for this");
    case "materials": return tx(st, `物資不夠（需要 ${info.materials} 並留下準備，現有 ${Math.floor(s.resources.materials)}）`, `Short of materials (${info.materials} plus a reserve; has ${Math.floor(s.resources.materials)})`);
    case "parts": return tx(st, `零件不夠（需要 ${info.parts ?? 0}，現有 ${Math.floor(good(s, "parts"))}）`, `Short of tools and components (${info.parts ?? 0}; has ${Math.floor(good(s, "parts"))})`);
    case "pressing": return tx(st, "聚落正忙著應付更急的事", "The settlement has more urgent troubles");
    case "surplus": return tx(st, "聚落想先累積一些餘裕", "The settlement wants more in hand first");
    case "cooldown": return tx(st, "最近才被否決或付不起，要過幾年才會再提", "Recently turned down or unaffordable; it will come back in a few years");
    case "open": return tx(st, "提案等待決定中", "A proposal is waiting for a decision");
    case "leader": return tx(st, "沒有夠懂的工程師能提出計畫", "No engineer here understands it well enough to propose it");
  }
}

function techChain(st: WorldState, id: string, s: Settlement, seen = new Set<string>()): PlanStep[] {
  if (seen.has(id) || st.technologies.includes(id)) return [];
  seen.add(id);
  const t = TECH_BY_ID[id]!;
  const before = t.prerequisites.flatMap((p) => techChain(st, p, s, seen));
  const name = techText(st, id).name;
  const profession = BRANCH_INFO[t.branch].profession;
  const open = activeProjects(st).find((p) => p.techId === id);
  const solvers: PlanSolver[] = [];
  let status: StepStatus = "ready";
  let detail: string | null = null;
  if (open) {
    status = "building";
    detail = tx(st, `進行中（${Math.round((open.progress / t.cost) * 100)}%）`, `Under way (${Math.round((open.progress / t.cost) * 100)}%)`);
    solvers.push({ kind: "join", label: tx(st, `加入${name}專案`, `Join the ${name} project`), tech: id, profession });
  } else {
    const why = projectBlocker(st, id, s);
    if (!t.prerequisites.every((p) => st.technologies.includes(p))) { status = "waiting"; detail = tx(st, "要先完成前面的技術", "Earlier technologies come first"); }
    else if (why) { status = "blocked"; detail = why; }
    solvers.push({ kind: "project", label: tx(st, `開${name}專案`, `Start a ${name} project`), tech: id, profession });
    if (s.resources.materials < t.materials) solvers.push({ kind: "produce", label: tx(st, "累積物資", "Gather materials"), profession: "Engineer" });
    if (good(s, "parts") < t.parts) solvers.push({ kind: "produce", label: tx(st, "打造工具零件或向鄰居調貨", "Make tools or trade for them"), profession: "Engineer" });
  }
  return [...before, { id: `tech:${id}`, kind: "tech", label: name, status, detail, profession, solvers, tech: id }];
}

function facilityStep(st: WorldState, s: Settlement, f: FacilityId): PlanStep {
  const info = INFRASTRUCTURE[f]!;
  const name = facilityName(st, f);
  const base = { id: `facility:${f}`, kind: "facility" as const, label: name, profession: "Engineer" as Profession, facility: f };
  if (working(s, f)) return { ...base, status: "done", detail: null, solvers: [] };
  if (s.building?.[f] !== undefined) return { ...base, status: "building", detail: tx(st, "正在蓋", "Under construction"), solvers: [] };
  if (!st.technologies.includes(info.tech)) return { ...base, status: "waiting", detail: tx(st, `要先有${techText(st, info.tech).name}`, `Needs ${techText(st, info.tech).name}`), solvers: [] };
  if (info.after && !working(s, info.after)) return { ...base, status: "waiting", detail: tx(st, `要先有${facilityName(st, info.after)}`, `Needs a ${facilityName(st, info.after)}`), solvers: [] };
  const solver: PlanSolver = { kind: "build", label: tx(st, `蓋${name}`, `Build a ${name}`), facility: f, profession: "Engineer" };
  const why = MAJOR_WORKS.includes(f) ? majorWorkDelay(st, s, f) : whyNotBuild(st, s, f);
  if (why) return { ...base, status: why === "open" ? "waiting" : "blocked", detail: delayText(st, why, f, s), solvers: [solver] };
  return { ...base, status: "ready", detail: tx(st, `可以開工：${info.materials} 物資、${info.parts ?? 0} 零件、${info.seasons} 季`, `Ready: ${info.materials} materials, ${info.parts ?? 0} tools, ${info.seasons} seasons`), solvers: [solver] };
}

function plan(st: WorldState, s: Settlement, goal: Goal, route: GoalPlan["route"], routeLabel: string, techs: string[], facilities: FacilityId[], extra: PlanStep[] = []): GoalPlan {
  const seen = new Set<string>();
  const steps: PlanStep[] = [...techs.flatMap((t) => techChain(st, t, s, seen)), ...facilities.map((f) => facilityStep(st, s, f)), ...extra];
  const left = facilities.filter((f) => !working(s, f) && s.building?.[f] === undefined).map((f) => INFRASTRUCTURE[f]!);
  const next = facilities.find((f) => !working(s, f) && s.building?.[f] === undefined) ?? null;
  // What it would really take, spelled out: stores, a person who can do it, and whether anyone has asked.
  if (next) {
    const i = INFRASTRUCTURE[next]!;
    const have = (n: number, of: number, label: string, id: string): PlanStep => ({ id, kind: "supply", label, status: n >= of ? "done" : "blocked", detail: `${Math.floor(n)}/${of}`, profession: "Engineer", solvers: n >= of ? [] : [{ kind: "produce", label: tx(st, `多弄一些${label}`, `Get more ${label}`), profession: "Engineer" }] });
    steps.push(have(s.resources.materials, i.materials, tx(st, "物資", "Materials"), "supply:materials"));
    if (i.parts) steps.push(have(good(s, "parts"), i.parts, tx(st, "工具零件", "Tools & components"), "supply:parts"));
    const engineers = residents(st, s.id).filter((c) => c.profession === "Engineer" && characterAge(st, c) >= ADULT_AGE).length;
    steps.push({ id: "people:engineer", kind: "people", label: tx(st, "工程師", "Engineers"), status: engineers > 0 ? "done" : "blocked", detail: String(engineers), profession: "Engineer", solvers: [] });
  }
  const last = next && MAJOR_WORKS.includes(next) ? lastProposal(st, s, next) : undefined;
  const status = last?.status === "open" ? "open" : last && (last.status === "rejected" || last.status === "failed") && st.tick - (last.resolvedTick ?? last.createdTick) < 12 ? last.status : "none";
  if (next && MAJOR_WORKS.includes(next)) steps.push({ id: "decision:proposal", kind: "decision", label: tx(st, "興建提案", "Construction proposal"), status: status === "open" ? "waiting" : status === "none" ? "ready" : "blocked", detail: { open: tx(st, "等待決定", "Waiting for a decision"), rejected: tx(st, `${st.startYear + (last?.resolvedTick ?? 0)} 年被否決`, `Rejected in ${st.startYear + (last?.resolvedTick ?? 0)}`), failed: tx(st, `${st.startYear + (last?.resolvedTick ?? 0)} 年通過但付不起`, `Approved in ${st.startYear + (last?.resolvedTick ?? 0)} but could not be paid for`), none: tx(st, "還沒有人提", "Not yet proposed") }[status], profession: "Engineer", solvers: [] });
  return { goal, settlementId: s.id, route, routeLabel, ready: steps.every((x) => x.status === "done"), steps, remaining: { materials: left.reduce((n, i) => n + i.materials, 0), parts: left.reduce((n, i) => n + (i.parts ?? 0), 0), seasons: left.reduce((n, i) => n + i.seasons, 0) }, proposal: { status, year: last?.resolvedTick !== undefined ? st.startYear + last.resolvedTick : null, facility: next } };
}

const remainingWeight = (p: GoalPlan) => p.steps.filter((x) => x.status !== "done" && x.kind !== "supply" && x.kind !== "people" && x.kind !== "decision").length * 100 + p.remaining.materials + p.remaining.parts * 2;

/** The best remaining way for this settlement to have light after dark. */
export function nightPlan(st: WorldState, s: Settlement): GoalPlan {
  if (powerAt(st, s).night >= PLANNING.nightPower) return { goal: "night_power", settlementId: s.id, route: "working", routeLabel: tx(st, "已經有夜間電力", "Already lit after dark"), ready: true, steps: [], remaining: { materials: 0, parts: 0, seasons: 0 }, proposal: { status: "none", year: null, facility: null } };
  const routes: GoalPlan[] = [plan(st, s, "night_power", "solar", tx(st, "太陽能加蓄電池", "Solar array and batteries"), ["solar_power", "metallurgy"], ["solar_array", "battery_bank"])];
  if (LOCATION_BY_ID[s.locationId]?.features.includes("river")) routes.push(plan(st, s, "night_power", "water", tx(st, "水車帶動發電機", "A generator on the water mill"), ["water_wheel", "mechanical_power"], ["watermill", "generator"]));
  const lit = activeSettlements(st).some((o) => o.id !== s.id && working(o, "power_lines") && powerAt(st, o).night >= PLANNING.nightPower);
  if (lit && st.technologies.includes("power_grid")) routes.push(plan(st, s, "night_power", "line", tx(st, "接上別處的電線", "A line from a lit neighbour"), [], ["power_lines"]));
  return routes.sort((a, b) => remainingWeight(a) - remainingWeight(b) || (a.route < b.route ? -1 : 1))[0]!;
}

export function gridPlan(st: WorldState, s: Settlement): GoalPlan {
  const n = linkedSettlements(st);
  const linked: PlanStep = { id: "world:linked", kind: "world", label: tx(st, "兩個聚落接上有電的線路", "Two settlements on a live line"), status: n >= 2 ? "done" : "waiting", detail: `${n}/2`, profession: "Engineer", solvers: [] };
  return plan(st, s, "grid", "grid", tx(st, "聚落之間的電網", "A grid between settlements"), ["power_grid"], ["power_lines"], [linked]);
}

export function institutePlan(st: WorldState, s: Settlement): GoalPlan {
  const powered = activeSettlements(st).some((o) => powerAt(st, o).day >= PLANNING.nightPower);
  const step: PlanStep = { id: "world:powered", kind: "world", label: tx(st, "有電的地方", "A place with power"), status: powered ? "done" : "waiting", detail: powered ? null : tx(st, "先把電弄起來", "Get power running first"), profession: "Engineer", solvers: [] };
  return plan(st, s, "institute", "institute", tx(st, "研究所", "A research institute"), ["research_institute"], [], [step]);
}

/** Every power-and-institute goal not yet met here, nearest first. */
export function goalPlans(st: WorldState, s: Settlement): GoalPlan[] {
  return [nightPlan(st, s), gridPlan(st, s), institutePlan(st, s)].filter((p) => !p.ready);
}

/** The building a settlement's plans call for next, once it knows how to build it. */
export function nextPlanStep(st: WorldState, s: Settlement): FacilityId | null {
  for (const p of goalPlans(st, s)) {
    const f = p.proposal.facility;
    if (f && st.technologies.includes(INFRASTRUCTURE[f]!.tech) && (!INFRASTRUCTURE[f]!.after || working(s, INFRASTRUCTURE[f]!.after!))) return f;
  }
  return null;
}

export interface MilestoneBlockers {
  stage: string;
  milestone: string;
  routeLabel: string | null;
  ready: boolean;
  steps: PlanStep[];
}

function stepsFor(st: WorldState, s: Settlement, c: MilestoneCheck): { steps: PlanStep[]; routeLabel: string | null } {
  switch (c.kind) {
    case "tech": return { steps: techChain(st, c.tech, s), routeLabel: null };
    case "facility": {
      const info = INFRASTRUCTURE[c.facility];
      if (info) return { steps: [facilityStep(st, s, c.facility)], routeLabel: null };
      const tech = Object.entries({ schoolhouse: "schooling" }).find(([f]) => f === c.facility)?.[1];
      return { steps: tech ? techChain(st, tech, s) : [], routeLabel: null };
    }
    case "harvested": return { steps: [{ id: "world:harvest", kind: "world", label: tx(st, "在地表種出第一批收成", "A first surface harvest"), status: "waiting", detail: tx(st, "要有開墾的田和種子", "Needs cleared fields and seed"), profession: "Farmer", solvers: [{ kind: "build", label: tx(st, "開墾田地", "Break new fields"), profession: "Farmer" }] }], routeLabel: null };
    case "nightPower": { const p = nightPlan(st, s); return { steps: p.steps, routeLabel: p.routeLabel }; }
    case "linked": { const p = gridPlan(st, s); return { steps: p.steps, routeLabel: p.routeLabel }; }
    case "powered": return { steps: nightPlan(st, s).steps.filter((x) => x.id !== "facility:battery_bank"), routeLabel: null };
    case "population": { const n = population(st); return { steps: [{ id: "world:people", kind: "world", label: tx(st, "人口", "People"), status: "waiting", detail: `${n}/${c.min}`, profession: "Medic", solvers: [{ kind: "wait", label: tx(st, "穩定糧食、住處與醫療", "Keep food, room and care steady"), profession: "Medic" }] }], routeLabel: null }; }
    case "settlements": { const n = activeSettlements(st).length; return { steps: [{ id: "world:settlements", kind: "world", label: tx(st, "聚落數量", "Settlements"), status: "waiting", detail: `${n}/${c.min}`, profession: "Scout", solvers: [{ kind: "wait", label: tx(st, "找到新地點，等聚落住滿分出去", "Find sites and grow until people move out"), profession: "Scout" }] }], routeLabel: null }; }
    case "flag":
    case "anyFlag": return { steps: [{ id: "world:event", kind: "world", label: tx(st, "還沒發生", "Has not happened yet"), status: "waiting", detail: tx(st, "條件成熟後會在世界裡發生", "It happens in the world once conditions are right"), profession: null, solvers: [] }], routeLabel: null };
    case "any": {
      const options = c.of.map((x) => stepsFor(st, s, x)).filter((o) => o.steps.length > 0);
      return options.sort((a, b) => Number(a.steps[0]?.id === "world:event") - Number(b.steps[0]?.id === "world:event") || a.steps.filter((x) => x.status !== "done").length - b.steps.filter((x) => x.status !== "done").length)[0] ?? { steps: [], routeLabel: null };
    }
    case "all": {
      const parts = c.of.filter((x) => !check(st, x).done).map((x) => stepsFor(st, s, x));
      const seen = new Set<string>();
      return { steps: parts.flatMap((p) => p.steps).filter((x) => !seen.has(x.id) && seen.add(x.id)), routeLabel: parts.find((p) => p.routeLabel)?.routeLabel ?? null };
    }
  }
}

/** Every milestone of the stage the world is working on that is not yet met, with what it needs from here. */
export function milestoneBlockers(st: WorldState, s: Settlement): MilestoneBlockers[] {
  const civ = civilization(st);
  const stage = CIV_STAGES[civ.stage];
  if (!stage) return [];
  return stage.milestones.filter((m) => !check(st, m.check).done).map((m) => {
    const r = stepsFor(st, s, m.check);
    return { stage: stage.id, milestone: m.id, routeLabel: r.routeLabel, ready: r.steps.every((x) => x.status === "done"), steps: r.steps };
  });
}

