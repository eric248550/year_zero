import Link from "next/link";
import { Bug } from "lucide-react";
import { TECH_BY_ID } from "@genesis/schemas";
import { fullName, getCharacter } from "@genesis/narrative";
import { getMetrics, listDecisions, listImmediateActions, queryHistory } from "@genesis/database";
import { EmptyState, PageHeader, Pill, ProgressBar, Tabs } from "@/components/ui";
import { db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const TABS = ["pending", "rejected", "transfers", "changes"] as const;
type Tab = (typeof TABS)[number];
const PATHS = ["flags.", "facilities", "laws", "claimedBy", "tensions.", "projects.", "scheduled.", "specialties", "resources."];

/**
 * Debugging views for one world, phone-first: what is waiting to happen, what
 * the engine refused, goods moving between settlements, and every recorded
 * state change by path.
 */
export default async function DebugPage({ searchParams }: { searchParams: Promise<{ tab?: string; path?: string }> }) {
  const { t } = await getI18n();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "pending";
  const run = loadActiveRun();
  if (!run) return <EmptyState icon={<Bug />} title={t("debug.noRun")} />;
  const { state, summary } = run;
  const name = (id: string) => { const c = getCharacter(state, id); return c ? `${fullName(c)}${c.deathTick !== null ? " †" : ""}` : id; };
  const seasonLabel = (season: number) => `${state.startYear + Math.floor(season / 4)} ${t(`debug.season.${season % 4}` as never)}`;
  const place = (id: string | null) => (id ? state.settlements.find((s) => s.id === id)?.name ?? id : "—");

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={summary.name} title={t("debug.title")} description={t("debug.hint", { year: state.startYear + state.tick })} />
      <Tabs active={tab} items={TABS.map((k) => ({ key: k, label: t(`debug.tab.${k}` as never), href: `/debug?tab=${k}` }))} />

      {tab === "pending" && (
        <div className="space-y-4">
          <Block title={t("debug.decisions")} empty={!state.pendingDecisions?.length}>
            {(state.pendingDecisions ?? []).map((d) => (
              <Row key={d.id} title={d.definitionId} meta={`${place(d.settlementId)} · ${t("debug.due", { year: state.startYear + d.resolveTick })}`}>
                {d.participants.length} {t("debug.participants")} · {Object.keys(d.responses).length} {t("debug.answered")}
                {Object.entries(d.responses).map(([id, c]) => <div key={id} className="text-ink-3">{name(id)} → {c}</div>)}
              </Row>
            ))}
          </Block>
          <Block title={t("debug.scheduled")} empty={!state.scheduled?.length}>
            {(state.scheduled ?? []).map((x) => (
              <Row key={x.id} title={x.definitionId} meta={`${place(x.settlementId)} · ${seasonLabel(x.dueSeason)}`}>
                {Object.entries(x.roles).map(([r, id]) => `${r}: ${name(id)}`).join(" · ")}
                <div className="text-ink-3"><Link className="text-signal" href={`/history/${x.causeId}`}>{t("debug.cause")} {x.causeId}</Link></div>
              </Row>
            ))}
          </Block>
          <Block title={t("debug.away")} empty={!state.characters.some((c) => c.deathTick === null && c.awayUntil !== undefined && c.awayUntil >= state.tick * 4)}>
            {state.characters.filter((c) => c.deathTick === null && c.awayUntil !== undefined && c.awayUntil >= state.tick * 4).map((c) => (
              <Row key={c.id} title={name(c.id)} meta={`${place(c.homeId)} · ${t("debug.back", { when: seasonLabel(c.awayUntil!) })}`} />
            ))}
          </Block>
          <Block title={t("debug.construction")} empty={!state.settlements.some((s) => Object.keys(s.building ?? {}).length)}>
            {state.settlements.flatMap((s) => Object.entries(s.building ?? {}).map(([f, due]) => <Row key={`${s.id}${f}`} title={`${s.name} · ${f}`} meta={seasonLabel(due!)} />))}
          </Block>
          <Block title={t("debug.projects")} empty={!state.projects?.length}>
            {(state.projects ?? []).map((p) => {
              const tech = TECH_BY_ID[p.techId]!;
              const top = Object.entries(p.contributions ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
              return (
                <Row key={p.id} title={`${p.id} · ${p.techId}`} meta={`${place(p.settlementId)} · ${p.approach ?? "steady"} · +${p.lastGain}/${t("debug.year")}`}>
                  <ProgressBar value={p.progress} max={tech.cost} />
                  <div className="text-ink-3">{Math.round(p.progress)}/{tech.cost} · {t("debug.lead")} {p.leadId ? name(p.leadId) : "—"} · {t("debug.members")} {p.memberIds.map(name).join("、") || "—"} · {t("debug.crew")} {p.crewIds.length}{p.idleYears ? ` · ${t("debug.idle", { n: p.idleYears })}` : ""}</div>
                  {top.length > 0 && <div className="text-ink-3">{t("debug.top")} {top.map(([id, w]) => `${name(id)} ${w}`).join("、")}</div>}
                </Row>
              );
            })}
          </Block>
        </div>
      )}

      {tab === "rejected" && <Rejected runId={summary.id} t={t} />}
      {tab === "transfers" && <Transfers runId={summary.id} t={t} />}
      {tab === "changes" && <Changes runId={summary.id} path={sp.path ?? ""} t={t} />}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getI18n>>["t"];

function Block({ title, empty, children }: { title: string; empty: boolean; children?: React.ReactNode }) {
  return (
    <section className="card p-3">
      <h2 className="label-xs mb-2">{title}</h2>
      {empty ? <p className="text-xs text-ink-3">—</p> : <ul className="divide-y divide-line">{children}</ul>}
    </section>
  );
}

function Row({ title, meta, children }: { title: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="min-w-0 space-y-1 py-2 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="min-w-0 break-words font-medium text-ink">{title}</span>
        {meta && <span className="num text-ink-3">{meta}</span>}
      </div>
      {children && <div className="min-w-0 break-words text-ink-2">{children}</div>}
    </li>
  );
}

function Rejected({ runId, t }: { runId: string; t: T }) {
  const d = db();
  const events = getMetrics(d, runId).filter((m) => (m.rejectedEvents as unknown[]).length > 0).slice(-40).reverse();
  const actions = listDecisions(d, runId).filter((x) => (x.rejected as unknown[]).length > 0).slice(-40).reverse();
  const immediate = listImmediateActions(d, runId).slice(-30).reverse();
  return (
    <div className="space-y-4">
      <Block title={t("debug.rejectedEvents")} empty={events.length === 0}>
        {events.flatMap((m) => (m.rejectedEvents as { definitionId: string; reason: string }[]).map((r, i) => (
          <Row key={`${m.tick}-${i}`} title={r.definitionId} meta={String(m.year)}>{r.reason}</Row>
        )))}
      </Block>
      <Block title={t("debug.rejectedActions")} empty={actions.length === 0}>
        {actions.flatMap((x) => (x.rejected as { action: { type?: string }; reason: string }[]).map((r, i) => (
          <Row key={`${x.tick}-${i}`} title={r.action?.type ?? "?"} meta={`tick ${x.tick}`}>{r.reason}</Row>
        )))}
      </Block>
      <Block title={t("debug.playerActions")} empty={immediate.length === 0}>
        {immediate.map((x) => <Row key={x.id} title={(x.action as { type?: string }).type ?? "?"} meta={`tick ${x.tick}`}><code className="break-all text-[11px]">{JSON.stringify(x.action)}</code></Row>)}
      </Block>
      <p className="text-[11px] text-ink-3">{t("debug.rejectedNote")}</p>
    </div>
  );
}

function Transfers({ runId, t }: { runId: string; t: T }) {
  const items = queryHistory(db(), runId, { order: "desc", limit: 500 }).items
    .map((e) => ({ e, moves: e.changes.filter((c) => /^settlements\.[^.]+\.resources\./.test(c.path)) }))
    .filter(({ moves }) => new Set(moves.map((m) => m.path.split(".")[1])).size >= 2)
    .slice(0, 60);
  return (
    <Block title={t("debug.transfers")} empty={items.length === 0}>
      {items.map(({ e, moves }) => (
        <Row key={e.id} title={<Link className="text-signal" href={`/history/${e.id}`}>{e.title}</Link>} meta={String(e.year)}>
          {moves.map((m) => {
            const delta = Math.round((Number(m.after) - Number(m.before)) * 10) / 10;
            return <div key={m.path} className="num">{m.label}: <span className={delta < 0 ? "text-danger" : "text-ok"}>{delta > 0 ? "+" : ""}{delta}</span></div>;
          })}
          <div className="num text-ink-3">{t("debug.net")} {Object.entries(moves.reduce<Record<string, number>>((n, m) => { const r = m.path.split(".")[3]!; n[r] = (n[r] ?? 0) + Number(m.after) - Number(m.before); return n; }, {})).map(([r, n]) => `${r} ${Math.round(n * 10) / 10}`).join(" · ")}</div>
        </Row>
      ))}
    </Block>
  );
}

function Changes({ runId, path, t }: { runId: string; path: string; t: T }) {
  const items = path
    ? queryHistory(db(), runId, { order: "desc", limit: 800 }).items.filter((e) => e.changes.some((c) => c.path.includes(path))).slice(0, 80)
    : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PATHS.map((p) => <Link key={p} href={`/debug?tab=changes&path=${encodeURIComponent(p)}`}><Pill tone={p === path ? "signal" : "neutral"}>{p}</Pill></Link>)}
      </div>
      {!path ? <p className="text-xs text-ink-3">{t("debug.pickPath")}</p> : (
        <Block title={t("debug.changesFor", { path })} empty={items.length === 0}>
          {items.map((e) => (
            <Row key={e.id} title={<Link className="text-signal" href={`/history/${e.id}`}>{e.title}</Link>} meta={`${e.year} · ${e.kind}`}>
              {e.changes.filter((c) => c.path.includes(path)).map((c) => <div key={c.path} className="num break-all">{c.path}: {String(c.before)} → {String(c.after)}</div>)}
              {e.trigger && <div className="text-ink-3">{e.trigger.summary}</div>}
            </Row>
          ))}
        </Block>
      )}
    </div>
  );
}
