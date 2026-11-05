"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { POLICIES, RESOURCES, type PlayerAction } from "@genesis/schemas";
import type { MessageKey } from "@/lib/i18n/core";
import { describeAction } from "@/lib/describe-action";
import { useI18n } from "./i18n";
import { api } from "@/lib/client-api";
import { buttonClass } from "./ui";
import { ErrorText } from "./forms";

type Option = { id: string; name: string };

const TYPES = [
  { type: "SET_RESEARCH_FOCUS", label: "action.type.focus" },
  { type: "SET_POLICY", label: "action.type.policy" },
  { type: "FOUND_SETTLEMENT", label: "action.type.found" },
  { type: "LAUNCH_EXPEDITION", label: "action.type.expedition" },
  { type: "TRANSFER_RESOURCES", label: "action.type.transfer" },
] as const satisfies readonly { label: MessageKey; [k: string]: unknown }[];

export function ActionComposer({ runId, queue, settlements, sites, techs }: { runId: string; queue: PlayerAction[]; settlements: Option[]; sites: Option[]; techs: Option[] }) {
  const router = useRouter();
  const i18n = useI18n();
  const { t, term } = i18n;
  const [type, setType] = useState<(typeof TYPES)[number]["type"]>("SET_RESEARCH_FOCUS");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = (k: string, fallback = "") => f[k] ?? fallback;
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const firstSettlement = settlements[0]?.id ?? "";

  function build(): unknown {
    switch (type) {
      case "SET_POLICY": return { type, policy: v("policy", "balanced") };
      case "SET_RESEARCH_FOCUS": return { type, tech: v("tech", techs[0]?.id ?? "") || null };
      case "FOUND_SETTLEMENT": return { type, locationId: v("location", sites[0]?.id ?? ""), fromSettlementId: v("from", firstSettlement), settlers: Number(v("settlers", "6")) };
      case "LAUNCH_EXPEDITION": return { type, settlementId: v("from", firstSettlement) };
      case "TRANSFER_RESOURCES": return { type, fromSettlementId: v("from", firstSettlement), toSettlementId: v("to", settlements[1]?.id ?? ""), resource: v("resource", "food"), amount: Number(v("amount", "10")) };
    }
  }

  async function submit(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/actions`, body, method);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const settlementSelect = (key: string, label: string, fallback = firstSettlement) => (
    <label className="block">
      <span className="text-[12px] text-ink-3">{label}</span>
      <select className="field mt-1" value={v(key, fallback)} onChange={set(key)}>
        {settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label-xs">{t("action.label")}</span>
        <select className="field mt-1" value={type} onChange={(e) => { setType(e.target.value as typeof type); setError(null); }}>
          {TYPES.map((x) => <option key={x.type} value={x.type}>{t(x.label)}</option>)}
        </select>
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {type === "SET_POLICY" && (
          <label className="block">
            <span className="text-[12px] text-ink-3">{t("action.policy")}</span>
            <select className="field mt-1" value={v("policy", "balanced")} onChange={set("policy")}>
              {POLICIES.map((p) => <option key={p} value={p}>{term.policyName(p)}</option>)}
            </select>
          </label>
        )}
        {type === "SET_RESEARCH_FOCUS" && (
          <label className="block">
            <span className="text-[12px] text-ink-3">{t("action.tech")}</span>
            <select className="field mt-1" value={v("tech", techs[0]?.id ?? "")} onChange={set("tech")}>
              {techs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="">{t("action.clearFocus")}</option>
            </select>
          </label>
        )}
        {type === "FOUND_SETTLEMENT" && (
          <>
            <label className="block">
              <span className="text-[12px] text-ink-3">{t("action.site")}</span>
              <select className="field mt-1" value={v("location", sites[0]?.id ?? "")} onChange={set("location")} disabled={sites.length === 0}>
                {sites.length === 0 ? <option>{t("action.noSites")}</option> : sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {settlementSelect("from", t("action.settlersFrom"))}
            <label className="block">
              <span className="text-[12px] text-ink-3">{t("action.settlers")}</span>
              <input className="field num mt-1" inputMode="numeric" value={v("settlers", "6")} onChange={set("settlers")} />
            </label>
          </>
        )}
        {type === "LAUNCH_EXPEDITION" && settlementSelect("from", t("action.expeditionFrom"))}
        {type === "TRANSFER_RESOURCES" && (
          <>
            {settlementSelect("from", t("action.from"))}
            {settlementSelect("to", t("action.to"), settlements[1]?.id ?? "")}
            <label className="block">
              <span className="text-[12px] text-ink-3">{t("action.resource")}</span>
              <select className="field mt-1" value={v("resource", "food")} onChange={set("resource")}>
                {RESOURCES.map((r) => <option key={r} value={r}>{term.resource(r)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-ink-3">{t("action.amount")}</span>
              <input className="field num mt-1" inputMode="decimal" value={v("amount", "10")} onChange={set("amount")} />
            </label>
          </>
        )}
      </div>

      <button className={buttonClass("primary", "md", "w-full")} disabled={busy} onClick={() => submit("POST", { action: build() })}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {t("action.queue")}
      </button>
      <ErrorText error={error} />

      <div>
        <div className="label-xs mb-1.5">{t("action.queued", { n: queue.length })}</div>
        {queue.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t("action.noPending")}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {queue.map((a, i) => <li key={i} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{describeAction(a, i18n)}</li>)}
            </ul>
            <button className={buttonClass("ghost", "sm", "mt-1")} disabled={busy} onClick={() => submit("DELETE")}>
              <Trash2 size={14} /> {t("action.clearQueue")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
