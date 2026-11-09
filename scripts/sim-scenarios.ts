/**
 * Compare strategies on identical seeds. Each scenario uses only actions a real
 * player or council can take.
 *
 *   tsx scripts/sim-scenarios.ts <scenario> [seeds] [years] [outDir]
 *   tsx scripts/sim-scenarios.ts --merge <dir>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadContentDir } from "@genesis/narrative/node";
import * as sim from "@genesis/simulation";
import { powerAt } from "@genesis/narrative";
import { activeProjects, applyImmediate, checkInvariants, civilization, CIV_STAGES, createWorld, playerCharacter, projectBlocker, stepWorld, workOptions } from "@genesis/simulation";
import { BRANCH_INFO, PlayerActionSchema, TECHNOLOGIES, type BranchId, type PolicyId, type Profession, type WorldState } from "@genesis/schemas";

type Pref = { action: string; target?: (id: string) => boolean };
interface Scenario {
  players: Profession[];
  policy?: PolicyId;
  branches?: BranchId[];
  work?: Pref[];
  priority?: string;
  /** Years the priority holds; afterwards it is cleared. */
  priorityYears?: number;
  active?: boolean;
  /** Follows the bottleneck panel: builds what it says is next and starts the projects it lists. Rules 1.4 and later. */
  planner?: boolean;
}

const FARM: Pref[] = [{ action: "farm_clear" }, { action: "farm_seed" }, { action: "farm_soil" }, { action: "farm_tend" }];
const ENG: Pref[] = [{ action: "eng_build" }, { action: "eng_repair" }, { action: "eng_smelt" }, { action: "eng_craft" }, { action: "eng_improve" }, { action: "eng_inspect" }];
const SCOUT: Pref[] = [{ action: "sco_explore" }, { action: "sco_expedition" }, { action: "sco_salvage" }];
const SCI: Pref[] = [{ action: "sci_process" }, { action: "sci_investigate" }, { action: "sci_experiment" }];
const MED: Pref[] = [{ action: "med_prepare" }, { action: "med_treat" }, { action: "med_health" }];
const ALL = [...FARM, ...ENG, ...SCOUT, ...SCI, ...MED];

export const SCENARIOS: Record<string, Scenario> = {
  baseline: { players: [] },
  minimal: { players: ["Farmer", "Engineer", "Scientist", "Medic", "Scout", "Farmer"] },
  active: { players: ["Farmer", "Engineer", "Scientist", "Medic", "Scout", "Farmer"], work: ALL, active: true },
  agriculture: { players: ["Farmer", "Farmer", "Farmer", "Farmer", "Scientist", "Engineer"], policy: "balanced", branches: ["farming", "medicine"], work: ALL, priority: "food", active: true },
  industry: { players: ["Engineer", "Engineer", "Engineer", "Engineer", "Scout", "Scientist"], policy: "balanced", branches: ["industry", "energy"], work: ALL, priority: "industry", active: true },
  exploration: { players: ["Scout", "Scout", "Scout", "Scout", "Engineer", "Medic"], policy: "expansionist", branches: ["society"], work: ALL, priority: "expansion", active: true },
  research: { players: ["Scientist", "Scientist", "Scientist", "Scientist", "Medic", "Engineer"], policy: "scholarly", branches: ["knowledge", "medicine"], work: ALL, priority: "knowledge", active: true },
  planner: { players: ["Engineer", "Engineer", "Scientist", "Medic", "Scout", "Farmer"], work: ALL, active: true, planner: true },
  poor: { players: ["Farmer", "Engineer", "Scientist", "Medic", "Scout", "Farmer"], policy: "expansionist", priority: "hoard", priorityYears: 50 },
};

const plans = sim as unknown as { milestoneBlockers?: (s: WorldState, x: WorldState["settlements"][number]) => { steps: { kind: string; status: string; tech?: string; facility?: string; profession: string | null }[] }[] };
const CHECK = [25, 50, 75, 100, 150, 200, 250, 300];
const hasPriority = PlayerActionSchema.options.some((o) => o.shape.type.value === ("SET_PRIORITY" as string));

