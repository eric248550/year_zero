/**
 * Run many seeded worlds and report population, extinction, the civilization
 * line and events that never fire. Each world has two players on autopilot
 * (they never answer, so their nature decides) who join a project of their own
 * trade, plus a surface-born farmer from year 10, so personal and profession
 * events are covered.
 *
 *   pnpm sim:report            # 100 worlds × 150 years
 *   pnpm sim:report 20 80      # 20 worlds × 80 years
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadContentDir } from "@genesis/narrative/node";
import { activeProjects, applyImmediate, checkInvariants, civilization, CIV_STAGES, createWorld, playerCharacter, stepWorld, workOptions } from "@genesis/simulation";
import { BRANCH_INFO, GOODS, TECHNOLOGIES, TECH_BY_ID, WORK_BY_ID, type WorldState } from "@genesis/schemas";

/** Players who show up: each joins a project of their own trade where they live, if there is one. */
/** A third player joins as a surface-born farmer once a surface settlement has stood for a year. */
function surfaceFarmer(s: WorldState): WorldState {
  if (s.players?.p3) return s;
  const r = applyImmediate(s, { type: "JOIN_WORLD", playerId: "p3", playerName: "p3", origin: "surface_born", profession: "Farmer" }, events);
  if (r.rejected) return s;
  let st = r.state;
  for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) st = applyImmediate(st, { type: "PROLOGUE", playerId: "p3", step, choiceId }).state;
  return st;
}

function joinProjects(s: WorldState): WorldState {
  for (const id of ["p1", "p2", "p3"]) {
    const me = playerCharacter(s, id);
    if (!me || activeProjects(s).some((p) => p.memberIds.includes(me.id))) continue;
    const p = activeProjects(s).find((x) => x.settlementId === me.homeId && BRANCH_INFO[TECH_BY_ID[x.techId]!.branch].profession === me.profession);
    if (p) { const r = applyImmediate(s, { type: "JOIN_PROJECT", playerId: id, projectId: p.id }, events); if (!r.rejected) s = r.state; }
  }
  return s;
}

/** Players who act: each year they fill their plan from their own profession's list, the same list the app shows. */
function planYear(s: WorldState): WorldState {
  for (const id of ["p1", "p2", "p3"]) {
    for (let i = 0; i < 4; i++) {
      const me = playerCharacter(s, id);
      if (!me) break;
      // Scouts are on the road every other year, so they are home for the rest of the story.
      if (me.profession === "Scout" && s.tick % 2 === 1) break;
      const pick = workOptions(s, me).flatMap((o) => (o.targets ? o.targets.filter((t) => !t.blocker).map((t) => ({ action: o.id, target: t.id as string | undefined })) : o.blocker ? [] : [{ action: o.id, target: undefined as string | undefined }]));
      if (pick.length === 0) break;
      // A different choice each time, from the state of the world (no extra randomness).
      const c = pick[(s.tick + i) % pick.length]!;
      const r = applyImmediate(s, { type: "START_WORK", playerId: id, action: c.action, ...(c.target ? { target: c.target } : {}) }, events);
      if (r.rejected) break;
      s = r.state;
    }
  }
  return s;
}

const SEEDS = Number(process.argv[2] ?? 100);
const YEARS = Number(process.argv[3] ?? 150);
const content = loadContentDir(resolve(import.meta.dirname, "../content"));
const events = content.events;

function withPlayers(s: WorldState): WorldState {
  for (const id of ["p1", "p2"]) {
    s = applyImmediate(s, { type: "JOIN_WORLD", playerId: id, playerName: id }).state;
    for (const [step, choiceId] of [["first_climb", "surface"], ["water", "share"], ["static", "tell"]] as const) s = applyImmediate(s, { type: "PROLOGUE", playerId: id, step, choiceId }).state;
  }
  return s;
}

const pct = (n: number, d: number) => `${Math.round((n / Math.max(1, d)) * 1000) / 10}%`;
const quant = (v: number[], q: number) => { const x = [...v].sort((a, b) => a - b); return x.length ? x[Math.min(x.length - 1, Math.floor(x.length * q))]! : null; };

