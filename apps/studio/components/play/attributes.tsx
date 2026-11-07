import { ATTRIBUTES, type Attributes } from "@genesis/schemas";
import clsx from "clsx";
import { ProgressBar } from "@/components/ui";
import type { createI18n } from "@/lib/i18n/core";

const COLOR = { health: "bg-ok", social: "bg-signal", knowledge: "bg-knowledge", survival: "bg-materials" } as const;

type T = ReturnType<typeof createI18n>["t"];

/** A word for a 0–100 value, so the number reads at a glance. */
function level(v: number): "low" | "fair" | "good" | "great" {
  return v < 30 ? "low" : v < 55 ? "fair" : v < 75 ? "good" : "great";
}

/** A character's four attributes. `full` adds what each one does. */
export function AttributeBars({ a, t, full }: { a: Attributes; t: T; full?: boolean }) {
  return (
    <div className={clsx("grid grid-cols-2", full ? "gap-x-4 gap-y-3.5" : "gap-x-3 gap-y-1.5")}>
      {ATTRIBUTES.map((k) => (
        <div key={k} className="min-w-0 space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-ink-2">{t(`play.attr.${k}`)}</span>
            <span className="num shrink-0">
              {full && <span className={clsx("mr-1.5", level(a[k]) === "low" ? "text-danger" : "text-ink-3")}>{t(`play.attr.level.${level(a[k])}`)}</span>}
              {a[k]}
            </span>
          </div>
          <ProgressBar value={a[k]} max={100} color={COLOR[k]} />
          {full && <p className="text-[11px] leading-snug text-ink-3">{t(`play.attr.${k}.hint`)}</p>}
        </div>
      ))}
    </div>
  );
}
