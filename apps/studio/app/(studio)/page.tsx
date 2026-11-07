import Link from "next/link";
import { BookOpen, Radio } from "lucide-react";
import { currentYear, population } from "@genesis/narrative";
import { civilization, worldStatus } from "@genesis/simulation";
import { CivilizationCard } from "@/components/civ/civilization";
import { queryHistory } from "@genesis/database";
import { EmptyState, LinkButton, Pill, SectionTitle, StatusDot, statusTone } from "@/components/ui";
import { EventRow } from "@/components/domain";
import { StepControls } from "@/components/step-controls";
import { SeedContentButton } from "@/components/forms";
import { StorylineCard } from "@/components/story/storyline";
import { Directions } from "@/components/story/directions";
import { describeAction } from "@/lib/describe-action";
import { buildStory, directionOptions } from "@/lib/story";
import { contentStats, db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * The Studio's front page: read the world as a story and make the few big
 * decisions. Numbers and tools live under "Advanced".
 */
export default async function StoryPage() {
  const i18n = await getI18n();
  const { t, term } = i18n;
  const run = loadActiveRun();

  if (!run) {
    const stats = contentStats();
    return stats.published === 0 ? (
      <EmptyState icon={<BookOpen />} title={t("overview.noContent")} action={<SeedContentButton />}>
        {t("overview.noContentBody")} <code className="num">pnpm db:seed</code>
      </EmptyState>
    ) : (
      <EmptyState icon={<Radio />} title={t("overview.noRun")} action={<LinkButton href="/simulate" variant="primary">{t("overview.createWorld")}</LinkButton>}>
        {t("overview.noRunBody")}
      </EmptyState>
    );
  }

  const { state, summary } = run;
  const status = worldStatus(state);
  const story = buildStory(summary.id, state, run.choiceOverrides, i18n);
  const directions = directionOptions(state, i18n);
  const recent = queryHistory(db(), summary.id, { minImportance: "notable", limit: 8 }).items;
  const queued = run.queuedActions.map((a) => describeAction(a, i18n));
  const players = Object.values(state.players ?? {}).filter((p) => p.status !== "left").length;
  const active = summary.status === "active";
  const firstOpen = story.find((l) => l.done < l.total)?.id;

  return (
    <div className="space-y-5">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={status} />
          <Pill tone={statusTone(status)}>{term.status(status)}</Pill>
          <Link href="/simulate" className="truncate text-xs text-ink-3 hover:text-ink">{summary.name} · {t("story.switchWorld")}</Link>
          <Link href="/debug" className="ml-auto text-xs text-ink-3 hover:text-ink">{t("nav.debug")}</Link>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-4xl font-semibold tracking-tight">{currentYear(state)}</span>
          <span className="text-sm text-ink-2">{t("story.headline", { years: state.tick, people: population(state), settlements: state.settlements.filter((s) => s.status === "active").length, players })}</span>
        </div>
        <p className="mt-1 text-xs text-ink-3">{t("story.howTo")}</p>
        <div className="mt-3">
          <StepControls runId={summary.id} disabled={!active} compact />
          {!active && <p className="mt-2 text-xs text-warn">{t("overview.archived")}</p>}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <CivilizationCard civ={civilization(state)} t={t} />

          <div>
            <SectionTitle>{t("story.lines")}</SectionTitle>
            <p className="-mt-1 mb-3 text-xs text-ink-3">{t("story.linesHint")}</p>
            <div className="space-y-3">
              {story.map((l) => <StorylineCard key={l.id} line={l} runId={summary.id} defaultOpen={l.id === firstOpen} />)}
            </div>
          </div>

          <div>
            <SectionTitle action={<Link href="/history" className="text-sm text-signal">{t("overview.allHistory")}</Link>}>{t("story.recent")}</SectionTitle>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-3">{t("story.nothingYet")}</p>
            ) : (
              <div className="card pb-1">{recent.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} compact />)}</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <SectionTitle>{t("story.decide")}</SectionTitle>
          <p className="-mt-1 mb-3 text-xs text-ink-3">{t("story.decideHint")}</p>
          {active ? <Directions runId={summary.id} o={directions} queued={queued} /> : <p className="text-sm text-ink-3">{t("overview.archived")}</p>}
        </div>
      </div>
    </div>
  );
}
