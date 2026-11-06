import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import { compareRuns, listRuns } from "@genesis/database";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Pill, buttonClass, importanceTone } from "@/components/ui";
import { CompareChart } from "@/components/charts";
import { CHART } from "@/lib/chart-palette";
import { db } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("compare.title") };
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t, term } = await getI18n();
  const runs = listRuns(db());
  if (runs.length < 2) {
    return (
      <div>
        <PageHeader eyebrow={t("compare.eyebrow")} title={t("compare.title")} />
        <EmptyState icon={<GitCompareArrows />} title={t("compare.needTwo")} action={<LinkButton href="/simulate" variant="primary">{t("compare.createAnother")}</LinkButton>}>
          {t("compare.needTwoBody")}
        </EmptyState>
      </div>
    );
  }
  const aId = one(sp.a) ?? runs[0]!.id;
  const bId = one(sp.b) ?? runs.find((r) => r.id !== aId)!.id;
  const valid = runs.some((r) => r.id === aId) && runs.some((r) => r.id === bId);
  const cmp = valid ? compareRuns(db(), aId, bId) : null;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t("compare.eyebrow")} title={t("compare.title")} description={t("compare.description")} />
      <form method="get" action="/compare" className="card grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="block min-w-0"><span className="label-xs" style={{ color: CHART.runA }}>{t("compare.runA")} ━</span>
          <select className="field mt-1" name="a" defaultValue={aId}>{runs.map((r) => <option key={r.id} value={r.id}>{r.name} ({t("common.seed")} {r.seed}, t{r.currentTick})</option>)}</select>
        </label>
        <label className="block min-w-0"><span className="label-xs" style={{ color: CHART.runB }}>{t("compare.runB")} ╍</span>
          <select className="field mt-1" name="b" defaultValue={bId}>{runs.map((r) => <option key={r.id} value={r.id}>{r.name} ({t("common.seed")} {r.seed}, t{r.currentTick})</option>)}</select>
        </label>
        <button type="submit" className={buttonClass("primary", "md", "sm:mt-[22px]")}>{t("nav.compare")}</button>
      </form>

      {!cmp ? <EmptyState title={t("compare.pickTwo")} /> : (
        <>
          {aId === bId && <p className="text-sm text-warn">{t("compare.same")}</p>}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="label-xs px-3 py-2 font-semibold">{t("compare.metric")}</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold" style={{ color: CHART.runA }}>A</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold" style={{ color: CHART.runB }}>B</th>
                  </tr>
                </thead>
                <tbody className="num divide-y divide-line">
                  {([
                    [t("common.seed"), cmp.a.summary.seed, cmp.b.summary.seed],
                    [t("compare.policy"), term.policy(cmp.a.summary.policy), term.policy(cmp.b.summary.policy)],
                    [t("compare.tickYear"), `${cmp.a.summary.currentTick} / ${cmp.a.summary.year}`, `${cmp.b.summary.currentTick} / ${cmp.b.summary.year}`],
                    [t("overview.population"), cmp.a.summary.population, cmp.b.summary.population],
                    [t("compare.peak"), cmp.a.peakPopulation, cmp.b.peakPopulation],
                    [t("overview.settlements"), cmp.a.summary.settlements, cmp.b.summary.settlements],
                    [t("overview.technologies"), cmp.a.summary.technologies, cmp.b.summary.technologies],
                    [t("compare.birthsDeaths"), `${cmp.a.births} / ${cmp.a.deaths}`, `${cmp.b.births} / ${cmp.b.deaths}`],
                    ...(["food", "water", "materials", "knowledge"] as const).map((r) => [term.resource(r), cmp.a.resources[r], cmp.b.resources[r]]),
                    [t("compare.secrets"), cmp.a.secrets.length, cmp.b.secrets.length],
                  ] as [string, string | number, string | number][]).map(([k, a, b]) => (
                    <tr key={k}>
                      <td className="px-3 py-2 font-sans text-ink-3">{k}</td>
                      <td className={`px-3 py-2 text-right ${typeof a === "number" && typeof b === "number" && a > b ? "text-ink" : "text-ink-2"}`}>{a}</td>
                      <td className={`px-3 py-2 text-right ${typeof a === "number" && typeof b === "number" && b > a ? "text-ink" : "text-ink-2"}`}>{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("compare.popByTick")} />
              <div className="px-2 pb-3"><CompareChart data={cmp.series} dataKeyA="a" dataKeyB="b" nameA={t("compare.runA")} nameB={t("compare.runB")} /></div>
            </Card>
            <Card>
              <CardHeader title={t("compare.techByTick")} />
              <div className="px-2 pb-3"><CompareChart data={cmp.series} dataKeyA="aTech" dataKeyB="bTech" nameA={t("compare.runA")} nameB={t("compare.runB")} /></div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("compare.techDiff")} />
              <div className="space-y-2 px-4 pb-4 text-sm">
                <div><span className="label-xs" style={{ color: CHART.runA }}>{t("compare.onlyA")}</span><div className="mt-1 flex flex-wrap gap-1">{cmp.diff.techOnlyA.length ? cmp.diff.techOnlyA.map((id) => <Pill key={id}>{term.techName(id)}</Pill>) : <span className="text-ink-3">—</span>}</div></div>
                <div><span className="label-xs" style={{ color: CHART.runB }}>{t("compare.onlyB")}</span><div className="mt-1 flex flex-wrap gap-1">{cmp.diff.techOnlyB.length ? cmp.diff.techOnlyB.map((id) => <Pill key={id}>{term.techName(id)}</Pill>) : <span className="text-ink-3">—</span>}</div></div>
                <div><span className="label-xs">{t("compare.flagsDiff")}</span><div className="num mt-1 text-[12px] text-ink-2">{cmp.diff.flagsOnlyA.join(", ") || "—"} / {cmp.diff.flagsOnlyB.join(", ") || "—"}</div></div>
              </div>
            </Card>
            <Card>
              <CardHeader title={t("compare.narrativeDiff")} subtitle={t("compare.narrativeDiffSub")} />
              {cmp.diff.narrative.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("compare.identical")}</p> : (
                <ul className="num divide-y divide-line text-[13px]">
                  {cmp.diff.narrative.map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-2 px-4 py-2">
                      <Link href={`/content/events/${n.id}`} className="truncate font-sans text-ink-2 hover:text-signal">{n.id}</Link>
                      <span className="shrink-0"><span style={{ color: CHART.runA }}>{n.a}</span> <span className="text-ink-3">{t("compare.vs")}</span> <span style={{ color: CHART.runB }}>{n.b}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {(["a", "b"] as const).map((side) => (
              <Card key={side}>
                <CardHeader title={<span style={{ color: side === "a" ? CHART.runA : CHART.runB }}>{t("compare.milestones", { run: side === "a" ? t("compare.runA") : t("compare.runB") })}</span>} subtitle={cmp[side].summary.name} />
                <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                  {cmp[side].milestones.length === 0 && <li className="px-4 py-3 text-sm text-ink-3">{t("compare.noMilestones")}</li>}
                  {cmp[side].milestones.map((m) => (
                    <li key={m.id} className="flex items-start gap-3 px-4 py-2 text-[13px]">
                      <span className="num w-10 shrink-0 text-ink-3">{m.year}</span>
                      <span className="min-w-0 flex-1 text-ink-2">{m.title}</span>
                      <Pill tone={importanceTone(m.importance as "major")}>{term.importance(m.importance)}</Pill>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
