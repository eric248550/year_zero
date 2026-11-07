import {
  ADULT_AGE,
  APPROACH_INFO,
  BRANCH_INFO,
  type PolicyId,
  type ProjectApproach,
  ELDER_AGE,
  POLICY_INFO,
  TECHNOLOGIES,
  TECH_BY_ID,
  type Character,
  type Project,
  type Settlement,
  type TechnologyInfo,
  type WorldState,
} from "@genesis/schemas";
import {
  activeSettlements,
  characterAge,
  fullName,
  getCharacter,
  getSettlement,
  hasTech,
  newRecorder,
  population,
  residents,
  round2,
  say,
  techText,
  totalResource,
  unlockTechnology,
} from "@genesis/narrative";
import type { TickContext } from "../context";

/**
 * Projects: every technology is built by people. The council or a player
 * starts one in a settlement; that settlement's people of the branch's
 * profession work on it each year, players who joined work on it too, and
 * knowledge is spent as the work is done. Setbacks and breakthroughs happen.
 */
export const PROJECTS = {
  /** Non-player crew a project can use: base + per tier. */
  crewBase: 4,
  crewPerTier: 2,
  /** Work per person and year: own profession, or helping outside it. */
  matchWork: 1,
  otherWork: 0.5,
  /** Players chose this work themselves. */
  playerFocus: 1.5,
  /** Knowledge spent per unit of work. */
  knowledgePerWork: 2.5,
  /** Work done in a year of food or water shortage. */
  hungerFactor: 0.4,
  setbackChance: 0.06,
  breakthroughChance: 0.05,
  /** Years with nobody on it before a project is set aside. */
  stallYears: 3,
  /** The council runs one project, plus one per this many people (up to the max). */
  peoplePerCouncilProject: 40,
  maxCouncilProjects: 5,
  /** New council projects per year. */
  councilStartsPerYear: 2,
} as const;

export function activeProjects(st: WorldState): Project[] {
  return st.projects ?? [];
}

export function projectFor(st: WorldState, characterId: string): Project | undefined {
  return activeProjects(st).find((p) => p.memberIds.includes(characterId));
}

/** Why a project for `tech` cannot start in `s` right now, or null. */
export function projectBlocker(st: WorldState, techId: string, s: Settlement | undefined): string | null {
  const tech = TECH_BY_ID[techId];
  if (!tech) return `Unknown technology ${techId}`;
  if (st.technologies.includes(techId)) return `${tech.name} is already known`;
  if (!tech.prerequisites.every((p) => st.technologies.includes(p))) return `${tech.name} prerequisites are not met`;
  if (tech.minPopulation && population(st) < tech.minPopulation) return `${tech.name} needs ${tech.minPopulation} people`;
  if (activeProjects(st).some((p) => p.techId === techId)) return `Someone is already working on ${tech.name}`;
  if (!s || s.status !== "active") return "Settlement is not active";
  if (s.resources.materials < tech.materials) return `${s.name} needs ${tech.materials} materials`;
  return null;
}

/** Branches someone of this profession can propose projects in. */
export function proposableBranches(profession: Character["profession"]): string[] {
  return Object.entries(BRANCH_INFO).filter(([, b]) => b.profession === profession).map(([id]) => id);
}

/** How the council runs the projects it starts. */
const COUNCIL_APPROACH: Record<PolicyId, ProjectApproach> = { balanced: "steady", expansionist: "bold", scholarly: "frugal", cautious: "careful" };

/** Technologies a project could be started for anywhere (ignores materials). */
export function startableTechs(st: WorldState): TechnologyInfo[] {
  return TECHNOLOGIES.filter((t) => {
    const r = projectBlocker(st, t.id, activeSettlements(st)[0]);
    return r === null || r.endsWith("materials");
  });
}

function workOf(st: WorldState, c: Character, tech: TechnologyInfo): number {
  const age = characterAge(st, c);
  if (age < ADULT_AGE) return 0;
  const branch = BRANCH_INFO[tech.branch];
  const base = c.profession === branch.profession ? PROJECTS.matchWork : PROJECTS.otherWork;
  const skill = 0.6 + 0.8 * ((c.attributes?.[branch.attribute] ?? 50) / 100);
  return base * skill * (age >= ELDER_AGE ? 0.5 : 1);
}

