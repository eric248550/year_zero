import clsx from "clsx";
import { Check, Circle } from "lucide-react";
import type { CivilizationStatus } from "@genesis/simulation";
import { ProgressBar } from "@/components/ui";
import type { createI18n, MessageKey } from "@/lib/i18n/core";

type T = ReturnType<typeof createI18n>["t"];

/**
 * The world's main line, rebuilding civilization: which stage it is in and
 * what that stage still needs. `compact` shows only the current stage.
 */
export function CivilizationCard({ civ, t, compact }: { civ: CivilizationStatus; t: T; compact?: boolean }) {
  const current = civ.stages[civ.stage];
  const complete = civ.stage >= civ.stages.length;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="label-xs text-signal">{t("civ.title")}</div>
        <span className="num text-xs text-ink-3">{t("civ.progress", { done: civ.done, total: civ.total })}</span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {civ.stages.map((s, i) => (
          <span key={s.id} className={clsx("h-1.5 flex-1 rounded-full", s.done ? "bg-signal" : i === civ.stage ? "bg-signal/35" : "bg-line-strong")} />
        ))}
      </div>
      {complete ? (
        <div>
          <h3 className="text-lg font-semibold">{t("civ.stage.dawn")}</h3>
          <p className="text-sm text-ink-2">{t("civ.stage.dawn.body")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <h3 className="text-lg font-semibold">{t("civ.stageN", { n: civ.stage + 1, name: t(`civ.stage.${current!.id}`) })}</h3>
            <p className="text-sm text-ink-2">{t(`civ.stage.${current!.id}.body`)}</p>
          </div>
          <ul className="space-y-1.5">
            {current!.milestones.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-sm">
                {m.done ? <Check size={15} className="mt-0.5 shrink-0 text-signal" /> : <Circle size={15} className="mt-0.5 shrink-0 text-ink-3" />}
                <span className={clsx("min-w-0", m.done && "text-ink-3 line-through")}>
                  {t(`civ.m.${current!.id}.${m.id}` as MessageKey)}
                  {!m.done && m.current !== null && m.check.kind !== "tech" && m.check.kind !== "flag" && (
                    <span className="num ml-1.5 text-xs text-ink-3">{m.current}/{m.check.min}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!compact && <ProgressBar value={current!.milestones.filter((m) => m.done).length} max={current!.milestones.length} />}
        </div>
      )}
      {!compact && (
        <ol className="grid grid-cols-5 gap-1 pt-1 text-center text-[11px]">
          {civ.stages.map((s, i) => (
            <li key={s.id} className={clsx(s.done ? "text-signal" : i === civ.stage ? "text-ink" : "text-ink-3")}>{t(`civ.stage.${s.id}`)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
