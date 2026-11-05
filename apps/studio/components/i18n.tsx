"use client";

import { createContext, useContext, useMemo, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Languages } from "lucide-react";
import { createI18n, LOCALE_COOKIE, LOCALE_LABELS, type I18n, type Locale } from "@/lib/i18n/core";

const I18nContext = createContext<I18n>(createI18n("en"));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** Toggles between English and Traditional Chinese; persisted in a cookie for a year. */
export function LocaleSwitcher({ className, full }: { className?: string; full?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === "en" ? "zh-TW" : "en";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        document.documentElement.lang = next;
        startTransition(() => router.refresh());
      }}
      aria-label={t("locale.switchTo", { language: LOCALE_LABELS[next] })}
      title={t("locale.switchTo", { language: LOCALE_LABELS[next] })}
      className={clsx(
        "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2/80 px-2.5 text-xs font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-60",
        className,
      )}
    >
      <Languages size={14} aria-hidden />
      {full ? LOCALE_LABELS[next] : next === "en" ? "EN" : "中文"}
    </button>
  );
}
