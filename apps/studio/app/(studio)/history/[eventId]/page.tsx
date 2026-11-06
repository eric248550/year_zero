import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Dices, GitMerge, ListChecks, Users, X } from "lucide-react";
import { characterAge, fullName } from "@genesis/narrative";
import { getHistoryEventDetail } from "@genesis/database";
import { Card, CardHeader, KeyValue, Pill, importanceTone } from "@/components/ui";
import { ChangeList, EventRow } from "@/components/domain";
import { db, loadActiveRun } from "@/lib/server";
import { formatValue } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { t, term } = await getI18n();
  const yesNo: [string, string] = [t("common.yes"), t("common.no")];
  const run = loadActiveRun();
  if (!run) notFound();
  const detail = getHistoryEventDetail(db(), run.summary.id, eventId);
  if (!detail) notFound();
  const { event, causes, consequences, definition, characters, settlements } = detail;
  const roleByCharacter = new Map(Object.entries(event.trigger?.roles ?? {}).map(([role, id]) => [id, role]));

  return (
    <div className="space-y-4">
      <Link href="/history" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {t("nav.history")}</Link>

      <Card>
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone={importanceTone(event.importance)}>{term.importance(event.importance)}</Pill>
            <Pill>{term.category(event.category)}</Pill>
            <Pill>{t("event.scope", { scope: term.scope(event.scope) })}</Pill>
            <Pill tone={event.kind === "narrative" ? "knowledge" : "neutral"}>{event.kind === "narrative" ? t("event.kindNarrative") : t("event.kindSystem")}</Pill>
          </div>
          <h1 className="mt-3 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{event.title}</h1>
          <div className="num mt-1 text-sm text-ink-3">{t("event.when", { year: event.year, tick: event.tick })} · {event.id}</div>
          <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink-2">
            {event.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
          </div>
          {event.storylineIds.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {event.storylineIds.map((s) => <Link key={s} href={`/content/storylines/${s}`}><Pill tone="signal">{t("event.storyline", { id: s })}</Pill></Link>)}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("event.why")} icon={<ListChecks size={16} />} subtitle={event.trigger?.summary ?? (event.parentId ? t("event.byParent") : t("event.byRule"))} />
          <div className="px-4 pb-4">
            {event.trigger && event.trigger.chance !== null && (
              <KeyValue items={[
                [t("event.priority"), event.trigger.priority ?? "—"],
                [t("event.chance"), event.trigger.chance],
                [t("event.roll"), <span key="r" className="num">{formatValue(event.trigger.roll, yesNo)} &lt; {event.trigger.chance} ✓</span>],
                [t("event.definition"), definition ? <Link key="d" className="text-signal" href={`/content/events/${definition.id}`}>{definition.id} v{event.definitionVersion}</Link> : event.definitionId ?? "—"],
              ]} />
            )}
            {event.trigger && event.trigger.conditions.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {event.trigger.conditions.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[13px]">
                    {c.passed ? <Check size={14} className="mt-0.5 shrink-0 text-ok" /> : <X size={14} className="mt-0.5 shrink-0 text-danger" />}
                    <span className="min-w-0 flex-1 text-ink-2">{c.description}</span>
                    <span className="num shrink-0 text-ink-3">= {formatValue(c.actual, yesNo)}</span>
                  </li>
                ))}
              </ul>
            )}
            {event.trigger && event.trigger.conditions.length === 0 && event.kind === "narrative" && <p className="mt-2 text-sm text-ink-3">{t("event.noPreconditions")}</p>}
          </div>
        </Card>

        {event.choice && (
          <Card>
            <CardHeader title={t("event.decision")} icon={<Dices size={16} />} subtitle={t("event.decidedBy", { by: term.decidedBy(event.choice.decidedBy) })} />
            <ul className="space-y-1.5 px-4 pb-4">
              {event.choice.alternatives.map((a) => (
                <li key={a.id} className={`rounded-lg border px-3 py-2 text-[13px] ${a.id === event.choice!.id ? "border-signal/50 bg-signal/10" : "border-line bg-surface-2/60"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={a.id === event.choice!.id ? "font-medium text-signal" : a.available ? "text-ink-2" : "text-ink-3 line-through"}>{a.label}</span>
                    <span className="num shrink-0 text-[11px] text-ink-3">{a.available ? t("event.policyScore", { score: a.score ?? "—" }) : t("event.unavailable")}</span>
                  </div>
                  {a.reason && <div className="mt-0.5 text-[12px] text-ink-3">{a.reason}</div>}
                </li>
              ))}
              {event.choice.risk && (
                <li className={`rounded-lg border px-3 py-2 text-[13px] ${event.choice.risk.triggered ? "border-danger/40 bg-danger/10 text-danger" : "border-line text-ink-3"}`}>
                  {t("event.risk", { pct: Math.round(event.choice.risk.chance * 100) })} · {t("event.rollShort")} <span className="num">{event.choice.risk.roll}</span> → {event.choice.risk.triggered ? t("event.triggered") : t("event.avoided")}
                </li>
              )}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title={t("event.stateChanges")} subtitle={t("event.stateChangesSub")} />
          <ChangeList changes={event.changes} />
        </Card>

        <Card>
          <CardHeader title={t("event.involved")} icon={<Users size={16} />} />
          <ul className="divide-y divide-line">
            {settlements.map((s) => (
              <li key={s.id}><Link href={`/world/settlements/${s.id}`} className="flex min-h-12 items-center justify-between px-4 text-sm hover:bg-surface-2/60"><span>{s.name}</span><span className="text-ink-3">{term.settlementKind(s.kind)}{s.status === "abandoned" ? ` · ${term.status("abandoned")}` : ""}</span></Link></li>
            ))}
            {characters.map((c) => (
              <li key={c.id}>
                <Link href={`/world/characters/${c.id}`} className="flex min-h-12 items-center justify-between gap-2 px-4 text-sm hover:bg-surface-2/60">
                  <span className="min-w-0 truncate">{fullName(c)} {roleByCharacter.has(c.id) && <span className="text-ink-3">{t("event.asRole", { role: roleByCharacter.get(c.id) ?? "" })}</span>}</span>
                  <span className="shrink-0 text-ink-3">{term.profession(c.profession)} · {c.deathTick === null ? t("event.age", { n: characterAge(run.state, c) }) : "†"}</span>
                </Link>
              </li>
            ))}
            {settlements.length === 0 && characters.length === 0 && <li className="px-4 py-3 text-sm text-ink-3">{t("event.worldWide")}</li>}
          </ul>
        </Card>
      </div>

      {(causes.length > 0 || consequences.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("event.causedBy")} icon={<GitMerge size={16} />} subtitle={t("event.causedBySub")} />
            {causes.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("event.noCause")}</p> : causes.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} compact />)}
          </Card>
          <Card>
            <CardHeader title={t("event.ledTo")} subtitle={t("event.ledToSub")} />
            {consequences.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("event.nothingYet")}</p> : consequences.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} compact />)}
          </Card>
        </div>
      )}
    </div>
  );
}
