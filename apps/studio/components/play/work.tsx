"use client";

import clsx from "clsx";
import { useState } from "react";
import { useI18n } from "@/components/i18n";
import { useAct } from "./use-act";
import type { WorkView } from "@/lib/play";

/** The heart of the loop: pick work, commit seasons and supplies, see what came of it. */
export function WorkPanel({ v }: { v: WorkView }) {
  const { t } = useI18n();
  const { act, busy, error } = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const start = (action: string, chosen?: string) => {
    act({ type: "START_WORK", action, ...(chosen ? { target: chosen } : {}), requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` });
    setOpen(null);
  };
  return (
    <section className="card space-y-3 p-4" aria-label={t("play.work.title")}>
      <div>
        <h2 className="text-base font-semibold">{t("play.work.title")}</h2>
        <p className="text-xs text-ink-3">{v.canPlan ? t("play.work.hint", { year: v.year }) : v.reason}</p>
      </div>

      <ol className="grid grid-cols-4 gap-1" aria-label={t("play.work.calendar", { year: v.year })}>
        {v.calendar.map((slot, i) => (
          <li key={i} className={clsx("min-h-14 rounded-lg border p-1.5 text-center text-[11px] leading-tight", slot ? "border-signal/50 bg-signal/10" : "border-line border-dashed text-ink-3")}>
            <div className="text-ink-3">{v.seasonNames[i]}</div>
            <div className={slot ? "font-medium text-ink" : ""}>{slot ?? t("play.work.free")}</div>
          </li>
        ))}
      </ol>

      {v.current.length > 0 && (
        <ul className="space-y-1.5">
          {v.current.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <div className="min-w-0 text-sm">
                <span className="font-medium">{a.name}</span>{a.target ? <span className="text-ink-3"> · {a.target}</span> : null}
                <div className="text-[11px] text-ink-3">{a.when} · {t(`play.work.status.${a.status}`)}</div>
              </div>
              {a.canCancel && <button type="button" disabled={busy} onClick={() => act({ type: "CANCEL_WORK", activityId: a.id })} className="min-h-9 shrink-0 rounded-lg border border-line-strong px-2.5 text-xs hover:bg-surface-2 disabled:opacity-50">{t("play.work.cancel")}</button>}
            </li>
          ))}
        </ul>
      )}

      {v.canPlan && (
        <ul className="space-y-2">
          {v.options.map((o) => {
            const expanded = open === o.id;
            const picked = target[o.id] ?? o.targets?.find((x) => !x.blocker)?.id;
            const blocker = o.targets ? (o.blocker ?? (o.targets.find((x) => x.id === picked)?.blocker ?? (picked ? null : t("play.work.noTarget")))) : o.blocker;
            return (
              <li key={o.id} className="rounded-xl border border-line">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : o.id)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className={clsx("text-sm font-medium", blocker && "text-ink-3")}>{o.name}</span>
                    <span className="ml-2 text-[11px] text-ink-3">{t("play.work.seasons", { n: o.seasons })}{o.away ? ` · ${t("play.work.away")}` : ""}</span>
                  </span>
                  <span aria-hidden className="text-xs text-ink-3">{expanded ? "−" : "+"}</span>
                </button>
                {expanded && (
                  <div className="space-y-2 border-t border-line px-3 py-2.5">
                    <p className="text-xs leading-snug text-ink-2">{o.hint}</p>
                    {o.targets && o.targets.length > 0 && (
                      <select aria-label={t("play.work.target")} value={picked ?? ""} onChange={(e) => setTarget({ ...target, [o.id]: e.target.value })} className="min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm">
                        {o.targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    )}
                    {o.risk && <p className="text-[11px] text-warn">{t("play.work.risk")}：{o.risk}</p>}
                    <p className="text-[11px] text-ink-3">{t("play.work.finish", { when: o.finishLabel })}</p>
                    {o.costs.length > 0 && (
                      <p className="text-[11px] text-ink-3">{t("play.work.cost")}：{o.costs.map((c) => <span key={c.name} className={clsx("mr-2", c.have < c.amount && !o.proposes && "text-warn")}>{c.name} {c.amount}<span className="text-ink-3">（{t("play.work.have", { n: c.have })}）</span></span>)}</p>
                    )}
                    {o.proposes && <p className="text-[11px] text-signal">{t("play.work.proposes")}</p>}
                    {blocker && <p className="text-[11px] text-warn">{blocker}</p>}
                    <button type="button" disabled={busy || !!blocker} onClick={() => start(o.id, picked)} className="min-h-10 w-full rounded-lg border border-signal/50 bg-signal/10 text-sm font-medium text-signal hover:bg-signal/15 disabled:opacity-40">
                      {o.proposes ? t("play.work.propose") : t("play.work.start")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {v.canPlan && (
        <div className="border-t border-line pt-3">
          <h3 className="label-xs mb-1">{t("play.work.priority")}</h3>
          <p className="mb-2 text-[11px] text-ink-3">{v.priority.current ? t("play.work.priorityNow", { what: v.priority.current }) : t("play.work.priorityNone")} {t("play.work.priorityHint")}</p>
          {v.priority.open ? <p className="text-xs text-signal">{t("play.work.priorityOpen")}</p> : (
            <div className="flex flex-wrap gap-1.5">{v.priority.choices.map((p) => <button key={p.label} type="button" disabled={busy} onClick={() => act({ type: "PROPOSE_PRIORITY", priority: p.id })} className="min-h-9 rounded-lg border border-line-strong px-2.5 text-xs hover:bg-surface-2 disabled:opacity-50">{p.label}</button>)}</div>
          )}
        </div>
      )}

      {v.recent.length > 0 && (
        <div className="border-t border-line pt-3">
          <h3 className="label-xs mb-1.5">{t("play.work.results")}</h3>
          <ul className="space-y-1.5">
            {v.recent.map((r) => (
              <li key={r.id} className="text-xs leading-snug">
                <span className="num mr-1.5 text-ink-3">{r.year}</span>
                <span className={r.status === "completed" ? "text-ok" : "text-warn"}>{t(`play.work.status.${r.status}`)}</span> <span className="font-medium">{r.name}</span>
                {r.text && <div className="whitespace-pre-line text-ink-2">{r.text}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