function world(name: string, sc: Scenario, seed: number, years: number, events: ReturnType<typeof loadContentDir>["events"]) {
  let s = createWorld({ seed, ...(sc.policy ? { policy: sc.policy } : {}) });
  sc.players.forEach((profession, i) => { s = applyImmediate(s, { type: "JOIN_WORLD", playerId: `p${i}`, playerName: `p${i}`, profession }).state; });
  const at: Record<number, object> = {};
  const stageYear: Record<string, number> = {};
  const milestoneYear: Record<string, number> = {};
  const projectYears: number[] = [];
  const w = { invariants: 0, shortage: 0, lowMat: 0, noParts: 0, sy: 0, raids: 0, schisms: 0, collapses: 0, stalled: 0, projectsDone: 0, projectsWithPlayer: 0, workPlayer: 0, workNpc: 0, settledSalvageGoneAt: null as number | null, oreGoneAt: null as number | null, peak: 0, dips: 0, recoveries: [] as number[], machinesLostAfterOre: 0 };
  let dip: number | null = null;
  const players = sc.players.map((_, i) => `p${i}`);
  for (let y = 0; y < years; y++) {
    const actions: unknown[] = [];
    const startedAt = new Map(activeProjects(s).map((p) => [p.id, p.startedTick]));
    for (const id of players) {
      const p = s.players?.[id];
      if (p?.status === "awaiting_succession") { const r = applyImmediate(s, { type: "CONTINUE_AS", playerId: id, mode: "random" }, events); if (!r.rejected) s = r.state; }
    }
    if (sc.active) {
      if (sc.branches) {
        const next = TECHNOLOGIES.filter((t) => sc.branches!.includes(t.branch) && !s.technologies.includes(t.id) && t.prerequisites.every((x) => s.technologies.includes(x))).sort((a, b) => a.tier - b.tier)[0];
        if (next && s.researchFocus !== next.id) actions.push({ type: "SET_RESEARCH_FOCUS", tech: next.id });
      }
      for (const id of players) {
        const me = playerCharacter(s, id);
        if (!me || !me.profession) continue;
        if (sc.planner && plans.milestoneBlockers) {
          // What the bottleneck panel shows this player: the current stage, first movable step, and only if it can be funded.
          const home = s.settlements.find((z) => z.id === me.homeId);
          const steps = home ? plans.milestoneBlockers(s, home).flatMap((b) => b.steps) : [];
          const f = steps.find((x) => x.kind === "facility" && x.profession === me.profession && x.facility && x.status !== "done" && x.status !== "building");
          const opt = f ? workOptions(s, me).find((o) => o.id === "eng_build")?.targets?.find((t) => t.id === f.facility && !t.blocker) : undefined;
          if (opt) actions.push({ type: "START_WORK", playerId: id, action: "eng_build", target: opt.id });
          const want = steps.find((x) => x.kind === "tech" && x.status === "ready" && x.profession === me.profession && x.tech);
          const t = want?.tech ? TECHNOLOGIES.find((x) => x.id === want.tech) : undefined;
          if (t && home && !activeProjects(s).some((p) => p.memberIds.includes(me.id)) && home.resources.materials >= t.materials + 50 && s.settlements.reduce((n, z) => n + z.resources.knowledge, 0) >= t.cost * 3) actions.push({ type: "START_PROJECT", playerId: id, tech: t.id });
        }
        // Lead or join work of your own trade.
        if (!process.env.NOPROJ && !activeProjects(s).some((p) => p.memberIds.includes(me.id))) {
          const own = activeProjects(s).find((p) => p.settlementId === me.homeId && BRANCH_INFO[TECHNOLOGIES.find((t) => t.id === p.techId)!.branch].profession === me.profession);
          if (own) actions.push({ type: "JOIN_PROJECT", playerId: id, projectId: own.id });
          else {
            const home = s.settlements.find((z) => z.id === me.homeId);
            const t = TECHNOLOGIES.filter((x) => BRANCH_INFO[x.branch].profession === me.profession && projectBlocker(s, x.id, home) === null && (home?.resources.materials ?? 0) >= x.materials + 50 && s.settlements.reduce((n, z) => n + z.resources.knowledge, 0) >= x.cost * 3 && (!sc.branches || sc.branches.includes(x.branch))).sort((a, b) => a.tier - b.tier)[0];
            if (t) actions.push({ type: "START_PROJECT", playerId: id, tech: t.id });
          }
        }
        const options = workOptions(s, me);
        let planned = 0;
        const here = s.settlements.find((z) => z.id === me.homeId)!;
        const people = s.characters.filter((c) => c.deathTick === null && c.homeId === here.id).length || 1;
        const lean = here.shortage.food > 0 || here.shortage.water > 0 || here.resources.food / people < 1.5 || here.resources.water / people < 1.5;
        for (const pref of (sc.work ?? []).filter((x) => !process.env.SKIP?.split(",").some((k) => x.action.startsWith(k)))) {
          const o = options.find((x) => x.id === pref.action);
          // Sensible people do not spend food on seed trials while the settlement is going hungry.
          if (!o || planned >= 3 || (lean && o.id !== "farm_tend" && o.id !== "eng_repair")) continue;
          // Nor empty the stores: what is left has to cover upkeep and the next project.
          if (o.costs.some((c) => c.have < c.amount + 40)) continue;
          const target = o.targets ? o.targets.find((t) => !t.blocker)?.id : undefined;
          if (o.targets ? !target : o.blocker) continue;
          actions.push({ type: "START_WORK", playerId: id, action: o.id, ...(target ? { target } : {}) });
          planned += o.seasons;
        }
      }
    }
    if (hasPriority && sc.priority) {
      const want = sc.priorityYears !== undefined && y >= sc.priorityYears ? null : sc.priority;
      for (const st of s.settlements.filter((x) => x.status === "active" && (x.priority ?? null) !== want)) actions.push({ type: "SET_PRIORITY", settlementId: st.id, priority: want });
    }
    const r = stepWorld(s, { events, actions });
    s = r.state;
    const bad = checkInvariants(s, r.events);
    if (bad.length) { w.invariants++; if (process.env.SHOW_BAD) console.log(seed, s.tick, bad.slice(0, 2)); }
    for (const e of r.events) {
      if (e.title.includes("搶了")) w.raids++;
      if (e.title.includes("分裂了")) w.schisms++;
      if (e.title.includes("被擱置")) w.stalled++;
      if (e.changes.some((c) => c.path.endsWith(".status") && c.after === "abandoned")) w.collapses++;
      if (e.trigger?.summary?.startsWith("Work w-") && e.characterIds[0]) { if (s.characters.find((c) => c.id === e.characterIds[0])?.controllerId) w.workPlayer++; else w.workNpc++; }
      if (e.trigger?.summary?.startsWith("Project ")) { const m = /Project (p-\d+)/.exec(e.trigger.summary); const from = m ? startedAt.get(m[1]!) : undefined; if (from !== undefined) projectYears.push(s.tick - from); w.projectsDone++; if (e.characterIds.some((id) => s.characters.find((c) => c.id === id)?.controllerId)) w.projectsWithPlayer++; }
    }
    const active = s.settlements.filter((x) => x.status === "active");
    for (const x of active) { w.sy++; if (x.shortage.food || x.shortage.water) w.shortage++; if (x.resources.materials < 15) w.lowMat++; if ((x.goods?.parts ?? 0) <= 0) w.noParts++; }
    const pop = s.characters.filter((c) => c.deathTick === null).length;
    if (pop > w.peak) { if (dip !== null) { w.recoveries.push(s.tick - dip); dip = null; } w.peak = pop; }
    else if (dip === null && pop < w.peak * 0.85) { dip = s.tick; w.dips++; }
    const open = s.locations.filter((l) => l.discovered);
    if (w.settledSalvageGoneAt === null && s.locations.filter((l) => l.settlementId).every((l) => (l.salvage ?? 0) <= 0)) w.settledSalvageGoneAt = s.tick;
    if (w.oreGoneAt === null && s.tick >= 20 && s.locations.reduce((n, l) => n + (l.settlementId || l.claimedBy ? l.ore ?? 0 : 0), 0) <= 0) w.oreGoneAt = s.tick;
    void open;
    for (const st of civilization(s).stages) { if (st.done && stageYear[st.id] === undefined) stageYear[st.id] = s.tick; for (const m of st.milestones) if (m.done && milestoneYear[`${st.id}.${m.id}`] === undefined) milestoneYear[`${st.id}.${m.id}`] = s.tick; }
    if (CHECK.includes(s.tick)) {
      const machines = active.flatMap((x) => Object.entries(x.facilities ?? {})).filter(([f, c]) => (c ?? 0) >= 30 && ["forge", "workshop", "mine", "watermill", "generator", "solar_array", "battery_bank", "power_lines"].includes(f)).length;
      at[s.tick] = {
        lit: active.filter((x) => powerAt(s, x).night >= 0.5).length, powered: active.filter((x) => powerAt(s, x).day >= 0.5).length, linked: active.filter((x) => (x.facilities?.power_lines ?? 0) >= 30).length,
        pop, techs: s.technologies.length, settlements: active.length, facilities: active.reduce((n, x) => n + Object.values(x.facilities ?? {}).filter((c) => (c ?? 0) >= 30).length, 0), machines,
        food: Math.round(active.reduce((n, x) => n + x.resources.food, 0) / Math.max(1, pop) * 10) / 10,
        materials: Math.round(active.reduce((n, x) => n + x.resources.materials, 0)), knowledge: Math.round(active.reduce((n, x) => n + x.resources.knowledge, 0)),
        parts: Math.round(active.reduce((n, x) => n + (x.goods?.parts ?? 0), 0)), metal: Math.round(active.reduce((n, x) => n + (x.goods?.metal ?? 0), 0)),
        ore: Math.round(s.locations.reduce((n, l) => n + (l.ore ?? 0), 0)), salvage: Math.round(s.locations.reduce((n, l) => n + (l.salvage ?? 0), 0)),
      };
    }
  }
  // How alike the settlements ended up: mean pairwise overlap of what stands (1 = identical).
  const act = s.settlements.filter((x) => x.status === "active");
  const sets = act.map((x) => new Set(Object.entries(x.facilities ?? {}).filter(([, c]) => (c ?? 0) >= 30).map(([f]) => f)));
  let sim = 0, pairs = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { const u = new Set([...sets[i]!, ...sets[j]!]); const n = [...sets[i]!].filter((f) => sets[j]!.has(f)).length; sim += u.size ? n / u.size : 1; pairs++; }
  const perCap = act.map((x) => { const n = s.characters.filter((c) => c.deathTick === null && c.homeId === x.id).length || 1; return x.resources.knowledge / n; });
  const mean = perCap.reduce((a, b) => a + b, 0) / Math.max(1, perCap.length);
  const profile = act.map((x) => { const adults = s.characters.filter((c) => c.deathTick === null && c.homeId === x.id && c.profession); const n = adults.length || 1; return Object.fromEntries((["Farmer", "Engineer", "Scientist", "Scout", "Medic"] as const).map((p) => [p, Math.round(adults.filter((c) => c.profession === p).length / n * 100)])); });
  const spread = (["Farmer", "Engineer", "Scientist", "Scout", "Medic"] as const).reduce((m, p) => { const v = profile.map((x) => x[p]!); return Math.max(m, v.length ? Math.max(...v) - Math.min(...v) : 0); }, 0);
  const civ = civilization(s);
  const blocker = civ.stages.find((x) => !x.done)?.milestones.filter((m) => !m.done).map((m) => `${civ.stages.find((x) => !x.done)!.id}.${m.id}`) ?? [];
  const net = (g: string) => act.filter((x) => ((x as unknown as { traded?: Record<string, number> }).traded?.[g] ?? 0) > 0).length;
  return { scenario: name, seed, stageYear, milestoneYear, blocker, projectYears: avg(projectYears), importsFood: net("food"), importsParts: net("parts"), activeSettlements: act.length, priorities: act.map((x) => x.priority ?? "none"), plans: (s.stats as unknown as { plans?: Record<string, number> }).plans ?? null, at, ...w, facilitySimilarity: pairs ? Math.round(sim / pairs * 100) / 100 : 1, knowledgeCov: mean ? Math.round(Math.sqrt(perCap.reduce((a, b) => a + (b - mean) ** 2, 0) / perCap.length) / mean * 100) / 100 : 0, professionSpread: spread, trade: s.stats.trade ?? 0, flow: s.stats.flow ?? null, made: (s.stats.made ?? {}) as Record<string, number>, sources: s.stats.materialsBySource ?? null, hash: 0 };
}

