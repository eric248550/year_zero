"use client";

import { Dices, UserRound } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { useAct } from "./use-act";

export interface CandidateView {
  id: string;
  name: string;
  kind: "child" | "ward" | "companion";
  age: number;
  home: string;
}

export function Succession({ dead, candidates }: {
  dead: { name: string; year: number; age: number; cause: string } | null;
  candidates: CandidateView[];
}) {
  const { t } = useI18n();
  const { act, busy, error } = useAct();
  return (
    <div className="space-y-6 py-8">
      {dead && (
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("play.dead.title", { name: dead.name })}</h1>
          <p className="text-ink-2">{t("play.dead.body", { year: dead.year, age: dead.age, cause: dead.cause })}</p>
        </div>
      )}
      <section className="space-y-2">
        <h2 className="label-xs">{t("play.dead.continue")}</h2>
        {candidates.length === 0 && dead && <p className="text-sm text-ink-3">{t("play.dead.none", { name: dead.name })}</p>}
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => void act({ type: "CONTINUE_AS", mode: "character", characterId: c.id })}
            className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-surface-2"
          >
            <UserRound size={20} className="shrink-0 text-signal" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{c.name}</span>
              <span className="block text-xs text-ink-3">{t(`play.dead.kind.${c.kind}`)} · {t("play.me.age", { age: c.age })} · {c.home}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void act({ type: "CONTINUE_AS", mode: "random" })}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong p-3.5 text-left transition-colors hover:bg-surface-2"
        >
          <Dices size={20} className="shrink-0 text-ink-2" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("play.dead.random")}</span>
            <span className="block text-xs text-ink-3">{t("play.dead.randomDesc")}</span>
          </span>
        </button>
      </section>
      {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
    </div>
  );
}
