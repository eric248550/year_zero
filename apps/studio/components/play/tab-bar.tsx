"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Globe2, House, Sun, Users } from "lucide-react";
import { useI18n } from "@/components/i18n";

const TABS = [
  { href: "/play", label: "play.tab.year", icon: Sun },
  { href: "/play/people", label: "play.tab.people", icon: Users },
  { href: "/play/settlement", label: "play.tab.settlement", icon: House },
  { href: "/play/world", label: "play.tab.world", icon: Globe2 },
] as const;

export function PlayTabBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/play" ? pathname === "/play" : pathname.startsWith(href);
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
