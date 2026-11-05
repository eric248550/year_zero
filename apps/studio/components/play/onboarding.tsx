"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, Lock } from "lucide-react";
import { PROFESSIONS, type OriginId, type Profession } from "@genesis/schemas";
import { useI18n } from "@/components/i18n";
import { buttonClass } from "@/components/ui";
import { useAct } from "./use-act";

export interface OriginOption {
  id: OriginId;
  available: boolean;
  reason: string | null;
  settlements: { id: string; name: string }[];
}

export interface InviteInfo {
  code: string;
  inviter: string;
  kind: "child" | "ward" | "companion" | "next_child";
  character: string | null;
  error: string | null;
}

export function Onboarding({ year, yearsOpen, origins, traits, invite }: {
  year: number;
  yearsOpen: number;
  origins: OriginOption[];
  traits: readonly string[];
  invite: InviteInfo | null;
}) {
  const { t, term } = useI18n();
  const { act, busy, error } = useAct();
  const [stage, setStage] = useState<"intro" | "who">("intro");
  const [playerName, setPlayerName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [profession, setProfession] = useState<Profession>("Scout");
  const [trait, setTrait] = useState<string>(traits[0] ?? "brave");
  const firstOpen = origins.find((o) => o.available)?.id ?? "haven_deep";
  const [origin, setOrigin] = useState<OriginId>(firstOpen);
  const chosen = origins.find((o) => o.id === origin);
  const [settlementId, setSettlementId] = useState<string>(chosen?.settlements[0]?.id ?? "");
  const byInvite = invite && !invite.error;

  if (stage === "intro") {
    const lines = yearsOpen === 0 ? [t("play.intro.line1"), t("play.intro.line2"), t("play.intro.line3")] : [t("play.intro.later", { year, years: yearsOpen })];
    return (
      <div className="flex min-h-[70dvh] flex-col justify-center gap-6 py-10">
        <div className="label-xs text-signal">{t("play.yearN", { year })}</div>
        <div className="space-y-4">
          {lines.map((l, i) => (
            <p key={i} className="text-xl leading-relaxed text-ink [text-wrap:balance] motion-safe:animate-[fadein_0.8s_ease-out_both]" style={{ animationDelay: `${i * 0.6}s` }}>{l}</p>
          ))}
        </div>
        {invite && (
          <div className="card p-4 text-sm">
            {invite.error ? (
              <p className="text-danger">{t("play.invite.invalid", { reason: invite.error })}</p>
            ) : (
              <>
                <div className="font-semibold">{t("play.invite.title", { inviter: invite.inviter })}</div>
                <p className="mt-1 text-ink-2">{t(`play.invite.${invite.kind}`, { name: invite.character ?? "" })}</p>
              </>
            )}
          </div>
        )}
        <button type="button" className={buttonClass("primary", "lg", "self-start")} onClick={() => setStage("who")}>
          {t("play.intro.start")} <ArrowRight size={18} />
        </button>
      </div>
    );
  }

  const join = () => {
    const base = { type: "JOIN_WORLD", playerName: playerName.trim() || givenName.trim() || "Survivor" };
    if (byInvite) return act({ ...base, inviteCode: invite.code });
    return act({
      ...base,
      origin,
      ...(givenName.trim() ? { givenName: givenName.trim() } : {}),
      profession,
      trait,
      ...(origin !== "haven_deep" && settlementId ? { settlementId } : {}),
    });
  };

  return (
    <form
      className="space-y-6 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">{t("play.who.title")}</h1>

      <label className="block space-y-1.5">
        <span className="label-xs">{t("play.who.playerName")}</span>
        <input id="play-player-name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={40} className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5" />
      </label>

      {!byInvite && (
        <>
          <label className="block space-y-1.5">
            <span className="label-xs">{t("play.who.name")}</span>
            <input id="play-given-name" value={givenName} onChange={(e) => setGivenName(e.target.value)} maxLength={30} placeholder={t("play.who.namePlaceholder")} className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 placeholder:text-ink-3" />
          </label>

          {origins.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="label-xs mb-2">{t("play.who.origin")}</legend>
              {origins.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={!o.available}
                  aria-pressed={origin === o.id}
                  onClick={() => {
                    setOrigin(o.id);
                    setSettlementId(o.settlements[0]?.id ?? "");
                  }}
                  className={clsx("w-full rounded-xl border p-3 text-left transition-colors disabled:opacity-50", origin === o.id ? "border-signal/60 bg-signal/10" : "border-line bg-surface")}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {!o.available && <Lock size={14} aria-hidden />}
                    {t(`play.origin.${o.id}`)}
                  </div>
                  <div className="mt-0.5 text-sm text-ink-2">{o.available ? t(`play.origin.${o.id}.desc`) : t("play.origin.locked", { reason: o.reason ?? "" })}</div>
                </button>
              ))}
            </fieldset>
          )}

          {origin !== "haven_deep" && chosen && chosen.settlements.length > 1 && (
            <label className="block space-y-1.5">
              <span className="label-xs">{t("play.who.settlement")}</span>
              <select id="play-settlement" value={settlementId} onChange={(e) => setSettlementId(e.target.value)} className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5">
                {chosen.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}

          <fieldset>
            <legend className="label-xs mb-2">{t("play.who.profession")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {PROFESSIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={profession === p}
                  onClick={() => setProfession(p)}
                  className={clsx("min-w-0 rounded-xl border p-3 text-left transition-colors", profession === p ? "border-signal/60 bg-signal/10" : "border-line bg-surface")}
                >
                  <div className="font-medium">{term.profession(p)}</div>
                  <div className="mt-1 text-xs leading-snug text-ink-2">{t(`play.prof.${p}`)}</div>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label-xs mb-1">{t("play.who.trait")}</legend>
            <p className="mb-2 text-xs text-ink-3">{t("play.who.traitHint")}</p>
            <div className="flex flex-wrap gap-2">
              {traits.map((x) => (
                <button
                  key={x}
                  type="button"
                  aria-pressed={trait === x}
                  onClick={() => setTrait(x)}
                  className={clsx("min-h-9 rounded-full border px-3.5 text-sm transition-colors", trait === x ? "border-signal/60 bg-signal/15 text-signal" : "border-line bg-surface text-ink-2")}
                >
                  {term.trait(x)}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {error && <p role="alert" className="text-sm text-danger">{t("play.error", { message: error })}</p>}
      <button type="submit" disabled={busy || (!byInvite && !chosen?.available)} className={buttonClass("primary", "lg", "w-full")}>
        {byInvite ? t("play.who.joinInvite") : t("play.who.join")} <ArrowRight size={18} />
      </button>
    </form>
  );
}
