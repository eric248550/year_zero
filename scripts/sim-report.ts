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
import { activeProjects, applyImmediate, checkInvariants, civilization, CIV_STAGES, createWorld, playerCharacter, stepWorld } from "@genesis/simulation";
import { BRANCH_INFO, TECH_BY_ID, type WorldState } from "@genesis/schemas";

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
type WorldStats = { renewal: number | null; pop: number; settlements: number; raids: number; schisms: number; shortYears: number; starvedYears: number; seedlessYears: number; harvestFailures: number; fertility: number; settlementYears: number };
const worlds: WorldStats[] = [];
let w: WorldStats;
const popAt: Record<number, number[]> = {};
const checkpoints = [10, 30, 60, 100, YEARS];
let extinct = 0, everEmpty = 0, collapses = 0, raids = 0, schisms = 0, invariantFailures = 0, ticks = 0;
const minPop: number[] = [];
const t0 = Date.now();
const stageYearsThisWorld = new Map<string, number>();
let exhaustedSites = 0;
const countsThisWorld = new Map<string, number>();

for (let seed = 1; seed <= SEEDS; seed++) {
  let s = withPlayers(createWorld({ seed }));
  w = { renewal: null, pop: 0, settlements: 0, raids: 0, schisms: 0, shortYears: 0, starvedYears: 0, seedlessYears: 0, harvestFailures: 0, fertility: 0, settlementYears: 0 };
  const seen = new Set<string>();
  const done = new Set<string>();
  let low = Infinity;
  let wasEmpty = false;
  for (let y = 0; y < YEARS; y++) {
    if (y >= 10) s = surfaceFarmer(s);
    s = joinProjects(s);
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
      if (e.changes.some((c) => c.path.endsWith(".status") && c.after === "abandoned")) collapses++;
      if (e.title.includes("搶了")) { raids++; w.raids++; }
      if (e.title.includes("分裂了")) { schisms++; w.schisms++; }
      if (e.title.includes("歉收")) w.harvestFailures++;
    }
    for (const x of r.rejectedEvents) rejections.set(`${x.definitionId}: ${x.reason}`, (rejections.get(`${x.definitionId}: ${x.reason}`) ?? 0) + 1);
    const pop = s.characters.filter((c) => c.deathTick === null).length;
    low = Math.min(low, pop);
    for (const x of s.settlements.filter((z) => z.status === "active")) {
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
  topRejections: [...rejections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${n}× ${k}`),
  invariantFailures,
};
const out = resolve(import.meta.dirname, "../docs/sim-report.json");
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`\nWritten to ${out}`);
