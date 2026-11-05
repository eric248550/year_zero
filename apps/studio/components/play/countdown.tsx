"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import { useI18n } from "@/components/i18n";

/** Time left in the current world year. Refreshes the page when the year turns. */
export function Countdown({ nextTickAt }: { nextTickAt: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const target = nextTickAt ? Date.parse(nextTickAt) : null;
  useEffect(() => {
    if (target === null) return;
    const ms = target - Date.now() + 1500;
    const id = setTimeout(() => router.refresh(), Math.max(1000, Math.min(ms, 2_147_000_000)));
    return () => clearTimeout(id);
  }, [target, router]);

  if (target === null) return <span className="text-ink-3">{t("play.manualClock")}</span>;
  if (now === null) return null;
  const left = Math.max(0, target - now);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const time = left < 60_000 ? t("play.time.soon") : h > 0 ? t("play.time.hm", { h, m }) : t("play.time.m", { m });
  return (
    <span className="inline-flex items-center gap-1.5">
      <Hourglass size={13} aria-hidden className="text-signal" />
      {t("play.nextTick", { time })}
    </span>
  );
}
