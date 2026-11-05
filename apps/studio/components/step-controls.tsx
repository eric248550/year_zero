"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { FastForward, Pause, Play, SkipForward } from "lucide-react";
import { api } from "@/lib/client-api";
import { buttonClass, ProgressBar } from "./ui";
import { useI18n } from "./i18n";

interface StepResponse {
  fromTick: number;
  toTick: number;
  events: number;
  highlights: { id: string; tick: number; title: string; importance: string }[];
  rejectedActions: { reason: string }[];
  rejectedEvents: { tick: number; definitionId: string; reason: string }[];
  population: number;
  status: string;
}

const CHUNK = 10;

/**
 * Advances the active run through the API in small chunks so the UI never
 * blocks; long batches show progress and can be stopped between chunks.
 */
export function StepControls({ runId, disabled, compact }: { runId: string; disabled?: boolean; compact?: boolean }) {
  const router = useRouter();
  const { t, term } = useI18n();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState<{ target: number; done: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<StepResponse | null>(null);
  const [highlights, setHighlights] = useState<StepResponse["highlights"]>([]);
  const stopRef = useRef(false);

  async function run(total: number) {
    setError(null);
    setHighlights([]);
    stopRef.current = false;
    setRunning({ target: total, done: 0 });
    let done = 0;
    const collected: StepResponse["highlights"] = [];
    try {
      while (done < total && !stopRef.current) {
        const n = Math.min(CHUNK, total - done);
        const res = await api<StepResponse>(`/api/runs/${runId}/step`, { ticks: n });
        done += res.toTick - res.fromTick;
        collected.push(...res.highlights);
        setLog(res);
        setHighlights([...collected].slice(-6));
        setRunning({ target: total, done });
        startTransition(() => router.refresh());
        if (res.population === 0) break;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(null);
      startTransition(() => router.refresh());
    }
  }

  const busy = running !== null;
  return (
    <div className="space-y-3">
      <div className={clsx("grid gap-2", compact ? "grid-cols-3" : "grid-cols-3")}>
        <button className={buttonClass("secondary", "lg", "whitespace-nowrap")} disabled={disabled || busy} onClick={() => run(1)} aria-label={t("step.aria1")}>
          <Play size={16} /> +1
        </button>
        <button className={buttonClass("secondary", "lg", "whitespace-nowrap")} disabled={disabled || busy} onClick={() => run(10)} aria-label={t("step.aria10")}>
          <SkipForward size={16} /> +10
        </button>
        {busy ? (
          <button className={buttonClass("danger", "lg")} onClick={() => (stopRef.current = true)}>
            <Pause size={16} /> {t("step.stop")}
          </button>
        ) : (
          <button className={buttonClass("primary", "lg", "whitespace-nowrap")} disabled={disabled} onClick={() => run(100)} aria-label={t("step.aria100")}>
            <FastForward size={16} /> {t("step.run100")}
          </button>
        )}
      </div>

      {busy && (
        <div aria-live="polite" className="space-y-1.5">
          <div className="flex justify-between text-xs text-ink-2">
            <span>{stopRef.current ? t("step.stopping") : t("step.simulating")}</span>
            <span className="num">{t("step.progress", { done: running.done, total: running.target })}</span>
          </div>
          <ProgressBar value={running.done} max={running.target} />
        </div>
      )}

      {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {!busy && log && !compact && (
        <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs text-ink-2" aria-live="polite">
          {t("step.lastBatch", { tick: log.toTick, population: log.population, status: term.status(log.status) })}
          {log.rejectedActions.length > 0 && <div className="mt-1 text-warn">{t("step.rejectedAction")} {log.rejectedActions.map((r) => r.reason).join("; ")}</div>}
          {log.rejectedEvents.length > 0 && <div className="mt-1 text-warn">{t("step.rejectedEvents", { count: log.rejectedEvents.length })}</div>}
        </div>
      )}

      {highlights.length > 0 && (
        <ul className="space-y-1 text-[13px]">
          {highlights.map((h) => (
            <li key={h.id} className="flex gap-2">
              <span className="num shrink-0 text-ink-3">t{h.tick}</span>
              <Link href={`/history/${h.id}`} className="truncate text-ink-2 hover:text-signal">{h.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
