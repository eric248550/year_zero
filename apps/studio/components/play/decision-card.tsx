"use client";

import clsx from "clsx";
import { useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { useAct } from "./use-act";

export interface DecisionView {
  id: string;
  title: string;
  text: string;
  choices: { id: string; label: string; description: string | null }[];
  myChoice: string | null;
  others: number;
  /** Only this player decides, and the outcome shows as soon as they choose. */
  instant: boolean;
  /** One collective decision: the majority wins, and a player's voice brings a few neighbours along. */
  vote?: boolean;
  /** Hidden until this time (ISO), so a year's events arrive one by one. */
  appearAt: string | null;
}

/** One pending decision. The player can change their answer until the year ends. */
export function DecisionCard({ d }: { d: DecisionView }) {
  const { t } = useI18n();
  const { act, busy, error, refresh } = useAct();
  const [outcome, setOutcome] = useState<{ title: string; text: string }[] | null>(null);
  const mine = d.choices.find((c) => c.id === d.myChoice);

  async function choose(choiceId: string) {
    const r = await act({ type: "CHOOSE", decisionId: d.id, choiceId }, { refresh: false });
    if (!r) return;
    // Resolved on the spot: show what happened before the card goes away.
    if (r.events.length > 0) setOutcome(r.events.map((e) => ({ title: e.title, text: e.text })));
    else refresh();
  }

  if (outcome) {
    return (
      <article className="card space-y-3 border-signal/40 p-4">
        <div className="label-xs text-signal">{t("play.decisions.outcome")}</div>
        {outcome.map((o, i) => (
          <div key={i} className="space-y-1">
            <h3 className="text-[16px] font-semibold leading-snug">{o.title}</h3>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-2">{o.text}</p>
          </div>
        ))}
        <button type="button" onClick={refresh} className="min-h-10 rounded-xl border border-line-strong bg-surface-2 px-4 text-sm font-medium hover:bg-surface-3">{t("play.decisions.ok")}</button>
      </article>
    );
  }

  return (
    <article className="card space-y-3 p-4">
      <h3 className="text-[17px] font-semibold leading-snug">{d.title}</h3>
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-2">{d.text}</p>
      <div className="grid gap-2">
        {d.choices.map((c) => {
          const selected = c.id === d.myChoice;
          return (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              aria-pressed={selected}
              onClick={() => void choose(c.id)}
              className={clsx("flex min-h-12 items-start gap-2 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors", selected ? "border-signal/60 bg-signal/12" : "border-line-strong bg-surface-2 hover:bg-surface-3")}
            >
              <span className={clsx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-signal bg-signal text-black" : "border-line-strong")}>
                {selected && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{c.label}</span>
                {c.description && <span className="mt-0.5 block text-xs text-ink-3">{c.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-3">
        {d.instant ? t("play.decisions.instant") : mine ? t("play.decisions.chosen", { choice: mine.label }) : t("play.decisions.autopilot")}
        {d.vote ? <> · {t("play.decisions.vote", { n: d.others + 1 })}</> : d.others > 0 && <> · {t("play.decisions.others", { n: d.others })}</>}
      </p>
      {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
    </article>
  );
}
