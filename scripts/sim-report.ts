/**
 * Run many seeded worlds and report population, extinction, the civilization
 * line and events that never fire. Each world has two players on autopilot
 * (they never answer, so their nature decides) who join a project of their own
 * trade, so personal and profession events are covered.
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
function joinProjects(s: WorldState): WorldState {
  for (const id of ["p1", "p2"]) {
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
const popAt: Record<number, number[]> = {};
const checkpoints = [10, 30, 60, 100, YEARS];
let extinct = 0, everEmpty = 0, collapses = 0, raids = 0, schisms = 0, invariantFailures = 0, ticks = 0;
const minPop: number[] = [];
const t0 = Date.now();
const stageYearsThisWorld = new Map<string, number>();
const countsThisWorld = new Map<string, number>();

for (let seed = 1; seed <= SEEDS; seed++) {
  let s = withPlayers(createWorld({ seed }));
  const seen = new Set<string>();
  const done = new Set<string>();
  let low = Infinity;
  let wasEmpty = false;
  for (let y = 0; y < YEARS; y++) {
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
      if (e.title.includes("搶了")) raids++;
      if (e.title.includes("分裂了")) schisms++;
    }
    for (const x of r.rejectedEvents) rejections.set(`${x.definitionId}: ${x.reason}`, (rejections.get(`${x.definitionId}: ${x.reason}`) ?? 0) + 1);
    const pop = s.characters.filter((c) => c.deathTick === null).length;
    low = Math.min(low, pop);
    if (pop === 0) wasEmpty = true;
    for (const st of civilization(s).stages) if (st.done && !done.has(st.id)) { done.add(st.id); stageYears[st.id]!.push(s.tick); stageYearsThisWorld.set(st.id, s.tick); }
    if (checkpoints.includes(s.tick)) (popAt[s.tick] ??= []).push(pop);
  }
  minPop.push(low);
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
  topRejections: [...rejections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${n}× ${k}`),
  invariantFailures,
};
const out = resolve(import.meta.dirname, "../docs/sim-report.json");
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`\nWritten to ${out}`);
