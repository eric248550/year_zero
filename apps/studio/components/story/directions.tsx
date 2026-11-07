"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Compass, FlaskConical, Landmark, Tent } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { api } from "@/lib/client-api";
import type { DirectionOptions } from "@/lib/story";

/** The few big levers over the world, each one tap; they take effect when the next year runs. */
export function Directions({ runId, o, queued }: { runId: string; o: DirectionOptions; queued: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: unknown, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/runs/${runId}/actions`, method === "POST" ? { action } : undefined, method);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {queued.length > 0 && (
        <div className="rounded-xl border border-signal/40 bg-signal/8 px-3 py-2.5 text-sm">
          <div className="mb-1 text-xs text-signal">{t("story.queued")}</div>
          <ul className="space-y-0.5">{queued.map((q, i) => <li key={i}>· {q}</li>)}</ul>
          <button type="button" disabled={busy} onClick={() => void send(null, "DELETE")} className="mt-1.5 text-xs text-ink-3 underline-offset-2 hover:underline">{t("story.clearQueued")}</button>
        </div>
      )}

      <Section icon={<Landmark size={15} />} title={t("story.dir.policy")} hint={t("story.dir.policyHint")}>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {o.policies.map((p) => (
            <Option key={p.id} active={p.id === o.policy} disabled={busy || p.id === o.policy} onClick={() => void send({ type: "SET_POLICY", policy: p.id })} title={p.name} body={p.description} />
          ))}
        </div>
      </Section>

      {o.research.length > 0 && (
        <Section icon={<FlaskConical size={15} />} title={t("story.dir.research")} hint={t("story.dir.researchHint")}>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {o.research.map((r) => (
              <Option key={r.id} active={r.current} disabled={busy || r.current} onClick={() => void send({ type: "SET_RESEARCH_FOCUS", tech: r.id })} title={r.name} body={r.description} />
            ))}
          </div>
        </Section>
      )}

      <Section icon={<Tent size={15} />} title={t("story.dir.expand")} hint={t("story.dir.expandHint")}>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {o.found.map((f) => (
            <Option
              key={f.locationId}
              disabled={busy || !f.possible}
              onClick={() => void send({ type: "FOUND_SETTLEMENT", locationId: f.locationId, fromSettlementId: f.fromId, settlers: 6 })}
              title={t("story.dir.found", { place: f.name })}
              body={f.reason ?? t("story.dir.foundBody", { from: f.fromName })}
            />
          ))}
          {o.expeditionFrom && (
            <Option
              icon={<Compass size={14} />}
              disabled={busy}
              onClick={() => void send({ type: "LAUNCH_EXPEDITION", settlementId: o.expeditionFrom!.id })}
              title={t("story.dir.expedition")}
              body={t("story.dir.expeditionBody", { from: o.expeditionFrom.name })}
            />
          )}
        </div>
      </Section>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2.5 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="text-signal">{icon}</span>{title}</h3>
        <p className="mt-0.5 text-xs text-ink-3">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Option({ title, body, active, disabled, onClick, icon }: { title: string; body: string; active?: boolean; disabled?: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-default",
        active ? "border-signal/60 bg-signal/12" : "border-line-strong bg-surface-2 hover:bg-surface-3 disabled:opacity-50 disabled:hover:bg-surface-2",
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium">{icon}{title}</span>
      <span className="mt-0.5 block text-xs text-ink-3">{body}</span>
    </button>
  );
}

