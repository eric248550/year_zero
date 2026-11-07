"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, ChevronDown, Circle, CircleDot, CircleSlash, Users } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { api } from "@/lib/client-api";
import type { StoryEvent, StoryLine } from "@/lib/story";

/** One storyline as a short chapter list: what happened, what can happen next, and what to choose when it does. */
export function StorylineCard({ line, runId, defaultOpen }: { line: StoryLine; runId: string; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(!!defaultOpen);
  const next = line.beats.find((b) => b.status === "next");
  return (
    <article className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left hover:bg-surface-2/60">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold">{line.title}</h3>
            <span className="num shrink-0 text-xs text-ink-3">{t("story.progress", { done: line.done, total: line.total })}</span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {line.beats.map((b) => (
              <span key={b.id} className={clsx("h-1.5 flex-1 rounded-full", b.status === "done" ? "bg-signal" : b.status === "next" ? "bg-signal/35" : b.status === "missed" ? "bg-line" : "bg-line-strong")} />
            ))}
          </div>
          <p className="text-sm text-ink-2">
            {line.done >= line.total ? t("story.finished") : next ? t("story.nextUp", { beat: next.title }) : ""}
          </p>
        </div>
        <ChevronDown size={18} aria-hidden className={clsx("mt-1 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
          <p className="text-sm leading-relaxed text-ink-2">{line.summary}</p>
          <ol className="space-y-3">
            {line.beats.map((b) => (
              <li key={b.id} className="flex gap-3">
                <span className="mt-0.5 shrink-0">
                  {b.status === "done" ? <Check size={16} className="text-signal" /> : b.status === "missed" ? <CircleSlash size={16} className="text-ink-3" /> : b.status === "next" ? <CircleDot size={16} className="text-signal" /> : <Circle size={16} className="text-ink-3" />}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className={clsx("text-sm font-medium", (b.status === "later" || b.status === "missed") && "text-ink-3", b.status === "missed" && "line-through")}>{b.title}</div>
                  {b.status === "missed" && <p className="text-xs text-ink-3">{t("story.missed")}</p>}
                  <p className="text-xs text-ink-3">{b.description}</p>
                  {b.happened.map((h) => (
                    <Link key={h.historyId} href={`/history/${h.historyId}`} className="block rounded-lg bg-surface-2 px-3 py-2 text-[13px] hover:bg-surface-3">
                      <span className="num mr-2 text-ink-3">{h.year}</span>
                      {h.title}
                      {h.choice && <span className="text-ink-2"> · {t("story.chose", { choice: h.choice })}</span>}
                    </Link>
                  ))}
                  {b.status !== "done" && b.status !== "missed" && b.events.filter((e) => !e.never).map((e) => <UpcomingEvent key={e.id} e={e} runId={runId} />)}
                </div>
              </li>
            ))}
          </ol>
          {line.outcomes.length > 0 && (
            <div>
              <div className="label-xs mb-1.5">{t("story.outcomes")}</div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-ink-2">
                {line.outcomes.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function UpcomingEvent({ e, runId }: { e: StoryEvent; runId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(choiceId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/overrides`, { definitionId: e.id, choiceId });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-line-strong p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{e.title}</span>
        <span className={clsx("rounded-full px-2 py-0.5 text-[11px]", e.ready ? "bg-ok/15 text-ok" : "bg-surface-3 text-ink-3")}>
          {e.ready ? t("story.ready", { chance: Math.round(e.chance * 100) }) : t("story.notYet")}
        </span>
      </div>
      {!e.ready && e.needs.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-3">
          {e.needs.map((n, i) => <li key={i}>· {n}</li>)}
        </ul>
      )}
      {e.personal ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-3"><Users size={12} aria-hidden /> {t("story.playersDecide")}</p>
      ) : e.choices.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs text-ink-2">{t("story.whenItHappens")}</div>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip active={e.override === null} disabled={busy} onClick={() => void choose(null)} label={t("story.letCouncil")} />
            {e.choices.map((c) => (
              <ChoiceChip key={c.id} active={e.override === c.id} disabled={busy} onClick={() => void choose(c.id)} label={c.label} title={c.description ?? undefined} />
            ))}
          </div>
        </div>
      ) : null}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function ChoiceChip({ active, label, title, disabled, onClick }: { active: boolean; label: string; title?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={clsx("min-h-9 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors", active ? "border-signal/60 bg-signal/12 text-ink" : "border-line-strong bg-surface-2 text-ink-2 hover:bg-surface-3")}
    >
      {label}
    </button>
  );
}
