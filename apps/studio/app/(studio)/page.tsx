import Link from "next/link";
import { BookOpen, Radio, Sparkles, Users } from "lucide-react";
import { LOCATIONS, RESOURCES, SECRETS, TECHNOLOGIES } from "@genesis/schemas";
import { activeSettlements, currentYear, population, totalResource } from "@genesis/narrative";
import { currentResearchTarget, TickContext, worldEra, worldStatus } from "@genesis/simulation";
import { Rng } from "@genesis/schemas";
import { getMetrics, getRunContent, queryHistory } from "@genesis/database";
import { Card, CardHeader, EmptyState, LinkButton, Pill, ProgressBar, SectionTitle, Stat, StatusDot, statusTone } from "@/components/ui";
import { EventRow, ResourceTile } from "@/components/domain";
import { PopulationChart, ResourceChart } from "@/components/charts";
import { StepControls } from "@/components/step-controls";
import { SeedContentButton } from "@/components/forms";
import { contentStats, db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { t, term } = await getI18n();
  const stats = contentStats();
  const run = loadActiveRun();

  if (!run) {
    return (
      <div className="space-y-4">
        <Hero />
        {stats.published === 0 ? (
          <EmptyState icon={<BookOpen />} title={t("overview.noContent")} action={<SeedContentButton />}>
            {t("overview.noContentBody")} <code className="num">pnpm db:seed</code>
          </EmptyState>
        ) : (
          <EmptyState icon={<Radio />} title={t("overview.noRun")} action={<LinkButton href="/simulate" variant="primary">{t("overview.createWorld")}</LinkButton>}>
            {t("overview.noRunBody")}
          </EmptyState>
        )}
      </div>
    );
  }

  const { state, summary } = run;
  const metrics = getMetrics(db(), summary.id);
  const recent = queryHistory(db(), summary.id, { minImportance: "notable", limit: 6 }).items;
  const content = getRunContent(db(), summary.id);
  const status = worldStatus(state);
  const era = worldEra(state);
  const pop = population(state);
  const prev = metrics.at(-2);
  const series = metrics.map((m) => ({ tick: m.tick, year: m.year, population: m.population, food: m.food, water: m.water, materials: m.materials, knowledge: m.knowledge }));
  const settlements = activeSettlements(state);
  const discovered = state.locations.filter((l) => l.discovered).length;
  const research = currentResearchTarget(new TickContext(structuredClone(state), new Rng(0)));
  const knowledge = totalResource(state, "knowledge");
  const alive = state.characters.filter((c) => c.deathTick === null);

  const storylineProgress = content.storylines.map((s) => {
    const ids = new Set(s.beats.flatMap((b) => b.eventIds));
    const fired = [...ids].filter((id) => (state.eventMemory.counts[id] ?? 0) > 0).length;
    return { id: s.id, title: s.title, fired, total: ids.size };
  });

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-signal/10 blur-3xl" />
        <div className="relative p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <Pill tone={statusTone(status)}>{term.status(status)}</Pill>
            <Pill tone="neutral">{t("overview.era", { era: term.eraName(era.name) })}</Pill>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label-xs">{state.worldName} · {summary.name}</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="num text-5xl font-semibold tracking-tight text-ink">{currentYear(state)}</span>
                <span className="num text-sm text-ink-3">{t("common.tickN", { n: state.tick })}</span>
              </div>
              <p className="mt-1 text-sm text-ink-2">{term.eraDescription(era.name)}</p>
            </div>
            <div className="num text-xs text-ink-3">{t("overview.seedPolicy", { seed: summary.seed, policy: term.policyName(summary.policy) })}</div>
          </div>
          <div className="mt-4">
            <StepControls runId={summary.id} disabled={summary.status !== "active"} compact />
            {summary.status !== "active" && <p className="mt-2 text-xs text-warn">{t("overview.archived")}</p>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("overview.population")} value={pop} hint={prev ? t("overview.lastTick", { delta: `${pop - prev.population >= 0 ? "+" : ""}${pop - prev.population}` }) : t("overview.children", { n: alive.filter((c) => c.profession === null).length })} />
        <Stat label={t("overview.settlements")} value={settlements.length} hint={t("overview.sitesKnown", { n: discovered, total: LOCATIONS.length })} />
        <Stat label={t("overview.technologies")} value={`${state.technologies.length}/${TECHNOLOGIES.length}`} hint={research ? t("overview.next", { tech: term.techName(research.id) }) : t("overview.treeComplete")} />
        <Stat label={t("overview.birthsDeaths")} value={`${state.stats.births} · ${state.stats.deaths}`} hint={t("overview.peak", { n: state.stats.peakPopulation })} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RESOURCES.map((r) => (
          <ResourceTile key={r} resource={r} value={totalResource(state, r)} perCapita={pop > 0 ? totalResource(state, r) / pop : 0} delta={prev ? totalResource(state, r) - prev[r] : undefined} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("overview.population")} subtitle={t("overview.populationSub")} icon={<Users size={16} />} />
          <div className="px-2 pb-3"><PopulationChart data={series} /></div>
        </Card>
        <Card>
          <CardHeader title={t("overview.resources")} subtitle={t("overview.resourcesSub")} />
          <div className="px-2 pb-3"><ResourceChart data={series} /></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t("overview.recent")} subtitle={t("overview.recentSub")} action={<Link href="/history" className="text-sm text-signal">{t("overview.allHistory")}</Link>} />
          {recent.length === 0 ? (
            <div className="px-4 pb-4"><EmptyState title={t("overview.noHistory")}>{t("overview.noHistoryBody")}</EmptyState></div>
          ) : (
            <div className="pb-2">{recent.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} compact />)}</div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t("overview.progress")} icon={<Sparkles size={16} />} />
          <div className="space-y-4 px-4 pb-4">
            <Progress label={t("overview.technology")} value={state.technologies.length} max={TECHNOLOGIES.length} color="bg-knowledge" />
            {research && (
              <Progress label={t("overview.research", { tech: term.techName(research.id) })} value={Math.min(knowledge, research.cost)} max={research.cost} color="bg-knowledge/60" suffix={`${Math.floor(knowledge)}/${research.cost}`} />
            )}
            <Progress label={t("overview.knownLocations")} value={discovered} max={LOCATIONS.length} color="bg-water" />
            <Progress label={t("overview.secrets")} value={Object.keys(state.secrets).length} max={SECRETS.length} color="bg-signal" />
            <div>
              <SectionTitle>{t("overview.storylines")}</SectionTitle>
              <ul className="space-y-2">
                {storylineProgress.map((s) => (
                  <li key={s.id}>
                    <Link href={`/content/storylines/${s.id}`} className="block">
                      <Progress label={s.title} value={s.fired} max={s.total} color="bg-signal/70" suffix={t("overview.beats", { n: s.fired, total: s.total })} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {state.technologies.map((id) => <Pill key={id} tone="knowledge">{term.techName(id)}</Pill>)}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Progress({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-[13px]">
        <span className="truncate text-ink-2">{label}</span>
        <span className="num shrink-0 text-ink-3">{suffix ?? `${value}/${max}`}</span>
      </div>
      <ProgressBar value={value} max={max} color={color} />
    </div>
  );
}

async function Hero() {
  const { t } = await getI18n();
  return (
    <div className="card p-5">
      <div className="label-xs text-signal">Genesis — Year Zero</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("overview.heroTitle")}</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-2">
        {t("overview.heroBody")}
      </p>
    </div>
  );
}
