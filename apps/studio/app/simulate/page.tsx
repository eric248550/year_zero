import Link from "next/link";
import { Activity, FlaskConical, GitCompareArrows, History, Plus } from "lucide-react";
import { LOCATION_BY_ID, Rng, TECHNOLOGIES } from "@genesis/schemas";
import { activeSettlements } from "@genesis/narrative";
import { TickContext, currentResearchTarget, worldStatus } from "@genesis/simulation";
import { getMetrics, listDecisions, listRuns, listSnapshots } from "@genesis/database";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Pill, SectionTitle, StatusDot, statusTone } from "@/components/ui";
import { StepControls } from "@/components/step-controls";
import { ActivateRunButton, CreateRunForm, RunManagement, SeedContentButton } from "@/components/forms";
import { ActionComposer } from "@/components/action-composer";
import { describeAction } from "@/lib/describe-action";
import { getI18n } from "@/lib/i18n/server";
import { contentStats, db, loadActiveRun } from "@/lib/server";
import type { PlayerAction } from "@genesis/schemas";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.simulate") };
}

export default async function SimulatePage() {
  const { t, term, relativeTime } = await getI18n();
  const run = loadActiveRun();
  const runs = listRuns(db());
  const stats = contentStats();

  return (
    <div>
      <PageHeader eyebrow={t("sim.eyebrow")} title={t("sim.title")} description={t("sim.description")} />

      {stats.published === 0 && (
        <div className="mb-4">
          <EmptyState title={t("sim.noPublished")} action={<SeedContentButton />}>{t("sim.noPublishedBody")}</EmptyState>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {run ? <ActiveRun run={run} /> : (
            <EmptyState icon={<Activity />} title={t("common.noActiveRun")}>{t("sim.noActiveRunBody")}</EmptyState>
          )}

          <Card>
            <CardHeader title={t("sim.allRuns")} subtitle={t("sim.timelines", { count: runs.length })} icon={<History size={16} />} action={runs.length >= 2 ? <LinkButton href="/compare" size="sm"><GitCompareArrows size={14} /> {t("nav.compare")}</LinkButton> : undefined} />
            {runs.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("sim.noRuns")}</p> : (
              <ul className="divide-y divide-line">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{r.name}</span>
                        {r.id === run?.summary.id && <Pill tone="signal">{term.status("active")}</Pill>}
                        {r.status === "archived" && <Pill>{term.status("archived")}</Pill>}
                      </div>
                      <div className="num mt-0.5 truncate text-[12px] text-ink-3">
                        {t("sim.runLine", { seed: r.seed, policy: term.policy(r.policy), year: r.year, tick: r.currentTick, population: r.population, tech: r.technologies })}
                        {r.parentRunId && ` · ${t("sim.forkAt", { tick: r.forkedFromTick ?? 0 })}`} · {relativeTime(r.updatedAt)}
                      </div>
                    </div>
                    {r.id !== run?.summary.id && <ActivateRunButton id={r.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t("sim.createWorld")} subtitle={t("sim.createWorldSub")} icon={<Plus size={16} />} />
            <div className="px-4 pb-4"><CreateRunForm defaultSeed={2131} /></div>
          </Card>
          {run && (
            <Card>
              <CardHeader title={t("sim.management")} subtitle={t("sim.managementSub")} />
              <div className="px-4 pb-4">
                <RunManagement runId={run.summary.id} archived={run.summary.status === "archived"} currentTick={run.state.tick} snapshotTicks={listSnapshots(db(), run.summary.id).map((s) => s.tick)} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

async function ActiveRun({ run }: { run: NonNullable<ReturnType<typeof loadActiveRun>> }) {
  const i18n = await getI18n();
  const { t, term } = i18n;
  const { state, summary } = run;
  const status = worldStatus(state);
  const metrics = getMetrics(db(), summary.id);
  const last = metrics.at(-1);
  const decisions = listDecisions(db(), summary.id).slice(-5).reverse();
  const snapshots = listSnapshots(db(), summary.id);
  const settlements = activeSettlements(state).map((s) => ({ id: s.id, name: s.name }));
  const sites = state.locations
    .filter((l) => l.discovered && !l.settlementId && LOCATION_BY_ID[l.id]?.settleable)
    .map((l) => ({ id: l.id, name: LOCATION_BY_ID[l.id]!.name }));
  const techs = TECHNOLOGIES.filter((t) => !state.technologies.includes(t.id) && t.prerequisites.every((p) => state.technologies.includes(p))).map((x) => ({ id: x.id, name: `${term.techName(x.id)} (${x.cost})` }));
  const target = currentResearchTarget(new TickContext(structuredClone(state), new Rng(0)));
  const rejectedLast = (last?.rejectedEvents as { definitionId: string; reason: string }[] | undefined) ?? [];

  return (
    <>
      <Card>
        <CardHeader
          title={summary.name}
          subtitle={<span className="num">{t("common.seed")} {summary.seed} · {summary.rulesVersion} · {summary.contentVersion}</span>}
          action={<span className="flex items-center gap-2"><StatusDot status={status} /><Pill tone={statusTone(status)}>{term.status(status)}</Pill></span>}
        />
        <div className="space-y-4 px-4 pb-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini label={t("common.year")} value={state.startYear + state.tick} />
            <Mini label={t("common.tick")} value={state.tick} />
            <Mini label={t("sim.execPerTick")} value={last ? `${last.execMs} ms` : "—"} />
          </div>
          <p className="text-[12px] text-ink-3">
            {t("sim.timeNote")}
          </p>
          <StepControls runId={summary.id} disabled={summary.status !== "active"} />
          {summary.status !== "active" && <p className="text-sm text-warn">{t("sim.archivedNote")}</p>}
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <FlaskConical size={14} className="text-knowledge" />
            {t("sim.researching")} <span className="text-ink">{target ? term.techName(target.id) : t("sim.nothingAvailable")}</span>
            {state.researchFocus && <Pill tone="knowledge">{t("sim.developerFocus")}</Pill>}
          </div>
          {rejectedLast.length > 0 && (
            <div className="rounded-xl border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] text-warn">
              {t("sim.lastRejected", { count: rejectedLast.length })} {rejectedLast.map((r) => `${r.definitionId} (${r.reason})`).join("; ")}
            </div>
          )}
        </div>
      </Card>

      {summary.status === "active" && (
        <Card>
          <CardHeader title={t("sim.devActions")} subtitle={t("sim.devActionsSub")} />
          <div className="px-4 pb-4">
            <ActionComposer runId={summary.id} queue={run.queuedActions} settlements={settlements} sites={sites} techs={techs} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t("sim.replayLog")} subtitle={t("sim.replayLogSub", { count: snapshots.length })} />
        <div className="px-4 pb-4">
          <div className="scroll-x num pb-1 text-[11px]">
            {snapshots.map((s) => (
              <Link key={s.tick} href={`/world?tick=${s.tick}`} className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-ink-2 hover:text-signal" title={`${t("sim.hash")} ${s.hash}`}>
                t{s.tick}
              </Link>
            ))}
          </div>
          <SectionTitle>{t("sim.recentDecisions")}</SectionTitle>
          {decisions.length === 0 ? <p className="text-[13px] text-ink-3">{t("sim.noDecisions")}</p> : (
            <ul className="space-y-1 text-[13px]">
              {decisions.map((d) => (
                <li key={d.id} className="text-ink-2">
                  <span className="num text-ink-3">t{d.tick}</span>{" "}
                  {(d.actions as PlayerAction[]).map((a) => describeAction(a, i18n)).join(", ") || "—"}
                  {Object.keys(d.choiceOverrides).length > 0 && <span className="text-ink-3"> · {t("sim.overrides", { count: Object.keys(d.choiceOverrides).length })}</span>}
                  {(d.rejected as unknown[]).length > 0 && <span className="text-warn"> · {t("sim.rejectedCount", { count: (d.rejected as unknown[]).length })}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/70 px-2 py-2">
      <div className="label-xs truncate">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
