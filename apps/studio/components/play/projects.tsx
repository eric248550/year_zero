"use client";

import clsx from "clsx";
import { useState } from "react";
import { Hammer } from "lucide-react";
import { ProgressBar } from "@/components/ui";
import { useI18n } from "@/components/i18n";
import { useAct } from "./use-act";

export interface ProjectItem {
  id: string;
  name: string;
  branch: string;
  effect: string;
  percent: number;
  yearsLeft: number | null;
  lead: string | null;
  leadIsMe: boolean;
  people: number;
  /** Other players on it. */
  players: string[];
  mine: boolean;
  /** What this character would add per year. */
  myWork: number;
  /** The character's profession is the one this branch needs. */
  fits: boolean;
  approach: "steady" | "careful" | "bold" | "frugal";
  /** Latest things that happened to it, newest first. */
  log: { year: number; text: string }[];
  /** This player can put materials into it this year. */
  canDonate: boolean;
  place: string;
}

const APPROACHES = ["steady", "careful", "bold", "frugal"] as const;

export interface ProjectsView {
  canWork: boolean;
  leading: boolean;
  here: ProjectItem[];
  elsewhere: ProjectItem[];
  startable: { tech: string; name: string; branch: string; effect: string; materials: number; enough: boolean; fits: boolean; myWork: number }[];
  materials: number;
}

/** Shared work: join once and you add to it every year; or start something new and lead it. */
export function Projects({ v }: { v: ProjectsView }) {
  const { t } = useI18n();
  const { act, busy, error } = useAct();
  const [picking, setPicking] = useState(false);

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><Hammer size={15} className="text-ink-3" />{t("play.proj.title")}</h2>
        <p className="mt-0.5 text-xs text-ink-3">{t("play.proj.hint")}</p>
      </div>

      {v.here.length === 0 ? (
        <p className="text-sm text-ink-3">{t("play.proj.none")}</p>
      ) : (
        <ul className="space-y-3">
          {v.here.map((p) => (
            <li key={p.id} className={clsx("space-y-1.5 rounded-xl border p-3", p.mine ? "border-signal/50 bg-signal/5" : "border-line")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 font-medium">{p.name} <span className="text-xs font-normal text-ink-3">· {p.branch}</span></span>
                <span className="num shrink-0 text-sm font-semibold">{p.percent}%</span>
              </div>
              <ProgressBar value={p.percent} max={100} color="bg-signal" />
              <p className="text-[11px] leading-snug text-ink-3">
                {p.lead ? t(p.leadIsMe ? "play.proj.leadMe" : "play.proj.lead", { name: p.lead }) : t("play.proj.noLead")} · {t("play.proj.people", { n: p.people })}
                {p.players.length > 0 && <> · {t("play.proj.players", { names: p.players.join("、") })}</>}
                {p.yearsLeft !== null && <> · {t("play.proj.years", { n: p.yearsLeft })}</>}
              </p>
              <p className="text-[11px] leading-snug text-ink-2">{p.effect}</p>
              {p.leadIsMe ? (
                <div className="space-y-1 pt-1">
                  <div className="text-[11px] text-ink-3">{t("play.proj.how")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {APPROACHES.map((a) => (
                      <button key={a} type="button" disabled={busy || p.approach === a} onClick={() => act({ type: "PROJECT_APPROACH", approach: a })} title={t(`play.proj.approach.${a}.hint`)} className={clsx("min-h-8 rounded-lg border px-2.5 text-xs", p.approach === a ? "border-signal bg-signal/15 text-signal" : "border-line hover:bg-surface-2")}>
                        {t(`play.proj.approach.${a}`)}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink-3">{t(`play.proj.approach.${p.approach}.hint`)}</p>
                </div>
              ) : p.approach !== "steady" && <p className="text-[11px] text-ink-3">{t("play.proj.runAs", { how: t(`play.proj.approach.${p.approach}`) })}</p>}
              {p.log.length > 0 && (
                <ul className="space-y-0.5 border-l border-line pl-2 text-[11px] text-ink-3">
                  {p.log.map((l, i) => <li key={i}><span className="num">{l.year}</span> {l.text}</li>)}
                </ul>
              )}
              {v.canWork && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {p.mine ? (
                    <>
                      <span className="text-xs text-signal">{t("play.proj.mine", { n: p.myWork })}</span>
                      {p.canDonate && <button type="button" disabled={busy} onClick={() => act({ type: "DONATE_PROJECT", amount: 10 })} className="min-h-9 rounded-lg border border-signal/50 bg-signal/10 px-3 text-xs font-medium text-signal hover:bg-signal/15 disabled:opacity-50">{t("play.proj.donate")}</button>}
                      <button type="button" disabled={busy} onClick={() => act({ type: "JOIN_PROJECT", projectId: null })} className="min-h-9 rounded-lg border border-line-strong px-3 text-xs hover:bg-surface-2 disabled:opacity-50">{t("play.proj.leave")}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={() => act({ type: "JOIN_PROJECT", projectId: p.id })} className="min-h-9 rounded-lg border border-signal/50 bg-signal/10 px-3 text-xs font-medium text-signal hover:bg-signal/15 disabled:opacity-50">{t("play.proj.join")}</button>
                      <span className="text-[11px] text-ink-3">{t(p.fits ? "play.proj.fits" : "play.proj.helps", { n: p.myWork })}</span>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {v.canWork && !v.leading && v.startable.length > 0 && (
        <div className="border-t border-line pt-3">
          {!picking ? (
            <button type="button" onClick={() => setPicking(true)} className="min-h-10 w-full rounded-xl border border-dashed border-line-strong text-sm text-ink-2 hover:bg-surface-2">{t("play.proj.start")}</button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink-3">{t("play.proj.startHint", { n: v.materials })} {t("play.proj.onlyMine")}</p>
              <ul className="space-y-2">
                {v.startable.map((o) => (
                  <li key={o.tech} className="flex items-start justify-between gap-3 rounded-xl border border-line p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{o.name} <span className="text-xs font-normal text-ink-3">· {o.branch}</span></div>
                      <p className="text-[11px] leading-snug text-ink-2">{o.effect}</p>
                      <p className={clsx("text-[11px] leading-snug", o.enough ? "text-ink-3" : "text-warn")}>
                        {t("play.proj.cost", { n: o.materials })} · {t(o.fits ? "play.proj.fits" : "play.proj.helps", { n: o.myWork })}
                      </p>
                    </div>
                    <button type="button" disabled={busy || !o.enough} onClick={() => act({ type: "START_PROJECT", tech: o.tech })} className="min-h-9 shrink-0 rounded-lg border border-signal/50 bg-signal/10 px-3 text-xs font-medium text-signal hover:bg-signal/15 disabled:opacity-40">{t("play.proj.lead.start")}</button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setPicking(false)} className="text-xs text-ink-3 hover:text-ink">{t("play.proj.cancel")}</button>
            </div>
          )}
        </div>
      )}

      {!v.canWork && <p className="text-xs text-ink-3">{t("play.proj.young")}</p>}

      {v.elsewhere.length > 0 && (
        <div className="border-t border-line pt-3">
          <h3 className="label-xs mb-1.5">{t("play.proj.elsewhere")}</h3>
          <ul className="space-y-1 text-xs text-ink-2">
            {v.elsewhere.map((p) => <li key={p.id}>{p.place}：{p.name} <span className="num text-ink-3">{p.percent}%</span></li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
