/**
 * Batch simulation report: runs many seeded histories headlessly (no DB, no LLM)
 * and prints a concise summary.
 *
 *   pnpm sim:run                       # 25 seeds x 150 ticks, balanced policy
 *   pnpm sim:run --seeds 100 --ticks 200 --policy expansionist
 *   pnpm sim:run --all-policies --json report.json
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POLICIES, TECHNOLOGIES, type PolicyId } from "@genesis/schemas";
import { loadContentDir } from "@genesis/narrative/node";
import { runHeadless, type HeadlessRunResult } from "@genesis/simulation";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const seeds = Number(arg("seeds", "25"));
const ticks = Number(arg("ticks", "150"));
const startSeed = Number(arg("start", "1"));
const allPolicies = process.argv.includes("--all-policies");
const policies: PolicyId[] = allPolicies ? [...POLICIES] : [(arg("policy", "balanced") as PolicyId)];
const jsonOut = arg("json");

const content = loadContentDir(resolve(import.meta.dirname, "../content"));
if (content.problems.length) {
  console.error("Content problems:", JSON.stringify(content.problems, null, 2));
  process.exit(1);
}

const pct = (n: number, d: number) => `${((n / Math.max(1, d)) * 100).toFixed(0)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

const report: Record<string, unknown>[] = [];
let totalViolations = 0;

for (const policy of policies) {
  const runs: HeadlessRunResult[] = [];
  const t0 = performance.now();
  for (let i = 0; i < seeds; i++) runs.push(runHeadless({ seed: startSeed + i, ticks, policy, events: content.events }));
  const elapsed = performance.now() - t0;

  const finals = runs.map((r) => r.metrics.at(-1)!);
  const collapsed = finals.filter((m) => m.population === 0).length;
  const violations = runs.flatMap((r) => r.violations.map((v) => ({ seed: r.seed, ...v })));
  totalViolations += violations.length;
  const eventFreq = new Map<string, number>();
  for (const r of runs) for (const h of r.history) if (h.definitionId) eventFreq.set(h.definitionId, (eventFreq.get(h.definitionId) ?? 0) + 1);
  const neverFired = content.events.map((e) => e.id).filter((id) => !eventFreq.has(id));

  console.log(`\n━━ Policy: ${policy} — ${seeds} seeds × ${ticks} ticks (${elapsed.toFixed(0)} ms, ${(elapsed / seeds).toFixed(0)} ms/run)`);
  console.log(`  Outcome          survived ${seeds - collapsed}/${seeds} (${pct(seeds - collapsed, seeds)})  collapsed ${collapsed}`);
  console.log(`  Final population median ${median(finals.map((m) => m.population))}  mean ${mean(finals.map((m) => m.population)).toFixed(1)}  min ${Math.min(...finals.map((m) => m.population))}  max ${Math.max(...finals.map((m) => m.population))}`);
  console.log(`  Peak population  mean ${mean(runs.map((r) => r.final.stats.peakPopulation)).toFixed(1)}`);
  console.log(`  Settlements      mean ${mean(finals.map((m) => m.settlements)).toFixed(2)}  max ${Math.max(...finals.map((m) => m.settlements))}`);
  console.log(`  Technologies     mean ${mean(finals.map((m) => m.technologies)).toFixed(1)}/${TECHNOLOGIES.length}  median ${median(finals.map((m) => m.technologies))}`);
  const shortageTicks = runs.map((r) => r.metrics.filter((m) => m.status === "crisis").length);
  console.log(`  Crisis ticks     mean ${mean(shortageTicks).toFixed(1)} of ${ticks}`);
  console.log(`  Status at end    ${Object.entries(finals.reduce<Record<string, number>>((acc, m) => ((acc[m.status] = (acc[m.status] ?? 0) + 1), acc), {})).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  console.log(`  Narrative events ${[...eventFreq.values()].reduce((a, b) => a + b, 0)} total, ${(mean(runs.map((r) => r.history.filter((h) => h.kind === "narrative").length))).toFixed(1)}/run; rejected at runtime ${runs.reduce((a, r) => a + r.rejectedEvents, 0)}`);
  console.log("  Event frequency (per run):");
  for (const [id, n] of [...eventFreq.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${id.padEnd(28)} ${(n / seeds).toFixed(2)}`);
  if (neverFired.length) console.log(`  Never fired: ${neverFired.join(", ")}`);
  console.log(`  Invariant violations: ${violations.length}`);
  for (const v of violations.slice(0, 10)) console.log(`    seed ${v.seed} tick ${v.tick}: ${v.message}`);

  report.push({
    policy, seeds, ticks, collapsed,
    finals: runs.map((r) => ({ seed: r.seed, ...r.metrics.at(-1)!, technologiesList: r.final.technologies })),
    eventFrequency: Object.fromEntries(eventFreq), violations,
  });
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${jsonOut}`);
}
process.exit(totalViolations > 0 ? 1 : 0);