/** What one person adds to a project in a year, as a player (who chose the work) or not. */
export function workEstimate(st: WorldState, c: Character, techId: string, player = !!c.controllerId): number {
  const tech = TECH_BY_ID[techId];
  return tech ? round2(workOf(st, c, tech) * (player ? PROJECTS.playerFocus : 1)) : 0;
}

export function startProject(ctx: TickContext, tech: TechnologyInfo, s: Settlement, lead: Character, by: Project["startedBy"]): Project {
  const st = ctx.state;
  st.projects ??= [];
  const n = st.counters.nextProject ?? 1;
  st.counters.nextProject = n + 1;
  s.resources.materials = round2(s.resources.materials - tech.materials);
  const project: Project = {
    id: `p-${String(n).padStart(3, "0")}`,
    techId: tech.id,
    settlementId: s.id,
    startedTick: st.tick,
    startedBy: by,
    leadId: lead.id,
    memberIds: lead.controllerId ? [lead.id] : [],
    crewIds: [],
    progress: 0,
    lastGain: 0,
    idleYears: 0,
    approach: by === "council" ? COUNCIL_APPROACH[st.policy] : "steady",
  };
  st.projects.push(project);
  const name = techText(st, tech.id).name;
  const e = ctx.system({
    category: "technology",
    importance: "notable",
    title: say(st).projectStartTitle(fullName(lead), name),
    text: by === "player" ? say(st).projectStartPlayer(fullName(lead), name, s.name) : say(st).projectStartCouncil(fullName(lead), name, s.name),
    settlementIds: [s.id],
    characterIds: [lead.id],
    changes: [{ path: `projects.${project.id}`, label: name, before: null, after: "active" }],
    summary: by === "player" ? "Started by a player" : "The council keeps one project going per 50 people",
  });
  lead.lifeEvents.push({ tick: st.tick, text: say(st).projectStartedLife(name), historyId: e.id });
  return project;
}

/** A player character joins (or, with null, leaves) a project. */
export function joinProject(st: WorldState, c: Character, projectId: string | null): void {
  for (const p of activeProjects(st)) p.memberIds = p.memberIds.filter((id) => id !== c.id);
  if (!projectId) return;
  const p = activeProjects(st).find((x) => x.id === projectId);
  if (!p) return;
  p.memberIds.push(c.id);
  c.lifeEvents.push({ tick: st.tick, text: say(st).projectJoinedLife(techText(st, p.techId).name), historyId: null });
}

const busy = (c: Character | undefined, s: Settlement) => !!c && c.deathTick === null && c.homeId === s.id;

/** What the council would start next, best first: the developer's focus, untouched branches, early tiers, its policy. */
export function councilCandidates(st: WorldState): TechnologyInfo[] {
  const order = POLICY_INFO[st.policy].branchOrder;
  const busyBranches = new Set(activeProjects(st).map((p) => TECH_BY_ID[p.techId]!.branch));
  const focus = st.researchFocus;
  return startableTechs(st).sort((a, b) =>
    Number(b.id === focus) - Number(a.id === focus) ||
    Number(busyBranches.has(a.branch)) - Number(busyBranches.has(b.branch)) ||
    a.tier - b.tier ||
    order.indexOf(a.branch) - order.indexOf(b.branch) ||
    (a.id < b.id ? -1 : 1));
}

/** The council keeps a few projects going, preferring untouched branches, early tiers and its policy. */
export function councilProjects(ctx: TickContext): void {
  const st = ctx.state;
  const slots = Math.min(PROJECTS.maxCouncilProjects, 1 + Math.floor(population(st) / PROJECTS.peoplePerCouncilProject));
  for (let i = 0; i < PROJECTS.councilStartsPerYear; i++) {
    const candidates = councilCandidates(st);
    // A developer focus is started even when the council is already busy.
    const focusReady = !!st.researchFocus && candidates[0]?.id === st.researchFocus;
    if (activeProjects(st).filter((p) => p.startedBy === "council").length >= slots && !focusReady) return;
    if (!councilStart(ctx, candidates)) return;
  }
}

