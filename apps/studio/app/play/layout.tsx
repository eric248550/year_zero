import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { LocaleSwitcher } from "@/components/i18n";
import { Countdown, LiveRefresh, YearProgress } from "@/components/play/countdown";
import { PlayTabBar } from "@/components/play/tab-bar";
import { loadPlay } from "@/lib/play";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: { absolute: "Year Zero" }, description: t("play.meta") };
}

/** Player app chrome: a phone-width column, the year and its countdown on top, four tabs below. */
export default async function PlayLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  const ctx = await loadPlay();
  const playing = !!ctx?.character && (ctx.player?.prologue?.length ?? 0) >= 3;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur-xl"
        style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2 text-sm font-semibold tracking-tight">
            <span className="shrink-0">Year Zero</span>
            {ctx && <span className="num shrink-0 text-ink-3">{t("play.yearN", { year: ctx.state.startYear + ctx.state.tick })}</span>}
            {ctx && (
              <Link href="/play/worlds" className="inline-flex min-w-0 items-center gap-0.5 text-xs font-normal text-ink-2 hover:text-ink" aria-label={t("play.worlds.switch")}>
                <span className="truncate">{ctx.worldName}</span>
                <ChevronDown size={12} aria-hidden className="shrink-0" />
              </Link>
            )}
          </div>
          {ctx && playing && <div className="truncate text-xs text-ink-2"><Countdown nextTickAt={ctx.clock.nextTickAt} minutes={ctx.clock.minutes} /></div>}
        </div>
        <LocaleSwitcher />
        {ctx && playing && <YearProgress nextTickAt={ctx.clock.nextTickAt} minutes={ctx.clock.minutes} className="absolute inset-x-0 bottom-0" />}
      </header>
      <main className={playing ? "flex-1 px-4 pb-28 pt-4" : "flex-1 px-4 pb-10"}>{children}</main>
      {playing && <PlayTabBar />}
      {playing && <LiveRefresh />}
    </div>
  );
}
