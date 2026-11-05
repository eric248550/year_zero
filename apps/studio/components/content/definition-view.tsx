"use client";

import { AlertTriangle, CircleX, Skull, Users } from "lucide-react";
import type { EventDefinition } from "@genesis/schemas";
import { describeCondition, describeEffect } from "@genesis/narrative";
import { Card, CardHeader, KeyValue, Pill, importanceTone } from "@/components/ui";
import { useI18n } from "@/components/i18n";

export interface Issue { path: string; message: string; code: string }

export function ValidationPanel({ errors, warnings }: { errors: Issue[]; warnings: Issue[] }) {
  const { t } = useI18n();
  if (errors.length === 0 && warnings.length === 0) {
    return <div className="rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">✓ {t("validation.pass")}</div>;
  }
  return (
    <div className="space-y-2" aria-live="polite">
      {errors.length > 0 && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-danger"><CircleX size={15} /> {t("validation.errors", { count: errors.length })}</div>
          <ul className="space-y-1 text-[13px]">
            {errors.map((e, i) => <li key={i}><span className="num text-ink-3">{e.path}</span> <span className="text-ink">{e.message}</span> <span className="num text-[11px] text-ink-3">[{e.code}]</span></li>)}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-warn"><AlertTriangle size={15} /> {t("content.warnings", { count: warnings.length })}</div>
          <ul className="space-y-1 text-[13px]">
            {warnings.map((e, i) => <li key={i}><span className="num text-ink-3">{e.path}</span> <span className="text-ink-2">{e.message}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[13px] text-ink-3">{empty}</p>;
  return <ul className="space-y-1">{items.map((t, i) => <li key={i} className="rounded-lg border border-line bg-surface-2/60 px-3 py-1.5 text-[13px] text-ink-2">{t}</li>)}</ul>;
}

/** Structured, human-readable rendering of an event definition (works for drafts and AI previews). */
export function DefinitionView({ def }: { def: EventDefinition }) {
  const { t, term } = useI18n();
  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone={importanceTone(def.importance)}>{term.importance(def.importance)}</Pill>
            <Pill>{term.category(def.category)}</Pill>
            <Pill>{t("event.scope", { scope: term.scope(def.scope) })}</Pill>
            <Pill>v{def.version}</Pill>
            <Pill tone="neutral">{t("def.source", { source: def.source })}</Pill>
          </div>
          <h2 className="mt-2 text-lg font-semibold">{def.title}</h2>
          <p className="mt-1 text-sm text-ink-2">{def.description}</p>
          <div className="mt-3 rounded-xl border border-line bg-surface-2/60 p-3 text-[13px]">
            <div className="label-xs mb-1">{t("def.narrativeTemplate")}</div>
            <div className="font-medium text-ink">{def.narrative.headline}</div>
            <div className="mt-1 text-ink-2">{def.narrative.text}</div>
          </div>
          <div className="mt-3">
            <KeyValue items={[
              [t("event.priority"), `${def.priority} / 10`],
              [t("def.chance"), `${Math.round(def.chance * 100)}%`],
              [t("def.cooldown"), t("def.cooldownValue", { n: def.cooldown })],
              [t("def.maxOccurrences"), def.maxOccurrences ?? t("def.unlimited")],
              [t("overview.storylines"), def.storylineIds.join(", ") || "—"],
            ]} />
          </div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("def.preconditions")} subtitle={t("def.preconditionsSub")} />
          <div className="px-4 pb-4"><Bullets items={def.preconditions.map(describeCondition)} empty={t("def.noPreconditions")} /></div>
        </Card>
        <Card>
          <CardHeader title={t("def.roles")} icon={<Users size={16} />} subtitle={t("def.rolesSub")} />
          <div className="px-4 pb-4">
            <Bullets
              items={def.roles.map((r) => `${r.id}${r.optional ? ` ${t("def.optional")}` : ""}: ${[r.profession ? term.profession(r.profession) : t("def.anyProfession"), r.minAge !== undefined ? t("def.ageMin", { n: r.minAge }) : null, r.maxAge !== undefined ? t("def.ageMax", { n: r.maxAge }) : null].filter(Boolean).join(", ")}${r.description ? ` — ${r.description}` : ""}`)}
              empty={t("def.noRoles")}
            />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("def.effects")} subtitle={t("def.effectsSub")} />
        <div className="px-4 pb-4"><Bullets items={def.effects.map(describeEffect)} empty={t("def.none")} /></div>
      </Card>
      {def.choices.length > 0 && (
        <Card>
          <CardHeader title={t("def.choices")} subtitle={t("def.choicesSub")} />
          <div className="space-y-3 px-4 pb-4">
            {def.choices.map((c) => (
              <div key={c.id} className="rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.label} <span className="num text-[11px] text-ink-3">{c.id}</span></span>
                  <span className="flex flex-wrap gap-1">{c.tags.map((x) => <Pill key={x}>{term.tag(x)}</Pill>)}</span>
                </div>
                {c.description && <p className="mt-1 text-[13px] text-ink-2">{c.description}</p>}
                <div className="mt-2 space-y-1 text-[13px]">
                  {c.costs && Object.keys(c.costs).length > 0 && <div className="text-warn">{t("def.costs")} {Object.entries(c.costs).map(([k, v]) => `${v} ${term.resource(k)}`).join(", ")}</div>}
                  {c.requires.length > 0 && <div className="text-ink-3">{t("def.requires")} {c.requires.map(describeCondition).join("; ")}</div>}
                  {c.requiresRoles.length > 0 && <div className="text-ink-3">{t("def.needsRole")} {c.requiresRoles.join(", ")}</div>}
                  {c.effects.map((e, i) => <div key={i} className="text-ink-2">→ {describeEffect(e)}</div>)}
                  {c.risk && (
                    <div className="mt-1 rounded-lg border border-danger/30 bg-danger/5 px-2 py-1.5 text-danger">
                      <Skull size={12} className="mr-1 inline" />{t("def.risk", { pct: Math.round(c.risk.chance * 100) })} {c.risk.effects.map(describeEffect).join("; ")}
                    </div>
                  )}
                  {c.outcome && <div className="italic text-ink-3">“{c.outcome}”</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
