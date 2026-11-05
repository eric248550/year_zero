import Link from "next/link";
import { BookOpen, Plus, Sparkles } from "lucide-react";
import { listAiGenerations, listEventDefinitions, listStorylines } from "@genesis/database";
import { Card, EmptyState, LinkButton, PageHeader, Pill, Tabs, statusTone } from "@/components/ui";
import { SeedContentButton } from "@/components/forms";
import { db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.content") };
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ContentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t, term } = await getI18n();
  const tab = one(sp.tab) ?? "events";
  const status = one(sp.status);
  const defs = listEventDefinitions(db());
  const storylines = listStorylines(db());
  const run = loadActiveRun();
  const counts = run?.state.eventMemory.counts ?? {};
  const shown = defs.filter((d) => !status || d.status === status);

  return (
    <div>
      <PageHeader
        eyebrow={t("content.eyebrow")}
        title={t("content.title")}
        description={t("content.description")}
        action={<div className="flex gap-2"><LinkButton href="/content/generate" size="sm"><Sparkles size={14} /> {t("content.generate")}</LinkButton><LinkButton href="/content/events/new" size="sm" variant="primary"><Plus size={14} /> {t("content.new")}</LinkButton></div>}
      />
      <Tabs active={tab} items={[
        { key: "events", label: t("content.events"), href: "/content?tab=events", count: defs.length },
        { key: "storylines", label: t("overview.storylines"), href: "/content?tab=storylines", count: storylines.length },
        { key: "generations", label: t("content.aiLog"), href: "/content?tab=generations" },
      ]} />

      {tab === "events" && (
        <>
          <div className="scroll-x mb-3">
            {["", "published", "validated", "draft", "archived"].map((s) => (
              <Link key={s || "all"} href={`/content?tab=events${s ? `&status=${s}` : ""}`} className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-[13px] ${(status ?? "") === s ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-ink-2"}`}>
                {s ? term.status(s) : t("common.all")} <span className="num ml-1.5 opacity-60">{s ? defs.filter((d) => d.status === s).length : defs.length}</span>
              </Link>
            ))}
          </div>
          {defs.length === 0 ? (
            <EmptyState icon={<BookOpen />} title={t("content.noDefs")} action={<SeedContentButton />}>{t("content.noDefsBody")}</EmptyState>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {shown.map((d) => (
                  <li key={d.id}>
                    <Link href={`/content/events/${d.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2/50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{d.definition.title}</span></div>
                        <div className="num mt-0.5 truncate text-[12px] text-ink-3">{d.id} · v{d.version} · {term.category(d.definition.category)} · {term.scope(d.definition.scope)} · p{d.definition.priority} · {d.source}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.definition.storylineIds.map((s) => <Pill key={s} tone="signal">{s}</Pill>)}
                          {(d.validation?.errors.length ?? 0) > 0 && <Pill tone="danger">{t("content.errors", { count: d.validation!.errors.length })}</Pill>}
                          {(d.validation?.warnings.length ?? 0) > 0 && <Pill tone="warn">{t("content.warnings", { count: d.validation!.warnings.length })}</Pill>}
                          {run && counts[d.id] ? <Pill tone="knowledge">{t("content.firedInRun", { n: counts[d.id] ?? 0 })}</Pill> : null}
                        </div>
                      </div>
                      <Pill tone={statusTone(d.status)}>{term.status(d.status)}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {tab === "storylines" && (
        <div className="grid gap-3 md:grid-cols-3">
          {storylines.map((s) => (
            <Link key={s.id} href={`/content/storylines/${s.id}`} className="card block p-4 hover:border-signal/40">
              <div className="label-xs text-signal">{t("content.beatsEvents", { beats: s.beats.length, events: s.beats.reduce((n, b) => n + b.eventIds.length, 0) })}</div>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-1 line-clamp-4 text-[13px] text-ink-2">{s.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1">{s.themes.map((t) => <Pill key={t}>{t}</Pill>)}</div>
            </Link>
          ))}
          {storylines.length === 0 && <EmptyState title={t("content.noStorylines")} action={<SeedContentButton />} />}
        </div>
      )}

      {tab === "generations" && <Generations />}
    </div>
  );
}

async function Generations() {
  const { t, term, relativeTime } = await getI18n();
  const rows = listAiGenerations(db(), 30);
  if (rows.length === 0) return <EmptyState icon={<Sparkles />} title={t("content.noGenerations")} action={<LinkButton href="/content/generate" variant="primary">{t("content.openGenerator")}</LinkButton>} />;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-ink">{r.prompt}</span>
              <Pill tone={r.outcome === "valid" ? "ok" : r.outcome === "invalid" ? "warn" : "danger"}>{term.aiOutcome(r.outcome)}</Pill>
            </div>
            <div className="mt-0.5 text-[12px] text-ink-3">
              {r.isMock ? <span className="text-warn">{t("content.mockTemplate")}</span> : `${r.provider} · ${r.model}`} · {relativeTime(r.createdAt)}
              {r.definitionId && <> · <Link className="text-signal" href={`/content/events/${r.definitionId}`}>{r.definitionId}</Link></>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
