import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Pencil, Radar, X } from "lucide-react";
import { checkEligibility } from "@genesis/narrative";
import { getEventDefinition, getRunContent, listDefinitionVersions, queryHistory } from "@genesis/database";
import { Card, CardHeader, LinkButton, Pill, statusTone } from "@/components/ui";
import { DefinitionView, ValidationPanel } from "@/components/content/definition-view";
import { ChoiceOverride, StatusActions } from "@/components/content/status-actions";
import { db, loadActiveRun } from "@/lib/server";
import { formatValue } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EventDefinitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, term, relativeTime } = await getI18n();
  const row = getEventDefinition(db(), id);
  if (!row) notFound();
  const versions = listDefinitionVersions(db(), id);
  const run = loadActiveRun();
  const frozen = run ? getRunContent(db(), run.summary.id).events.find((e) => e.id === id) : undefined;
  const eligibility = run ? checkEligibility(run.state, { ...(frozen ?? row.definition), status: "published" }) : null;
  const occurrences = run ? queryHistory(db(), run.summary.id, { definitionId: id, limit: 5 }) : null;

  return (
    <div className="space-y-4">
      <Link href="/content" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {t("nav.content")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><Pill tone={statusTone(row.status)}>{term.status(row.status)}</Pill><span className="num text-xs text-ink-3">{row.id} · v{row.version}</span></div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{row.definition.title}</h1>
        </div>
        <LinkButton href={`/content/events/${id}/edit`} size="sm"><Pencil size={14} /> {t("common.edit")}</LinkButton>
      </div>

      <Card>
        <CardHeader title={t("def.review")} subtitle={t("def.reviewSub")} />
        <div className="space-y-3 px-4 pb-4">
          <ValidationPanel errors={row.validation?.errors ?? []} warnings={row.validation?.warnings ?? []} />
          <StatusActions id={id} status={row.status} />
        </div>
      </Card>

      {run && eligibility && (
        <Card>
          <CardHeader
            title={t("def.couldFire")}
            icon={<Radar size={16} />}
            subtitle={`${t("def.against", { run: run.summary.name, tick: run.state.tick })} ${frozen ? t("def.frozen", { v: frozen.version }) : t("def.notFrozen")}`}
            action={<Pill tone={eligibility.eligible ? "ok" : "neutral"}>{eligibility.eligible ? t("def.eligible") : t("def.blocked")}</Pill>}
          />
          <div className="space-y-2 px-4 pb-4 text-[13px]">
            {eligibility.blockedBy && <p className="text-warn">{eligibility.blockedBy}</p>}
            {eligibility.anchors.slice(0, 4).map((a) => (
              <div key={a.settlementId ?? "world"} className="rounded-lg border border-line bg-surface-2/50 p-2.5">
                <div className="mb-1 flex items-center justify-between font-medium"><span>{a.settlementName ?? t("def.world")}</span><Pill tone={a.eligible ? "ok" : "neutral"}>{a.eligible ? t("def.eligible") : !a.rolesOk && a.traces.every((x) => x.passed) ? t("def.noRoles") : t("def.blocked")}</Pill></div>
                {a.traces.map((x, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5">
                    {x.passed ? <Check size={13} className="mt-0.5 shrink-0 text-ok" /> : <X size={13} className="mt-0.5 shrink-0 text-danger" />}
                    <span className="flex-1 text-ink-2">{x.description}</span><span className="num text-ink-3">{formatValue(x.actual, [t("common.yes"), t("common.no")])}</span>
                  </div>
                ))}
              </div>
            ))}
            {frozen && frozen.choices.length > 0 && run.summary.status === "active" && (
              <div className="pt-2">
                <div className="label-xs mb-1">{t("def.overrideLabel")}</div>
                <ChoiceOverride runId={run.summary.id} definitionId={id} choices={frozen.choices.map((c) => ({ id: c.id, label: c.label }))} current={run.choiceOverrides[id] ?? null} />
              </div>
            )}
            {occurrences && occurrences.total > 0 && (
              <p className="pt-1 text-ink-2">{t("def.firedTimes", { n: occurrences.total })} <Link className="text-signal" href={`/history?definition=${id}&importance=`}>{t("def.seeOccurrences")}</Link></p>
            )}
          </div>
        </Card>
      )}

      <DefinitionView def={row.definition} />

      <Card>
        <CardHeader title={t("def.versions")} subtitle={t("def.appendOnly")} />
        <ul className="divide-y divide-line">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
              <span><span className="num">v{v.version}</span> · <Pill tone={statusTone(v.status)}>{term.status(v.status)}</Pill> {v.note && <span className="text-ink-3">· {v.note}</span>}</span>
              <span className="shrink-0 text-ink-3">{relativeTime(v.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