function councilStart(ctx: TickContext, candidates: TechnologyInfo[]): boolean {
  const st = ctx.state;
  const taken = new Set(activeProjects(st).flatMap((p) => [p.leadId, ...p.crewIds]));
  for (const tech of candidates) {
    const profession = BRANCH_INFO[tech.branch].profession;
    const options = activeSettlements(st)
      .filter((s) => projectBlocker(st, tech.id, s) === null)
      .map((s) => ({ s, people: residents(st, s.id).filter((c) => !c.controllerId && !taken.has(c.id) && c.profession === profession && characterAge(st, c) >= ADULT_AGE) }))
      .filter((o) => o.people.length > 0)
      .sort((a, b) => b.people.length - a.people.length || (a.s.id < b.s.id ? -1 : 1));
    const best = options[0];
    if (!best) continue;
    const attr = BRANCH_INFO[tech.branch].attribute;
    const lead = [...best.people].sort((a, b) => (b.attributes?.[attr] ?? 0) - (a.attributes?.[attr] ?? 0) || (a.id < b.id ? -1 : 1))[0]!;
    startProject(ctx, tech, best.s, lead, "council");
    return true;
  }
  return false;
}

/** Spend knowledge across settlements, richest first. Returns what was actually spent. */
function spendKnowledge(st: WorldState, amount: number): number {
  let remaining = Math.min(amount, totalResource(st, "knowledge"));
  const spent = remaining;
  for (const s of [...activeSettlements(st)].sort((a, b) => b.resources.knowledge - a.resources.knowledge)) {
    const take = Math.min(s.resources.knowledge, remaining);
    s.resources.knowledge = round2(s.resources.knowledge - take);
    remaining -= take;
    if (remaining <= 1e-9) break;
  }
  return spent;
}