const fired = new Map<string, number>();
const worldsFiring = new Map<string, number>();
const rejections = new Map<string, number>();
const stageYears: Record<string, number[]> = Object.fromEntries(CIV_STAGES.map((s) => [s.id, []]));
const milestoneDone: Record<string, number> = Object.fromEntries(CIV_STAGES.flatMap((s) => s.milestones.map((m) => [`${s.id}.${m.id}`, 0])));
const blockers = new Map<string, number>();
const stalls = new Map<string, number>();
let failed = 0, popGrew = 0, founded = 0, survived = 0;
const perWorldCounts = new Map<string, number[]>();
type WorldStats = { p1: string; techs: number; projectsSetAside: number; longProjects: number; proposals: Record<string, number>; sustainable: number; surface: number; materials: { salvage: number; timber: number; ore: number }; renewal: number | null; pop: number; settlements: number; raids: number; schisms: number; shortYears: number; starvedYears: number; seedlessYears: number; harvestFailures: number; fertility: number; settlementYears: number };
const worlds: WorldStats[] = [];
let w: WorldStats;
const popAt: Record<number, number[]> = {};
const checkpoints = [10, 30, 60, 100, YEARS];
let extinct = 0, everEmpty = 0, collapses = 0, raids = 0, schisms = 0, invariantFailures = 0, ticks = 0;
const minPop: number[] = [];
const t0 = Date.now();
const stageYearsThisWorld = new Map<string, number>();
let exhaustedSites = 0;
const techDone = new Map<string, number>();
const workDone: Record<string, { done: number; byPlayers: number }> = {};
const afterSalvage = { years: 0, stocked: 0, parts: 0 };
const made: Record<string, number> = {};
const endStock: Record<string, number[]> = {};
let worldsWithMetal = 0, worldsWithParts = 0;
const countsThisWorld = new Map<string, number>();

