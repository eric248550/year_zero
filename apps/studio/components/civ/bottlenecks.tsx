"use client";

import clsx from "clsx";
import { Check, Circle, Clock, Hammer, X } from "lucide-react";
import { useAct } from "@/components/play/use-act";
import { useI18n } from "@/components/i18n";
import type { BottleneckView } from "@/lib/bottlenecks";

const ICON = { done: Check, building: Hammer, ready: Circle, waiting: Clock, blocked: X } as const;
const TONE = { done: "text-signal", building: "text-signal", ready: "text-ink-2", waiting: "text-ink-3", blocked: "text-warn" } as const;

/** What is holding the civilization back from here, and what would move it. */
export function Bottlenecks({ v, place }: { v: BottleneckView[]; place?: string }) {
  const { t } = useI18n();
  const { act, busy, error } = useAct();
  if (v.length === 0) return null;
  return (
    <section className="card space-y-3 p-4" aria-label={t("civ.block.title")}>
      <div>
        <h2 className="text-[15px] font-semibold">{t("civ.block.title")}{place && <span className="ml-1.5 text-xs font-normal text-ink-3">{place}</span>}</h2>
        <p className="mt-0.5 text-xs text-ink-3">{t("civ.block.hint")}</p>
      </div>
      <ul className="space-y-2">
        {v.map((b) => (
          <li key={b.key}>
            <details className="rounded-xl border border-line p-3" open={b.open}>
              <summary className="cursor-pointer list-none text-sm font-medium">
                {t(b.titleKey as never)}
                <span className="ml-1.5 text-xs font-normal text-warn">{t("civ.block.notReady")}</span>
              </summary>
              {b.routeLabel && <p className="mt-1 text-[11px] text-ink-3">{t("civ.block.route", { route: b.routeLabel })}</p>}
              <ul className="mt-2 space-y-1">
                {b.steps.map((s) => {
                  const Icon = ICON[s.status];
                  return (
                    <li key={s.id} className="flex items-start gap-2 text-xs leading-snug">
                      <Icon size={13} className={clsx("mt-0.5 shrink-0", TONE[s.status])} aria-hidden />
                      <span className="min-w-0">
                        <span className={clsx(s.status === "done" ? "text-ink-3" : "text-ink")}>{s.label}</span>
                        <span className={clsx("ml-1.5", TONE[s.status])}>{t(`civ.status.${s.status}` as never)}</span>
                        {s.detail && <span className="ml-1.5 text-ink-3">{s.detail}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {(b.next.length > 0 || b.action) && (
                <div className="mt-2 border-t border-line pt-2">
                  <div className="label-xs mb-1">{t("civ.block.next")}</div>
                  {b.next.map((n) => <p key={n} className="text-xs leading-snug text-ink-2">{n}</p>)}
                  {b.action && (
                    <button type="button" disabled={busy} onClick={() => act(b.action!.action)} className="mt-1.5 min-h-9 rounded-lg border border-signal/50 bg-signal/10 px-3 text-xs font-medium text-signal hover:bg-signal/15 disabled:opacity-50">{b.action.label}</button>
                  )}
                </div>
              )}
            </details>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
