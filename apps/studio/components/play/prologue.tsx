"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { PROLOGUE_ORDER, PROLOGUE_STEPS, type PrologueStep } from "@genesis/schemas";
import { useI18n } from "@/components/i18n";
import { buttonClass } from "@/components/ui";
import { Countdown } from "./countdown";
import { useAct } from "./use-act";

/** The three first-session choices. Each result shows at once, before moving on. */
export function Prologue({ done, nextTickAt }: { done: string[]; nextTickAt: string | null }) {
  const { t } = useI18n();
  const { act, busy, error, refresh } = useAct();
  const step = PROLOGUE_ORDER.find((s) => !done.includes(s)) as PrologueStep | undefined;
  const [result, setResult] = useState<string | null>(null);

  if (!step) {
    return (
      <div className="space-y-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("play.pro.done.title")}</h1>
        <p className="text-ink-2">{t("play.pro.done.body")}</p>
        <p className="text-sm"><Countdown nextTickAt={nextTickAt} /></p>
      </div>
    );
  }
  const n = PROLOGUE_ORDER.indexOf(step) + 1;

  async function choose(choiceId: string) {
    const r = await act({ type: "PROLOGUE", step, choiceId }, { refresh: false });
    if (!r) return;
    const other = r.events[0]?.characterIds[1];
    const name = (other && r.names[other]) || t("play.pro.someone");
    setResult(t(`play.pro.result.${choiceId as "surface"}`, { name }));
  }

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-6 py-8">
      <div className="label-xs text-signal">{t("play.pro.step", { n })}</div>
      <h1 className="text-2xl font-semibold tracking-tight">{t(`play.pro.${step}.title`)}</h1>
      {result ? (
        <>
          <p className="text-lg leading-relaxed motion-safe:animate-[fadein_0.6s_ease-out_both]">{result}</p>
          <button
            type="button"
            className={buttonClass("primary", "lg", "self-start")}
            onClick={() => {
              setResult(null);
              refresh();
            }}
          >
            {t("play.pro.continue")} <ArrowRight size={18} />
          </button>
        </>
      ) : (
        <>
          <p className="text-lg leading-relaxed text-ink-2">{t(`play.pro.${step}.body`)}</p>
          <div className="grid gap-2">
            {PROLOGUE_STEPS[step].map((c) => (
              <button key={c} type="button" disabled={busy} onClick={() => void choose(c)} className={buttonClass("secondary", "lg", "justify-start text-left")}>
                {t(`play.pro.${step}.${c}` as "play.pro.first_climb.surface")}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
    </div>
  );
}
