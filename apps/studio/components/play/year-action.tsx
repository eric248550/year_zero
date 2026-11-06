"use client";

import { useState } from "react";
import clsx from "clsx";
import { BookOpen, Hammer, HeartHandshake, Moon, Search } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { bondTier } from "./bond";
import { useAct } from "./use-act";

export type YearActionId = "scavenge" | "work" | "study" | "visit" | "rest";

export interface YearActionView {
  /** This year's activity, once chosen. */
  done: { title: string; text: string } | null;
  options: { id: YearActionId; minAge: number; available: boolean; reason: "age" | "attributes" | null }[];
  /** People at home to spend time with, closest first. */
  people: { id: string; name: string; bond: number }[];
}

const ICONS = { scavenge: Search, work: Hammer, study: BookOpen, visit: HeartHandshake, rest: Moon } as const;

/** One thing to do every year, with the result shown at once. */
export function YearActionCard({ v }: { v: YearActionView }) {
  const { t } = useI18n();
  const { act, busy, error } = useAct();
  const [visiting, setVisiting] = useState(false);

  if (v.done) {
    return (
      <article className="card space-y-1.5 border-signal/30 p-4">
        <div className="label-xs text-signal">{t("play.year.doneLabel")}</div>
        <h3 className="text-[15px] font-semibold leading-snug">{v.done.title}</h3>
        <p className="text-sm leading-relaxed text-ink-2">{v.done.text}</p>
        <p className="pt-1 text-xs text-ink-3">{t("play.year.next")}</p>
      </article>
    );
  }

  if (visiting) {
    return (
      <article className="card space-y-3 p-4">
        <h3 className="text-[15px] font-semibold">{t("play.year.visit.pick")}</h3>
        {v.people.length === 0 ? (
          <p className="text-sm text-ink-3">{t("play.year.visit.nobody")}</p>
        ) : (
          <div className="grid gap-2">
            {v.people.map((p) => {
              const tier = bondTier(p.bond);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ type: "YEAR_ACTION", action: "visit", characterId: p.id })}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2 text-left text-sm hover:bg-surface-3"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className={clsx("shrink-0 text-xs", tier.tone)}>{t(tier.key)}</span>
                </button>
              );
            })}
          </div>
        )}
        <button type="button" onClick={() => setVisiting(false)} className="text-sm text-ink-3 underline-offset-2 hover:underline">{t("play.year.back")}</button>
        {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
      </article>
    );
  }

  return (
    <article className="card space-y-3 p-4">
      <p className="text-sm text-ink-2">{t("play.year.prompt")}</p>
      <div className="grid gap-2">
        {v.options.map((o) => {
          const Icon = ICONS[o.id];
          return (
            <button
              key={o.id}
              type="button"
              disabled={busy || !o.available}
              onClick={() => (o.id === "visit" ? setVisiting(true) : void act({ type: "YEAR_ACTION", action: o.id }))}
              className="flex min-h-12 items-start gap-3 rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-3 disabled:opacity-45 disabled:hover:bg-surface-2"
            >
              <Icon size={17} aria-hidden className="mt-0.5 shrink-0 text-signal" />
              <span className="min-w-0">
                <span className="block font-medium">{t(`play.year.${o.id}`)}</span>
                <span className="mt-0.5 block text-xs text-ink-3">
                  {o.reason === "age" ? t("play.year.tooYoung", { age: o.minAge }) : o.reason === "attributes" ? t("play.year.noAttributes") : t(`play.year.${o.id}.hint`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
    </article>
  );
}
