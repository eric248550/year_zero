"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import { useI18n } from "@/components/i18n";

interface ClockProps {
  nextTickAt: string | null;
  /** Length of one world year in real minutes (may be fractional, e.g. 0.5 = 30 s). */
  minutes: number | null;
}

/**
 * Shared clock for the countdown text and the progress bar: re-renders every
 * second and refreshes the page shortly after the year turns (the server
 * advances the world lazily on that request).
 */
function useYearClock({ nextTickAt, minutes }: ClockProps) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = nextTickAt ? Date.parse(nextTickAt) : null;
  useEffect(() => {
    if (target === null) return;
    const ms = target - Date.now() + 800;
    const id = setTimeout(() => router.refresh(), Math.max(1000, Math.min(ms, 2_147_000_000)));
    return () => clearTimeout(id);
  }, [target, router]);
  if (target === null || now === null) return { target, left: null, progress: null };
  const left = Math.max(0, target - now);
  const span = minutes ? minutes * 60_000 : null;
  const progress = span ? Math.min(1, Math.max(0, 1 - left / span)) : null;
  return { target, left, progress };
}

/** Time left in the current world year. */
export function Countdown(props: ClockProps) {
  const { t } = useI18n();
  const { target, left } = useYearClock(props);
  if (target === null) return <span className="text-ink-3">{t("play.manualClock")}</span>;
  if (left === null) return null;
  const total = Math.ceil(left / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const time =
    total <= 0 ? t("play.time.soon")
    : h > 0 ? t("play.time.hm", { h, m })
    : m >= 10 ? t("play.time.m", { m })
    : m > 0 ? t("play.time.ms", { m, s: String(s).padStart(2, "0") })
    : t("play.time.s", { s });
  return (
    <span className="inline-flex items-center gap-1.5">
      <Hourglass size={13} aria-hidden className="text-signal" />
      <span className="num">{t("play.nextTick", { time })}</span>
    </span>
  );
}

/** Thin bar showing how far the current world year has run. */
export function YearProgress({ className = "", ...props }: ClockProps & { className?: string }) {
  const { t } = useI18n();
  const { progress } = useYearClock(props);
  if (progress === null) return null;
  const pct = Math.round(progress * 100);
  return (
    <div
      role="progressbar"
      aria-label={t("play.yearProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`h-1 w-full overflow-hidden bg-line ${className}`}
    >
      <div className="h-full bg-signal transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}