for (let seed = 1; seed <= SEEDS; seed++) {
  let s = withPlayers(createWorld({ seed }));
  w = { p1: playerCharacter(s, "p1")?.profession ?? "?", techs: 0, projectsSetAside: 0, longProjects: 0, proposals: {}, sustainable: 0, surface: 0, materials: { salvage: 0, timber: 0, ore: 0 }, renewal: null, pop: 0, settlements: 0, raids: 0, schisms: 0, shortYears: 0, starvedYears: 0, seedlessYears: 0, harvestFailures: 0, fertility: 0, settlementYears: 0 };
  const seen = new Set<string>();
  const done = new Set<string>();
  let low = Infinity;
  let wasEmpty = false;
  for (let y = 0; y < YEARS; y++) {
    if (y >= 10) s = surfaceFarmer(s);
    s = joinProjects(s);
    s = planYear(s);
    const r = stepWorld(s, { events, actions: [] });
    s = r.state;
    ticks++;
    if (checkInvariants(s, r.events).length) invariantFailures++;
    for (const e of r.events) {
      if (e.definitionId) {
        fired.set(e.definitionId, (fired.get(e.definitionId) ?? 0) + 1);
        countsThisWorld.set(e.definitionId, (countsThisWorld.get(e.definitionId) ?? 0) + 1);
        if (!seen.has(e.definitionId)) { seen.add(e.definitionId); worldsFiring.set(e.definitionId, (worldsFiring.get(e.definitionId) ?? 0) + 1); }
      }
      const work = e.trigger?.summary?.match(/^Work w-\d+: (\w+)$/)?.[1];
      if (work && e.characterIds[0]) { const k = `${WORK_BY_ID[work]!.profession}.${work}`; (workDone[k] ??= { done: 0, byPlayers: 0 }).done++; if (s.characters.find((c) => c.id === e.characterIds[0])?.controllerId) workDone[k]!.byPlayers++; }
      if (e.changes.some((c) => c.path.endsWith(".status") && c.after === "abandoned")) collapses++;
      if (e.title.includes("搶了")) { raids++; w.raids++; }
      if (e.title.includes("分裂了")) { schisms++; w.schisms++; }
      if (e.title.includes("歉收")) w.harvestFailures++;
      if (e.title.includes("被擱置")) w.projectsSetAside++;
    }
    for (const x of r.rejectedEvents) rejections.set(`${x.definitionId}: ${x.reason}`, (rejections.get(`${x.definitionId}: ${x.reason}`) ?? 0) + 1);
    const pop = s.characters.filter((c) => c.deathTick === null).length;
    low = Math.min(low, pop);
    for (const x of s.settlements.filter((z) => z.status === "active")) {
      const here = s.locations.find((l) => l.id === x.locationId);
      if ((here?.salvage ?? 1) <= 0) { afterSalvage.years++; if (x.resources.materials >= 15) afterSalvage.stocked++; if ((x.goods?.parts ?? 0) > 0) afterSalvage.parts++; }
      w.settlementYears++;
      if (x.shortage.food > 0 || x.shortage.water > 0) w.shortYears++;
      if (x.resources.materials < 15) w.starvedYears++;
      if (x.kind === "settlement" && (x.facilities?.fields ?? 0) >= 30 && (x.farm?.seeds ?? 0) < 3) w.seedlessYears++;
    }
    if (pop === 0) wasEmpty = true;
    for (const st of civilization(s).stages) if (st.done && !done.has(st.id)) { done.add(st.id); stageYears[st.id]!.push(s.tick); stageYearsThisWorld.set(st.id, s.tick); }
    if (checkpoints.includes(s.tick)) (popAt[s.tick] ??= []).push(pop);
  }
  minPop.push(low);
  w.renewal = stageYearsThisWorld.get("renewal") ?? null;
  if (s.stats.made?.metal) worldsWithMetal++;
  if (s.stats.made?.parts) worldsWithParts++;
  for (const [g, n] of Object.entries(s.stats.made ?? {})) made[g] = (made[g] ?? 0) + (n ?? 0);
  for (const g of GOODS) (endStock[g] ??= []).push(s.settlements.filter((z) => z.status === "active").reduce((n, z) => n + (z.goods?.[g] ?? 0), 0));
  w.techs = s.technologies.length;
  for (const t of s.technologies) techDone.set(t, (techDone.get(t) ?? 0) + 1);
  w.longProjects = (s.projects ?? []).filter((p) => s.tick - p.startedTick > 30).length;
  for (const p of s.proposals ?? []) w.proposals[p.status] = (w.proposals[p.status] ?? 0) + 1;
  const surfaceNow = s.settlements.filter((z) => z.status === "active" && z.kind === "settlement");
  w.surface = surfaceNow.length;
  w.sustainable = surfaceNow.filter((z) => (z.facilities?.lumber_camp ?? 0) >= 30 || (z.facilities?.mine ?? 0) >= 30).length;
  w.materials = s.stats.materialsBySource ?? { salvage: 0, timber: 0, ore: 0 };
  w.pop = s.characters.filter((c) => c.deathTick === null).length;
  w.settlements = s.settlements.filter((z) => z.status === "active").length;
  const farms = s.settlements.filter((z) => z.status === "active" && z.farm && z.kind === "settlement");
  w.fertility = farms.length ? farms.reduce((n, z) => n + z.farm!.fertility, 0) / farms.length : 0;
  exhaustedSites += s.locations.filter((l) => (l.salvage ?? 1) <= 0).length;
  worlds.push(w);
  // Milestones reached by the end, and what held back worlds that did not finish.
  const civ = civilization(s);
  for (const st of civ.stages) for (const m of st.milestones) if (m.done) milestoneDone[`${st.id}.${m.id}`]!++;
  if (civ.stage < CIV_STAGES.length) {
    failed++;
    const open = civ.stages[civ.stage]!;
    for (const m of open.milestones) if (!m.done) blockers.set(`${open.id}.${m.id}`, (blockers.get(`${open.id}.${m.id}`) ?? 0) + 1);
  }
  // A stage that took more than 40 years after the previous one counts as stalled.
  let prev = 0;
  for (const st of CIV_STAGES) {
    const year = stageYearsThisWorld.get(st.id);
    const end = year ?? YEARS;
    if (end - prev > 40) stalls.set(st.id, (stalls.get(st.id) ?? 0) + 1);
    if (year === undefined) break;
    prev = year;
  }
  stageYearsThisWorld.clear();
  if (s.characters.filter((c) => c.deathTick === null).length >= 120) popGrew++;
  const surface = s.settlements.filter((x) => x.kind === "settlement");
  founded += surface.length;
  survived += surface.filter((x) => x.status === "active").length;
  for (const [id, n] of countsThisWorld) (perWorldCounts.get(id) ?? perWorldCounts.set(id, []).get(id)!).push(n);
  countsThisWorld.clear();
  if (s.characters.every((c) => c.deathTick !== null)) extinct++;
  if (wasEmpty) everEmpty++;
}

