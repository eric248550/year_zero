"use client";

import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { HistoricalEvent, ResourceId, StateChange } from "@genesis/schemas";
import { Pill, importanceTone } from "./ui";
import { formatValue } from "@/lib/format";
import { RESOURCE_META } from "@/lib/resource-meta";
import { useI18n } from "./i18n";


export function ResourceTile({ resource, value, perCapita, delta }: { resource: ResourceId; value: number; perCapita?: number; delta?: number }) {
  const { t, term, locale } = useI18n();
  const m = RESOURCE_META[resource];
  const Icon = m.icon;
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon size={14} className={m.text} aria-hidden />
        <span className="label-xs">{term.resource(resource)}</span>
      </div>
      <div className="num mt-1 text-xl font-semibold text-ink">{Math.round(value).toLocaleString(locale)}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-ink-3">
        {perCapita !== undefined && <span className="num">{t("resource.perPerson", { n: perCapita.toFixed(1) })}</span>}
        {delta !== undefined && delta !== 0 && (
          <span className={clsx("num", delta > 0 ? "text-ok" : "text-danger")}>{delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}</span>
        )}
      </div>
    </div>
  );
}

export function EventRow({ event, href, compact }: { event: HistoricalEvent; href: string; compact?: boolean }) {
  const { t, term } = useI18n();
  return (
    <Link href={href} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60 active:bg-surface-2">
      <div className="num w-11 shrink-0 pt-0.5 text-right text-[12px] leading-tight text-ink-3">
        <div className="text-ink-2">{event.year}</div>
        <div>t{event.tick}</div>
      </div>
      <div className="relative flex shrink-0 flex-col items-center self-stretch pt-1.5">
        <span className={clsx("size-2.5 rounded-full border-2", event.importance === "critical" ? "border-danger bg-danger/30" : event.importance === "major" ? "border-signal bg-signal/30" : event.importance === "notable" ? "border-knowledge bg-knowledge/20" : "border-line-strong bg-surface-3")} />
        <span className="mt-1 w-px flex-1 bg-line" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[14px] font-medium leading-snug text-ink group-hover:text-signal">{event.title}</h3>
          <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-3" />
        </div>
        {!compact && <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{event.text.split("\n\n")[0]}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Pill tone={importanceTone(event.importance)}>{term.importance(event.importance)}</Pill>
          <Pill>{term.category(event.category)}</Pill>
          {event.kind === "narrative" && <Pill tone="knowledge">{t("event.storylet")}</Pill>}
          {event.choice && <Pill tone="neutral">⤷ {event.choice.label}</Pill>}
          {event.causeIds.length > 0 && <Pill tone="neutral">{t("event.caused")}</Pill>}
          {event.changes.length > 0 && !compact && <Pill tone="neutral">{t("event.changes", { count: event.changes.length })}</Pill>}
        </div>
      </div>
    </Link>
  );
}

export function ChangeList({ changes }: { changes: StateChange[] }) {
  const { t } = useI18n();
  const yesNo: [string, string] = [t("common.yes"), t("common.no")];
  if (changes.length === 0) return <p className="px-4 pb-4 text-sm text-ink-3">{t("event.noChanges")}</p>;
  return (
    <ul className="divide-y divide-line">
      {changes.map((c, i) => {
        const delta = typeof c.before === "number" && typeof c.after === "number" ? c.after - c.before : null;
        return (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="truncate text-ink">{c.label}</div>
              <div className="num truncate text-[11px] text-ink-3">{c.path}</div>
            </div>
            <div className="num flex shrink-0 items-center gap-1.5 text-[13px]">
              <span className="text-ink-3">{formatValue(c.before, yesNo)}</span>
              <span className="text-ink-3">→</span>
              <span className="text-ink">{formatValue(c.after, yesNo)}</span>
              {delta !== null && delta !== 0 && <span className={clsx("ml-1", delta > 0 ? "text-ok" : "text-danger")}>({delta > 0 ? "+" : ""}{Math.round(delta * 100) / 100})</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
