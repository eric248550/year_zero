import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getStoryline, listEventDefinitions, queryHistory } from "@genesis/database";
import { Card, CardHeader, PageHeader, Pill, statusTone } from "@/components/ui";
import { EventRow } from "@/components/domain";
import { StorylineEditor } from "@/components/content/storyline-editor";
import { db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function StorylinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, term } = await getI18n();
  const s = getStoryline(db(), id);
  if (!s) notFound();
  const defs = new Map(listEventDefinitions(db()).map((d) => [d.id, d]));
  const run = loadActiveRun();
  const counts = run?.state.eventMemory.counts ?? {};
  const occurred = run ? queryHistory(db(), run.summary.id, { storylineId: id, order: "asc", limit: 30 }).items : [];

  return (
    <div className="space-y-4">
      <Link href="/content?tab=storylines" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {t("overview.storylines")}</Link>
      <PageHeader eyebrow={t("history.storyline")} title={s.title} description={s.summary} />
      <p className="text-[13px] text-ink-3">{t("storyline.note")}</p>

      <div className="grid gap-3 md:grid-cols-2">
        {s.beats.map((b) => (
          <Card key={b.id}>
            <CardHeader title={b.title} subtitle={b.description} />
            <ul className="divide-y divide-line">
              {b.eventIds.map((eid) => {
                const d = defs.get(eid);
                return (
                  <li key={eid}>
                    <Link href={`/content/events/${eid}`} className="flex min-h-11 items-center justify-between gap-2 px-4 text-sm hover:bg-surface-2/50">
                      <span className="truncate">{d?.definition.title ?? eid}</span>
                      <span className="flex shrink-0 gap-1">
                        {d ? <Pill tone={statusTone(d.status)}>{term.status(d.status)}</Pill> : <Pill tone="danger">{t("storyline.missing")}</Pill>}
                        {run && <Pill tone={counts[eid] ? "knowledge" : "neutral"}>{counts[eid] ? `${counts[eid]}×` : t("storyline.notYet")}</Pill>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title={t("storyline.outcomes")} />
        <ul className="list-disc space-y-1 px-8 pb-4 text-sm text-ink-2">{s.possibleOutcomes.map((o, i) => <li key={i}>{o}</li>)}</ul>
      </Card>

      {run && (
        <Card>
          <CardHeader title={t("storyline.inRun")} subtitle={run.summary.name} />
          {occurred.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("storyline.notSurfaced")}</p> : occurred.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} compact />)}
        </Card>
      )}

      <StorylineEditor initial={JSON.stringify(s, null, 2)} />
    </div>
  );
}
