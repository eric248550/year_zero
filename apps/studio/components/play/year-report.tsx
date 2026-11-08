import type { YearReportView } from "@/lib/play";

type T = (key: string, values?: Record<string, string | number>) => string;

/** What happened since this player last acted: what they did, what changed, and what is new. */
export function YearReport({ v, t }: { v: YearReportView; t: T }) {
  if (v.done.length + v.changed.length + v.open.length + v.problems.length === 0) return null;
  const list = (title: string, items: { key: string; text: string; detail?: string | null }[]) => items.length > 0 && (
    <div>
      <h3 className="label-xs mb-1">{title}</h3>
      <ul className="space-y-1 text-xs leading-snug text-ink-2">
        {items.map((x) => <li key={x.key}>{x.text}{x.detail && <span className="block text-[11px] text-ink-3">{x.detail}</span>}</li>)}
      </ul>
    </div>
  );
  return (
    <section className="card mt-3 space-y-3 p-4" aria-label={t("play.report2.title")}>
      <div>
        <h2 className="text-base font-semibold">{t("play.report2.title")}</h2>
        <p className="text-xs text-ink-3">{v.years > 1 ? t("play.report2.away", { n: v.years }) : t("play.report2.lastYear")}</p>
      </div>
      {list(t("play.report2.done"), v.done)}
      {v.share && <p className="text-xs text-ink-2">{v.share}</p>}
      {list(t("play.report2.changed"), v.changed)}
      {list(t("play.report2.open"), v.open)}
      {list(t("play.report2.problems"), v.problems)}
    </section>
  );
}
