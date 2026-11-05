"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Dices, GitBranch, Loader2, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { POLICIES } from "@genesis/schemas";
import { api } from "@/lib/client-api";
import { buttonClass, type ButtonVariant } from "./ui";
import { useI18n } from "./i18n";

/** Shared async-button behaviour: busy state, error display, refresh on success. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      router.refresh();
      return r;
    } catch (err) {
      setError((err as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, router };
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>;
}

/** Two-step confirmation for destructive or hard-to-reverse actions. */
export function ConfirmButton({ label, confirmLabel, onConfirm, variant = "secondary", icon, description, size = "md" }: {
  label: ReactNode; confirmLabel?: ReactNode; onConfirm: () => Promise<unknown>; variant?: ButtonVariant; icon?: ReactNode; description?: ReactNode; size?: "sm" | "md";
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  if (stage === "confirm") {
    return (
      <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
        {description && <p className="mb-2 text-[13px] text-ink-2">{description}</p>}
        <div className="flex gap-2">
          <button
            className={buttonClass("primary", size)}
            onClick={async () => {
              setStage("busy");
              setError(null);
              try {
                await onConfirm();
                setStage("idle");
              } catch (err) {
                setError((err as Error).message);
                setStage("confirm");
              }
            }}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
          <button className={buttonClass("ghost", size)} onClick={() => setStage("idle")}>{t("common.cancel")}</button>
        </div>
        <ErrorText error={error} />
      </div>
    );
  }
  return (
    <button className={buttonClass(variant, size)} disabled={stage === "busy"} onClick={() => setStage("confirm")}>
      {stage === "busy" ? <Loader2 size={16} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

export function SeedContentButton() {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <div>
      <button className={buttonClass("primary")} disabled={busy} onClick={() => run(() => api("/api/content/seed"))}>
        {busy && <Loader2 size={16} className="animate-spin" />} {t("forms.importSeed")}
      </button>
      <ErrorText error={error} />
    </div>
  );
}

export function CreateRunForm({ defaultSeed }: { defaultSeed: number }) {
  const { t, term } = useI18n();
  const { busy, error, run, router } = useAction();
  const [seed, setSeed] = useState(String(defaultSeed));
  const [policy, setPolicy] = useState<string>("balanced");
  const [name, setName] = useState("");
  const seedNum = Number(seed);
  const valid = Number.isInteger(seedNum) && seedNum >= 0 && seedNum <= 2_147_483_647;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void run(() => api<{ id: string }>("/api/runs", { seed: seedNum, policy, name }), () => router.push("/"));
      }}
    >
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="block">
          <span className="label-xs">{t("forms.seed")}</span>
          <input className="field num mt-1" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!valid} />
        </label>
        <button type="button" className={buttonClass("secondary", "md", "mt-[22px]")} aria-label={t("forms.randomSeed")} onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000)))}>
          <Dices size={18} />
        </button>
      </div>
      <label className="block">
        <span className="label-xs">{t("forms.policy")}</span>
        <select className="field mt-1" value={policy} onChange={(e) => setPolicy(e.target.value)}>
          {POLICIES.map((p) => <option key={p} value={p}>{term.policyName(p)} — {term.policy(p)}</option>)}
        </select>
        <span className="mt-1 block text-[12px] text-ink-3">{term.policyDescription(policy)}</span>
      </label>
      <label className="block">
        <span className="label-xs">{t("forms.runName")}</span>
        <input className="field mt-1" value={name} maxLength={80} placeholder={t("forms.runNamePlaceholder", { seed: seed || "…", policy: term.policy(policy) })} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className={buttonClass("primary", "lg", "w-full")} disabled={busy || !valid}>
        {busy && <Loader2 size={16} className="animate-spin" />} {t("forms.createWorld")}
      </button>
      <ErrorText error={error} />
    </form>
  );
}

export function ActivateRunButton({ id, label }: { id: string; label?: string }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <>
      <button className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => run(() => api("/api/runs/active", { id }))}>{label ?? t("forms.load")}</button>
      <ErrorText error={error} />
    </>
  );
}

