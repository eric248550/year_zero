import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Radio } from "lucide-react";
import { currentYear } from "@genesis/narrative";
import { BottomNav, SideNav } from "@/components/nav";
import { StatusDot } from "@/components/ui";
import { loadActiveRun } from "@/lib/server";
import { worldStatus } from "@genesis/simulation";
import { I18nProvider, LocaleSwitcher } from "@/components/i18n";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: "Genesis Studio", template: "%s · Genesis Studio" },
    description: t("meta.description"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0c0b",
};

export const dynamic = "force-dynamic";

async function RunChip() {
  const { t } = await getI18n();
  let run: ReturnType<typeof loadActiveRun> = null;
  try {
    run = loadActiveRun();
  } catch {
    run = null;
  }
  if (!run) {
    return (
      <Link href="/simulate" className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink-2">
        {t("layout.noRun")}
      </Link>
    );
  }
  const status = worldStatus(run.state);
  return (
    <Link href="/simulate" className="flex min-w-0 items-center gap-2 rounded-full border border-line-strong bg-surface-2/80 py-1.5 pl-2.5 pr-3 text-xs" title={t("layout.activeRunHint")}>
      <StatusDot status={status} />
      <span className="truncate font-medium text-ink">{run.summary.name}</span>
      <span className="num shrink-0 text-ink-3">
        {currentYear(run.state)} · t{run.state.tick}
      </span>
    </Link>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
        <div className="flex min-h-dvh">
          <SideNav footer={<div className="space-y-2 px-1"><RunChip /><LocaleSwitcher full /></div>} />
          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur-xl lg:hidden" style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}>
              <Link href="/" className="flex shrink-0 items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg border border-signal/40 bg-signal/10 text-signal">
                  <Radio size={16} />
                </span>
                <span className="text-sm font-semibold tracking-tight">Genesis</span>
              </Link>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0">
                  <RunChip />
                </div>
                <LocaleSwitcher />
              </div>
            </header>
            <main className="pb-safe mx-auto w-full max-w-6xl px-4 pt-5 lg:px-8 lg:pt-8">{children}</main>
          </div>
        </div>
        <BottomNav />
        </I18nProvider>
      </body>
    </html>
  );
}