/** One year of work on every project. */
export function projects(ctx: TickContext): void {
  const st = ctx.state;
  if (!st.projects?.length) return;
  const keep: Project[] = [];
  const taken = new Set<string>();
  // Projects whose technology arrived some other way, or whose settlement is gone, simply end.
  const live = st.projects.filter((p) => !st.technologies.includes(p.techId) && getSettlement(st, p.settlementId)?.status === "active");
  // Leads that can still lead keep their people first.
  for (const p of live) {
    const s = getSettlement(st, p.settlementId)!;
    p.memberIds = p.memberIds.filter((id) => { const c = getCharacter(st, id); return busy(c, s) && !!c!.controllerId; });
    const lead = getCharacter(st, p.leadId);
    const leadOk = busy(lead, s) && (lead!.controllerId ? p.memberIds.includes(lead!.id) : true);
    if (!leadOk) p.leadId = p.memberIds[0] ?? "";
    if (p.leadId) taken.add(p.leadId);
    for (const id of p.memberIds) taken.add(id);
  }

  for (const p of live) {
    const s = getSettlement(st, p.settlementId)!;
    const tech = TECH_BY_ID[p.techId]!;
    const profession = BRANCH_INFO[tech.branch].profession;
    const attr = BRANCH_INFO[tech.branch].attribute;
    const cap = PROJECTS.crewBase + PROJECTS.crewPerTier * tech.tier;
    const lead = getCharacter(st, p.leadId);
    const crew = residents(st, s.id)
      .filter((c) => !c.controllerId && !taken.has(c.id) && c.profession === profession && characterAge(st, c) >= ADULT_AGE)
      .sort((a, b) => (b.attributes?.[attr] ?? 0) - (a.attributes?.[attr] ?? 0) || (a.id < b.id ? -1 : 1))
      .slice(0, lead && !lead.controllerId ? cap - 1 : cap);
    for (const c of crew) taken.add(c.id);
    if (!p.leadId && crew[0]) p.leadId = crew[0].id;
    const npcs = [...(lead && !lead.controllerId ? [lead] : []), ...crew];
    p.crewIds = npcs.map((c) => c.id);
    const members = p.memberIds.map((id) => getCharacter(st, id)!);

    const approach = APPROACH_INFO[p.approach ?? "steady"];
    let work = npcs.reduce((n, c) => n + workOf(st, c, tech), 0) + members.reduce((n, c) => n + workOf(st, c, tech) * PROJECTS.playerFocus, 0);
    work *= approach.work;
    if (s.shortage.food > 0 || s.shortage.water > 0) work *= PROJECTS.hungerFactor;
    const perWork = PROJECTS.knowledgePerWork * approach.knowledge * (hasTech(st, "research_institute") ? 0.7 : 1);
    if (work > 0) {
      const spent = spendKnowledge(st, work * perWork);
      work = Math.min(work, spent / perWork);
    }
    work = round2(work);
    p.lastGain = work;
    p.idleYears = npcs.length + members.length > 0 ? 0 : p.idleYears + 1;
    const name = techText(st, tech.id).name;
    const people = [...members, ...npcs];
    const ids = [...new Set([p.leadId, ...p.memberIds, ...p.crewIds].filter(Boolean))];

    if (p.idleYears >= PROJECTS.stallYears) {
      ctx.system({
        category: "technology",
        importance: "minor",
        title: say(st).projectStalledTitle(name),
        text: say(st).projectStalledText(name, s.name),
        settlementIds: [s.id],
        characterIds: p.memberIds,
        changes: [{ path: `projects.${p.id}`, label: name, before: "active", after: "set aside" }],
      });
      continue;
    }

    p.progress = round2(p.progress + work);
    if (work > 0 && people.length > 0) {
      if (ctx.rng.chance(PROJECTS.setbackChance * approach.setback)) {
        const who = ctx.rng.pick(people);
        const before = p.progress;
        p.progress = round2(Math.max(0, p.progress - tech.cost * (0.1 + 0.1 * ctx.rng.next())));
        ctx.system({
          category: "technology",
          importance: "minor",
          title: say(st).projectSetbackTitle(name),
          text: say(st).projectSetbackText(fullName(who), name, s.name, ctx.rng.int(0, 2)),
          settlementIds: [s.id],
          characterIds: [who.id, ...p.memberIds.filter((id) => id !== who.id)],
          changes: [{ path: `projects.${p.id}.progress`, label: name, before, after: p.progress }],
        });
      } else {
        const gifted = people.filter((c) => (c.attributes?.[attr] ?? 0) >= 70);
        if (gifted.length > 0 && ctx.rng.chance(PROJECTS.breakthroughChance * approach.breakthrough)) {
          const who = ctx.rng.pick(gifted);
          const before = p.progress;
          p.progress = round2(p.progress + tech.cost * 0.15);
          ctx.system({
            category: "technology",
            importance: "minor",
            title: say(st).projectBreakthroughTitle(name),
            text: say(st).projectBreakthroughText(fullName(who), name),
            settlementIds: [s.id],
            characterIds: [who.id, ...p.memberIds.filter((id) => id !== who.id)],
            changes: [{ path: `projects.${p.id}.progress`, label: name, before, after: p.progress }],
          });
        }
      }
    }

    if (p.progress < tech.cost) {
      keep.push(p);
      continue;
    }
    complete(ctx, p, s, tech, ids);
  }
  st.projects = keep;
}

function complete(ctx: TickContext, p: Project, s: Settlement, tech: TechnologyInfo, ids: string[]): void {
  const st = ctx.state;
  const rec = newRecorder();
  unlockTechnology(st, tech.id, rec);
  if (st.researchFocus === tech.id) st.researchFocus = null;
  if (tech.id === "power_grid") for (const x of activeSettlements(st)) x.capacity += 10;
  if (tech.id === "metallurgy") for (const x of activeSettlements(st)) x.capacity += 5;
  const t = techText(st, tech.id);
  const lead = getCharacter(st, p.leadId);
  const e = ctx.system({
    category: "technology",
    importance: "major",
    title: say(st).projectDoneTitle(t.name, s.name),
    text: say(st).projectDoneText(lead ? fullName(lead) : s.name, ids.length, t.name, t.description, t.effect),
    settlementIds: [s.id],
    characterIds: ids,
    changes: rec.changes,
    summary: `Project ${p.id} reached its work total (${tech.cost})`,
  });
  for (const id of ids) {
    const c = getCharacter(st, id);
    c?.lifeEvents.push({ tick: st.tick, text: id === p.leadId ? say(st).ledProject(t.name) : say(st).workedProject(t.name), historyId: e.id });
  }
}