type W = ReturnType<typeof world>;
const med = (v: number[]) => { const x = [...v].sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)]! : null; };
const q = (v: number[], f: number) => { const x = [...v].sort((a, b) => a - b); return x.length ? x[Math.min(x.length - 1, Math.floor(x.length * f))]! : null; };
function avg(v: number[]) { return avgv(v); }
const avgv = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null);

function merge(dir: string) {
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".worlds.json"))) {
    const worlds = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as W[];
    const total = worlds.length;
    const stages = CIV_STAGES.map((st) => st.id);
    const yearsOf = (id: string) => worlds.map((w) => w.stageYear[id]).filter((x): x is number => x !== undefined);
    const renewal = yearsOf("renewal");
    const blockers: Record<string, number> = {};
    for (const w of worlds) for (const b of w.blocker ?? []) blockers[b] = (blockers[b] ?? 0) + 1;
    const allMilestones = CIV_STAGES.flatMap((st) => st.milestones.map((m) => `${st.id}.${m.id}`));
    const pick = (y: number, k: string) => worlds.map((w) => (w.at as unknown as Record<string, Record<string, number>>)[String(y)]?.[k]).filter((x): x is number => x !== undefined);
    out[f.replace(".worlds.json", "")] = {
      worlds: worlds.length,
      completion: {
        byYear: Object.fromEntries([100, 150, 300].map((y) => [y, Math.round((renewal.filter((x) => x <= y).length / total) * 1000) / 10])),
        medianAmongCompleted: med(renewal), completedWorlds: renewal.length,
        // Worlds that never finished count as later than the last year.
        medianAllWorlds: renewal.length * 2 > total ? [...renewal, ...Array(total - renewal.length).fill(Infinity)].sort((a: number, b: number) => a - b)[Math.floor(total / 2)] : null,
      },
      neverPct: { stages: Object.fromEntries(stages.map((id) => [id, Math.round((1 - yearsOf(id).length / total) * 1000) / 10])), milestones: Object.fromEntries(allMilestones.map((id) => [id, Math.round((1 - worlds.filter((w) => w.milestoneYear?.[id] !== undefined).length / total) * 1000) / 10]).filter(([, v]) => (v as number) > 0)) },
      blockers: Object.fromEntries(Object.entries(blockers).sort((a, b) => b[1] - a[1]).slice(0, 8)),
      functional: Object.fromEntries([150, 300].map((y) => [y, { techs: med(pick(y, "techs")), worldsLit: Math.round((pick(y, "lit").filter((n) => n > 0).length / total) * 1000) / 10, settlementsLit: avg(pick(y, "lit")), settlementsPowered: avg(pick(y, "powered")), settlementsLinked: avg(pick(y, "linked")), settlements: avg(pick(y, "settlements")) }])),
      specialization: { importsFoodPct: avg(worlds.map((w) => (w.importsFood / Math.max(1, w.activeSettlements)) * 100)), importsPartsPct: avg(worlds.map((w) => (w.importsParts / Math.max(1, w.activeSettlements)) * 100)), withDirectionPct: avg(worlds.map((w) => ((w.priorities?.filter((p) => p !== "none").length ?? 0) / Math.max(1, w.activeSettlements)) * 100)) },
      npcPlans: worlds[0]?.plans !== undefined && worlds.some((w) => w.plans) ? { proposed: avg(worlds.map((w) => w.plans?.proposed ?? 0)), approved: avg(worlds.map((w) => w.plans?.approved ?? 0)), rejected: avg(worlds.map((w) => w.plans?.rejected ?? 0)), failed: avg(worlds.map((w) => w.plans?.failed ?? 0)) } : null,
      projectYears: avg(worlds.map((w) => w.projectYears ?? 0)),
      survival: { worldsAliveAt300: worlds.filter((w) => ((w.at as unknown as Record<string, { pop: number }>)["300"]?.pop ?? 0) > 0).length, settlementsAbandoned: avg(worlds.map((w) => w.collapses)) },
      milestones: Object.fromEntries(CIV_STAGES.map((st) => { const v = worlds.map((w) => w.stageYear[st.id]).filter((x): x is number => x !== undefined); return [st.id, { reached: v.length, p10: q(v, 0.1), median: med(v), p90: q(v, 0.9) }]; })),
      trends: Object.fromEntries(CHECK.filter((y) => pick(y, "pop").length).map((y) => [y, { pop: med(pick(y, "pop")), popP10: q(pick(y, "pop"), 0.1), popP90: q(pick(y, "pop"), 0.9), techs: med(pick(y, "techs")), settlements: med(pick(y, "settlements")), facilities: med(pick(y, "facilities")), machines: med(pick(y, "machines")), foodPerHead: med(pick(y, "food")), materials: med(pick(y, "materials")), knowledge: med(pick(y, "knowledge")), parts: med(pick(y, "parts")), metal: med(pick(y, "metal")), ore: med(pick(y, "ore")), salvage: med(pick(y, "salvage")) }])),
      shortagePct: avg(worlds.map((w) => (w.shortage / Math.max(1, w.sy)) * 100)), lowMaterialsPct: avg(worlds.map((w) => (w.lowMat / Math.max(1, w.sy)) * 100)), noPartsPct: avg(worlds.map((w) => (w.noParts / Math.max(1, w.sy)) * 100)),
      raids: avg(worlds.map((w) => w.raids)), schisms: avg(worlds.map((w) => w.schisms)), collapses: avg(worlds.map((w) => w.collapses)), stalledProjects: avg(worlds.map((w) => w.stalled)),
      projectsDone: avg(worlds.map((w) => w.projectsDone)), projectsWithPlayerPct: avg(worlds.map((w) => (w.projectsWithPlayer / Math.max(1, w.projectsDone)) * 100)), workPlayer: avg(worlds.map((w) => w.workPlayer)), workNpc: avg(worlds.map((w) => w.workNpc)),
      salvageGoneMedian: med(worlds.map((w) => w.settledSalvageGoneAt).filter((x): x is number => x !== null)), salvageGoneWorlds: worlds.filter((w) => w.settledSalvageGoneAt !== null).length, oreGoneMedian: med(worlds.map((w) => w.oreGoneAt).filter((x): x is number => x !== null)), oreGoneWorlds: worlds.filter((w) => w.oreGoneAt !== null).length,
      crises: avg(worlds.map((w) => w.dips)), recoveryYearsMedian: med(worlds.flatMap((w) => w.recoveries)),
      facilitySimilarity: avg(worlds.map((w) => w.facilitySimilarity)), knowledgeCov: avg(worlds.map((w) => w.knowledgeCov)), professionSpread: avg(worlds.map((w) => w.professionSpread)),
      trade: avg(worlds.map((w) => Number(w.trade))), made: Object.fromEntries(["timber", "ore", "metal", "parts", "medicine"].map((g) => [g, avg(worlds.map((w) => Number((w.made as Record<string, number>)[g] ?? 0)))])),
      flow: worlds[0]?.flow ? Object.fromEntries(Object.keys(worlds[0].flow as object).map((k) => [k, avg(worlds.map((w) => Number((w.flow as unknown as Record<string, number>)[k] ?? 0)))])) : null,
      invariantFailures: worlds.reduce((n, w) => n + w.invariants, 0),
    };
  }
  writeFileSync(resolve(dir, "summary.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("merged", Object.keys(out).join(" "));
}

if (process.argv[2] === "--merge") merge(resolve(process.argv[3]!));
else {
  const name = process.argv[2]!;
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`Unknown scenario ${name}`);
  const seeds = Number(process.argv[3] ?? 100), years = Number(process.argv[4] ?? 300), dir = resolve(process.argv[5] ?? "docs/scenarios");
  const events = loadContentDir(resolve(import.meta.dirname, "../content")).events;
  mkdirSync(dir, { recursive: true });
  const worlds = [];
  for (let seed = 1; seed <= seeds; seed++) worlds.push(world(name, sc, seed, years, events));
  writeFileSync(resolve(dir, `${name}.worlds.json`), JSON.stringify(worlds));
  console.log("done", name);
}
