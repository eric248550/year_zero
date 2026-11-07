"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, BookMarked, BookOpen, Gauge, GitCompareArrows, Globe2, ScrollText, Radio } from "lucide-react";
import { useI18n } from "./i18n";
import type { MessageKey } from "@/lib/i18n/core";

export const NAV = [
  { href: "/", label: "nav.story", icon: BookMarked, mobile: true, advanced: false },
  { href: "/history", label: "nav.history", icon: ScrollText, mobile: true, advanced: false },
  { href: "/world", label: "nav.world", icon: Globe2, mobile: true, advanced: false },
  { href: "/simulate", label: "nav.simulate", icon: Activity, mobile: true, advanced: false },
  { href: "/content", label: "nav.content", icon: BookOpen, mobile: true, advanced: true },
  { href: "/overview", label: "nav.overview", icon: Gauge, mobile: false, advanced: true },
  { href: "/compare", label: "nav.compare", icon: GitCompareArrows, mobile: false, advanced: true },
] as const satisfies readonly { label: MessageKey; [k: string]: unknown }[];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.filter((n) => n.mobile).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={clsx("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-signal" : "text-ink-3 hover:text-ink")}
              >
                <span className={clsx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-signal/15")}>
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                </span>
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav({ footer }: { footer?: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-5 backdrop-blur lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-3">
        <span className="flex size-9 items-center justify-center rounded-xl border border-signal/40 bg-signal/10 text-signal">
          <Radio size={18} />
        </span>
        <span>
          <span className="block text-[15px] font-semibold tracking-tight">Genesis Studio</span>
          <span className="block text-[11px] text-ink-3">{t("nav.tagline")}</span>
        </span>
      </Link>
      {[false, true].map((advanced) => (
      <div key={String(advanced)} className={advanced ? "mt-6" : undefined}>
      {advanced && <div className="label-xs mb-1.5 px-3">{t("nav.advanced")}</div>}
      <ul className="space-y-1">
        {NAV.filter((n) => n.advanced === advanced).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={clsx("flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors", active ? "bg-signal/12 text-signal" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
              >
                <Icon size={18} />
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
      </div>
      ))}
      <div className="mt-auto">{footer}</div>
    </aside>
  );
}
