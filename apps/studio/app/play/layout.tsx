import type { Metadata } from "next";
import { LocaleSwitcher } from "@/components/i18n";
import { Countdown } from "@/components/play/countdown";
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
          <div className="text-sm font-semibold tracking-tight">Year Zero{ctx && <span className="num ml-2 text-ink-3">{t("play.yearN", { year: ctx.state.startYear + ctx.state.tick })}</span>}</div>
          {ctx && playing && <div className="truncate text-xs text-ink-2"><Countdown nextTickAt={ctx.clock.nextTickAt} /></div>}
        </div>
        <LocaleSwitcher />
      </header>
      <main className={playing ? "flex-1 px-4 pb-28 pt-4" : "flex-1 px-4 pb-10"}>{children}</main>
      {playing && <PlayTabBar />}
    </div>
  );
}
