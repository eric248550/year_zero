"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { api } from "@/lib/client-api";
import type { WorldInfo } from "@/lib/play";

export function WorldList({ worlds, current }: { worlds: WorldInfo[]; current: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enter(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api("/api/play/world", { worldId: id });
      router.push("/play");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {worlds.map((w) => {
        const here = w.id === current;
        const me = w.me
          ? w.me.status === "active" && w.me.name
            ? t("play.worlds.youAre", { name: w.me.name })
            : w.me.status === "awaiting_succession"
              ? t("play.worlds.youDied")
              : t("play.worlds.youWaiting")
          : t("play.worlds.notJoined");
        return (
          <button
            key={w.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void enter(w.id)}
            className={clsx(
              "card flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-surface-2",
              here && "border-signal/50",
            )}
          >
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold">{w.name}</span>
                {here && <span className="shrink-0 rounded-full bg-signal/15 px-2 py-0.5 text-[11px] text-signal">{t("play.worlds.current")}</span>}
              </span>
              <span className="num block text-xs text-ink-3" suppressHydrationWarning>
                {t("play.worlds.opened", { date: new Date(w.openedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}
              </span>
              <span className="num block text-xs text-ink-2">
                {t("play.worlds.meta", { year: w.year, tick: w.tick, players: w.players, population: w.population })}
              </span>
              <span className={clsx("block text-xs", w.me ? "text-ok" : "text-ink-3")}>{me}</span>
            </span>
            <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-3" />
          </button>
        );
      })}
      {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
    </div>
  );
}
