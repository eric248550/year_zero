import Link from "next/link";
import { Filter, ScrollText, X } from "lucide-react";
import { HISTORY_CATEGORIES, IMPORTANCE, type Importance } from "@genesis/schemas";
import { fullName } from "@genesis/narrative";
import { getRunContent, historyCategoryCounts, queryHistory, type HistoryFilters } from "@genesis/database";
import { Card, EmptyState, LinkButton, PageHeader, buttonClass } from "@/components/ui";
import { EventRow } from "@/components/domain";
import { db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.history") };
}

const PAGE = 40;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const int = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t, term } = await getI18n();
  const run = loadActiveRun();
  if (!run) return <EmptyState icon={<ScrollText />} title={t("common.noActiveRun")} action={<LinkButton href="/simulate" variant="primary">{t("common.createRun")}</LinkButton>}>{t("history.noRunBody")}</EmptyState>;

  const minImportance = (IMPORTANCE as readonly string[]).includes(one(sp.importance) ?? "") ? (one(sp.importance) as Importance) : undefined;
  const filters: HistoryFilters = {
    fromYear: int(one(sp.from)),
    toYear: int(one(sp.to)),
    category: one(sp.category),
    settlementId: one(sp.settlement),
    characterId: one(sp.character),
    storylineId: one(sp.storyline),
    definitionId: one(sp.definition),
    kind: one(sp.kind) === "narrative" || one(sp.kind) === "system" ? (one(sp.kind) as "narrative" | "system") : undefined,
    minImportance: sp.importance === undefined ? "notable" : minImportance,
    order: one(sp.order) === "asc" ? "asc" : "desc",
    limit: PAGE,
    offset: int(one(sp.offset)) ?? 0,
  };
  const { state, summary } = run;
  const { items, total } = queryHistory(db(), summary.id, filters);
  const counts = historyCategoryCounts(db(), summary.id);
  const storylines = getRunContent(db(), summary.id).storylines;
  const character = filters.characterId ? state.characters.find((c) => c.id === filters.characterId) : undefined;
  const activeFilterCount = [filters.fromYear, filters.toYear, filters.category, filters.settlementId, filters.storylineId, filters.kind, filters.definitionId].filter((v) => v !== undefined).length;

  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) { const val = one(v); if (val !== undefined) p.set(k, val); }
    if (sp.importance === undefined) p.set("importance", "notable");
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") p.delete(k); else p.set(k, String(v)); }
    return `/history?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader eyebrow={summary.name} title={t("nav.history")} description={t("history.description")} />

      <details className="card group mb-3" open={activeFilterCount > 0 ? true : undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium">
          <span className="flex items-center gap-2"><Filter size={16} className="text-signal" /> {t("history.filters")} {activeFilterCount > 0 && <span className="num rounded-full bg-signal/20 px-2 text-[11px] text-signal">{activeFilterCount}</span>}</span>
          <span className="text-ink-3 group-open:rotate-180">⌄</span>
        </summary>
        <form method="get" action="/history" className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
          {filters.characterId && <input type="hidden" name="character" value={filters.characterId} />}
          <label className="block"><span className="label-xs">{t("history.fromYear")}</span><input className="field num mt-1" name="from" inputMode="numeric" defaultValue={filters.fromYear} placeholder={String(state.startYear)} /></label>
          <label className="block"><span className="label-xs">{t("history.toYear")}</span><input className="field num mt-1" name="to" inputMode="numeric" defaultValue={filters.toYear} placeholder={String(state.startYear + state.tick)} /></label>
          <label className="block"><span className="label-xs">{t("history.category")}</span>
            <select className="field mt-1" name="category" defaultValue={filters.category ?? ""}>
              <option value="">{t("history.allCategories")}</option>
              {HISTORY_CATEGORIES.map((c) => <option key={c} value={c}>{term.category(c)} ({counts.find((x) => x.category === c)?.n ?? 0})</option>)}
            </select>
          </label>
          <label className="block"><span className="label-xs">{t("history.settlement")}</span>
            <select className="field mt-1" name="settlement" defaultValue={filters.settlementId ?? ""}>
              <option value="">{t("history.allSettlements")}</option>
              {state.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "abandoned" ? ` (${term.status("abandoned")})` : ""}</option>)}
            </select>
          </label>
          <label className="block"><span className="label-xs">{t("history.storyline")}</span>
            <select className="field mt-1" name="storyline" defaultValue={filters.storylineId ?? ""}>
              <option value="">{t("history.allStorylines")}</option>
              {storylines.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="block"><span className="label-xs">{t("history.minImportance")}</span>
            <select className="field mt-1" name="importance" defaultValue={sp.importance === undefined ? "notable" : (minImportance ?? "")}>
              <option value="">{t("history.everything")}</option>
              {IMPORTANCE.map((i) => <option key={i} value={i}>{term.importance(i)}+</option>)}
            </select>
          </label>
          <label className="block"><span className="label-xs">{t("history.source")}</span>
            <select className="field mt-1" name="kind" defaultValue={filters.kind ?? ""}>
              <option value="">{t("history.sourceAll")}</option>
              <option value="narrative">{t("history.sourceNarrative")}</option>
              <option value="system">{t("history.sourceSystem")}</option>
            </select>
          </label>
          <label className="block"><span className="label-xs">{t("history.order")}</span>
            <select className="field mt-1" name="order" defaultValue={filters.order}>
              <option value="desc">{t("history.newest")}</option>
              <option value="asc">{t("history.oldest")}</option>
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonClass("primary", "md", "flex-1 sm:flex-none")}>{t("common.apply")}</button>
            <Link href="/history" className={buttonClass("ghost")}>{t("common.reset")}</Link>
          </div>
        </form>
      </details>

      {(character || filters.definitionId) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {character && <Link href={qs({ character: undefined, offset: undefined })} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 text-sm text-signal">{t("history.characterFilter")} {fullName(character)} <X size={14} /></Link>}
          {filters.definitionId && <Link href={qs({ definition: undefined, offset: undefined })} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 text-sm text-signal">{t("history.eventFilter")} {filters.definitionId} <X size={14} /></Link>}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
        <span className="num">{t("history.count", { count: total })}</span>
        <span>{t("history.tickYear", { tick: state.tick, year: state.startYear + state.tick })}</span>
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="p-4"><EmptyState title={t("history.noMatch")}>{state.tick === 0 ? t("history.noMatchStart") : t("history.noMatchWiden")}</EmptyState></div>
        ) : (
          <div className="py-1">{items.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} />)}</div>
        )}
      </Card>

      {(filters.offset! > 0 || filters.offset! + PAGE < total) && (
        <div className="mt-3 flex justify-between gap-2">
          {filters.offset! > 0 ? <Link className={buttonClass("secondary")} href={qs({ offset: Math.max(0, filters.offset! - PAGE) })}>← {t("common.previous")}</Link> : <span />}
          {filters.offset! + PAGE < total && <Link className={buttonClass("secondary")} href={qs({ offset: filters.offset! + PAGE })}>{t("common.next")} →</Link>}
        </div>
      )}
    </div>
  );
}