export function RunManagement({ runId, archived, currentTick, snapshotTicks }: { runId: string; archived: boolean; currentTick: number; snapshotTicks: number[] }) {
  const { router } = useAction();
  const { t, term } = useI18n();
  const [verify, setVerify] = useState<{ ok: boolean; checks: { tick: number; ok: boolean }[]; durationMs: number } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [forkTick, setForkTick] = useState(String(currentTick));
  const [forkPolicy, setForkPolicy] = useState("");
  const [reseed, setReseed] = useState("");
  const forkTickNum = Number(forkTick);
  const forkValid = Number.isInteger(forkTickNum) && forkTickNum >= 0 && forkTickNum <= currentTick;

  return (
    <div className="space-y-5">
      <div>
        <div className="label-xs mb-2">{t("forms.replayVerification")}</div>
        <button
          className={buttonClass("secondary", "md", "w-full")}
          disabled={verifying}
          onClick={async () => {
            setVerifying(true);
            setVerifyError(null);
            try {
              setVerify(await api(`/api/runs/${runId}/verify`));
            } catch (err) {
              setVerifyError((err as Error).message);
            } finally {
              setVerifying(false);
            }
          }}
        >
          {verifying ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} {t("forms.verifyButton")}
        </button>
        {verify && (
          <div className={`mt-2 rounded-xl border px-3 py-2 text-sm ${verify.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger"}`} aria-live="polite">
            <div className="flex items-center gap-2 font-medium">
              {verify.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {verify.ok ? t("forms.verifyOk") : t("forms.verifyFail")} · {t("forms.checkpoints", { count: verify.checks.length, ms: verify.durationMs })}
            </div>
            <div className="num mt-1 flex flex-wrap gap-1 text-[11px]">
              {verify.checks.map((c) => <span key={c.tick} className={c.ok ? "text-ok" : "text-danger"}>t{c.tick}{c.ok ? "✓" : "✗"}</span>)}
            </div>
          </div>
        )}
        <ErrorText error={verifyError} />
      </div>

      <div>
        <div className="label-xs mb-2">{t("forms.forkTitle")}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[12px] text-ink-3">{t("forms.forkTick", { max: currentTick })}</span>
            <input className="field num mt-1" inputMode="numeric" value={forkTick} onChange={(e) => setForkTick(e.target.value.replace(/[^0-9]/g, ""))} list={`snaps-${runId}`} />
            <datalist id={`snaps-${runId}`}>{snapshotTicks.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <label className="block">
            <span className="text-[12px] text-ink-3">{t("forms.forkPolicy")}</span>
            <select className="field mt-1" value={forkPolicy} onChange={(e) => setForkPolicy(e.target.value)}>
              <option value="">{t("forms.samePolicy")}</option>
              {POLICIES.map((p) => <option key={p} value={p}>{term.policyName(p)}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-2 block">
          <span className="text-[12px] text-ink-3">{t("forms.reseed")}</span>
          <input className="field num mt-1" inputMode="numeric" placeholder={t("forms.reseedPlaceholder")} value={reseed} onChange={(e) => setReseed(e.target.value.replace(/[^0-9]/g, ""))} />
        </label>
        <div className="mt-2">
          <ConfirmButton
            label={t("forms.forkRun")}
            icon={<GitBranch size={16} />}
            description={t("forms.forkConfirm", { tick: forkTick })}
            confirmLabel={t("forms.createFork")}
            onConfirm={async () => {
              if (!forkValid) throw new Error(t("forms.forkTickInvalid", { max: currentTick }));
              await api(`/api/runs/${runId}/fork`, { tick: forkTickNum, policy: forkPolicy || undefined, reseed: reseed === "" ? undefined : Number(reseed) });
              router.push("/");
              router.refresh();
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          label={t("forms.reset")}
          icon={<RotateCcw size={16} />}
          description={t("forms.resetConfirm")}
          confirmLabel={t("forms.resetShort")}
          onConfirm={async () => {
            await api(`/api/runs/${runId}/reset`);
            router.refresh();
          }}
        />
        {!archived && (
          <ConfirmButton
            label={t("forms.archive")}
            variant="danger"
            description={t("forms.archiveConfirm")}
            confirmLabel={t("forms.archiveRun")}
            onConfirm={async () => {
              await api(`/api/runs/${runId}/archive`);
              router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