const never = events.filter((d) => !fired.has(d.id)).map((d) => d.id);
const rare = events.filter((d) => fired.has(d.id) && (worldsFiring.get(d.id) ?? 0) < SEEDS * 0.05).map((d) => `${d.id} (${worldsFiring.get(d.id)} worlds)`);
const report = {
  worlds: SEEDS,
  years: YEARS,
  msPerYear: Math.round(((Date.now() - t0) / ticks) * 100) / 100,
  population: Object.fromEntries(Object.entries(popAt).map(([k, v]) => [`year ${k}`, { p10: quant(v, 0.1), median: quant(v, 0.5), p90: quant(v, 0.9) }])),
  lowestPopulation: { p10: quant(minPop, 0.1), median: quant(minPop, 0.5) },
  extinction: { worldsExtinctAtEnd: `${extinct}/${SEEDS} (${pct(extinct, SEEDS)})`, worldsEverEmpty: `${everEmpty}/${SEEDS}`, settlementCollapses: collapses },
  conflict: { raids, schisms },
  survival: {
    populationAtOrAboveStart: `${popGrew}/${SEEDS} (${pct(popGrew, SEEDS)})`,
    surfaceSettlementsFounded: founded,
    surfaceSettlementsStillStanding: `${survived}/${founded} (${pct(survived, founded)})`,
  },
  civilization: Object.fromEntries(CIV_STAGES.map((st) => {
    const v = stageYears[st.id]!;
    // Worlds that never finished a stage count as "after the last year" in the censored median.
    const censored = [...v, ...Array(SEEDS - v.length).fill(Infinity)];
    const m = quant(censored, 0.5);
    return [st.id, { reached: `${v.length}/${SEEDS} (${pct(v.length, SEEDS)})`, medianYearOfFinishedWorlds: quant(v, 0.5), medianYearAllWorlds: m === Infinity ? `not reached by ${YEARS}` : m, p90Year: quant(v, 0.9), stalledOver40Years: stalls.get(st.id) ?? 0 }];
  })),
  medianNote: "medianYearOfFinishedWorlds leaves out worlds that never reached the stage; medianYearAllWorlds counts them as not reached.",
  milestones: Object.fromEntries(Object.entries(milestoneDone).map(([k, n]) => [k, pct(n, SEEDS)])),
  unfinishedCivilizations: `${failed}/${SEEDS}`,
  commonBlockers: [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}: ${n} worlds`),
  events: {
    total: events.length,
    neverFired: never,
    firedInUnder5PercentOfWorlds: rare,
    mostRepeated: [...perWorldCounts.entries()].map(([id, v]) => [id, v.reduce((a, b) => a + b, 0) / SEEDS] as const).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `${id}: ${Math.round(n * 10) / 10} per world`),
  },
  scarcity: (() => {
    const sy = worlds.reduce((n, x) => n + x.settlementYears, 0);
    return {
      foodOrWaterShortage: pct(worlds.reduce((n, x) => n + x.shortYears, 0), sy) + " of settlement-years",
      materialsBelow15: pct(worlds.reduce((n, x) => n + x.starvedYears, 0), sy) + " of settlement-years",
      farmsWithoutSeed: pct(worlds.reduce((n, x) => n + x.seedlessYears, 0), sy) + " of settlement-years",
      harvestFailuresPerWorld: Math.round((worlds.reduce((n, x) => n + x.harvestFailures, 0) / SEEDS) * 10) / 10,
      salvageExhaustedSitesPerWorld: Math.round((exhaustedSites / SEEDS) * 100) / 100,
      averageSurfaceFertilityAtEnd: Math.round(worlds.reduce((n, x) => n + x.fertility, 0) / SEEDS),
    };
  })(),
  successVsSlow: (() => {
    const done = worlds.filter((x) => x.renewal !== null).map((x) => x.renewal!);
    const cut = quant(done, 0.5) ?? YEARS;
    const fast = worlds.filter((x) => x.renewal !== null && x.renewal <= cut);
    const slow = worlds.filter((x) => x.renewal === null || x.renewal > cut);
    const mean = (g: WorldStats[], k: keyof WorldStats) => g.length ? Math.round((g.reduce((n, x) => n + Number(x[k] ?? 0), 0) / g.length) * 10) / 10 : null;
    const share = (g: WorldStats[], k: "shortYears" | "starvedYears" | "seedlessYears") => g.length ? pct(g.reduce((n, x) => n + x[k], 0), g.reduce((n, x) => n + x.settlementYears, 0)) : null;
    const describe = (g: WorldStats[]) => ({ worlds: g.length, populationAtEnd: mean(g, "pop"), settlements: mean(g, "settlements"), raids: mean(g, "raids"), schisms: mean(g, "schisms"), harvestFailures: mean(g, "harvestFailures"), shortage: share(g, "shortYears"), materialsStarved: share(g, "starvedYears"), seedless: share(g, "seedlessYears") });
    return { split: `renewal by year ${cut} vs later or never`, fast: describe(fast), slow: describe(slow) };
  })(),
  production: (() => {
    const tot = worlds.reduce((n, x) => ({ salvage: n.salvage + x.materials.salvage, timber: n.timber + x.materials.timber, ore: n.ore + x.materials.ore }), { salvage: 0, timber: 0, ore: 0 });
    const all = tot.salvage + tot.timber + tot.ore;
    return {
      materialsBySource: { salvage: pct(tot.salvage, all), timber: pct(tot.timber, all), ore: pct(tot.ore, all) },
      surfaceSettlementsWithOwnExtraction: pct(worlds.reduce((n, x) => n + x.sustainable, 0), worlds.reduce((n, x) => n + x.surface, 0)),
      note: "Own extraction = a working lumber camp or mine at year " + YEARS + ".",
      manufacturedPerWorld: Object.fromEntries(Object.entries(made).map(([g, n]) => [g, Math.round(n / SEEDS)])),
      worldsThatSmeltedMetal: `${worldsWithMetal}/${SEEDS}`,
      worldsThatMadeParts: `${worldsWithParts}/${SEEDS}`,
      stockAtEndMedian: Object.fromEntries(Object.entries(endStock).map(([g, v]) => [g, Math.round(quant(v, 0.5) ?? 0)])),
      afterLocalSalvageRanOut: { settlementYears: afterSalvage.years, keptMaterials15OrMore: pct(afterSalvage.stocked, afterSalvage.years), hadToolsAndComponents: pct(afterSalvage.parts, afterSalvage.years) },
    };
  })(),
  projects: {
    setAsidePerWorld: Math.round((worlds.reduce((n, x) => n + x.projectsSetAside, 0) / SEEDS) * 10) / 10,
    runningOver30YearsAtEnd: worlds.reduce((n, x) => n + x.longProjects, 0),
    technologiesNeverFinished: TECHNOLOGIES.filter((t) => !techDone.has(t.id)).map((t) => t.id),
    technologiesFinishedInUnderHalfOfWorlds: TECHNOLOGIES.filter((t) => (techDone.get(t.id) ?? 0) < SEEDS / 2).map((t) => `${t.id} (${techDone.get(t.id) ?? 0})`),
  },
  proposals: (() => {
    const by: Record<string, number> = {};
    for (const x of worlds) for (const [k, n] of Object.entries(x.proposals)) by[k] = (by[k] ?? 0) + n;
    return { ...by, note: "Recent proposals kept in each world (up to 40 settled); conflicting proposals are refused before they are made and two open ones for the same thing never coexist (checked every year by the invariants)." };
  })(),
  byFirstPlayerProfession: (() => {
    const groups = new Map<string, WorldStats[]>();
    for (const x of worlds) (groups.get(x.p1) ?? groups.set(x.p1, []).get(x.p1)!).push(x);
    return Object.fromEntries([...groups.entries()].map(([k, g]) => [k, {
      worlds: g.length,
      renewalMedian: quant(g.filter((x) => x.renewal !== null).map((x) => x.renewal!), 0.5),
      populationAtEnd: Math.round(g.reduce((n, x) => n + x.pop, 0) / g.length),
      technologies: Math.round((g.reduce((n, x) => n + x.techs, 0) / g.length) * 10) / 10,
      proposalsExecuted: Math.round((g.reduce((n, x) => n + (x.proposals.executed ?? 0), 0) / g.length) * 10) / 10,
    }]));
  })(),
  work: { note: "Completed work per world, all characters and those played by the three test players", ...Object.fromEntries(Object.entries(workDone).sort().map(([k, v]) => [k, { perWorld: Math.round((v.done / SEEDS) * 10) / 10, byPlayersPerWorld: Math.round((v.byPlayers / SEEDS) * 10) / 10 }])) },
  topRejections: [...rejections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${n}× ${k}`),
  invariantFailures,
};
const out = resolve(import.meta.dirname, "../docs/sim-report.json");
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`\nWritten to ${out}`);
