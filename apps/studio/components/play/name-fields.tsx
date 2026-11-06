"use client";

import { useI18n } from "@/components/i18n";

/** Family and given name inputs, in the order the reader's language expects. */
export function NameFields({ given, family, onGiven, onFamily, placeholder, idPrefix }: {
  given: string;
  family: string;
  onGiven: (v: string) => void;
  onFamily: (v: string) => void;
  placeholder?: string;
  idPrefix: string;
}) {
  const { t, locale } = useI18n();
  const field = (kind: "given" | "family") => (
    <label key={kind} className="block min-w-0 space-y-1.5">
      <span className="label-xs">{t(`play.who.${kind}`)}</span>
      <input
        id={`${idPrefix}-${kind}`}
        value={kind === "given" ? given : family}
        onChange={(e) => (kind === "given" ? onGiven : onFamily)(e.target.value)}
        maxLength={20}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 placeholder:text-ink-3"
      />
    </label>
  );
  const order = locale === "zh-TW" ? (["family", "given"] as const) : (["given", "family"] as const);
  return <div className="grid grid-cols-[2fr_3fr] gap-2">{order.map(field)}</div>;
}
