"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, FlaskConical, Loader2, Sparkles, X } from "lucide-react";
import type { EventDefinition } from "@genesis/schemas";
import { api } from "@/lib/client-api";
import { Card, CardHeader, buttonClass } from "@/components/ui";
import { ErrorText } from "@/components/forms";
import { DefinitionView, ValidationPanel, type Issue } from "./definition-view";
import { useI18n } from "@/components/i18n";

interface Outcome {
  generation: { provider: string; model: string; isMock: boolean; rawText: string; parseError: string | null };
  validation: { valid: boolean; value: EventDefinition | null; errors: Issue[]; warnings: Issue[] };
  candidate: (Record<string, unknown> & { id?: string; source?: string }) | null;
}

const SAMPLE_KEYS = ["gen.sample1", "gen.sample2", "gen.sample3", "gen.sample4"] as const;

export function Generator({ model }: { model: { label: string } | null }) {
  const router = useRouter();
  const { t } = useI18n();
  const samples = SAMPLE_KEYS.map((k) => t(k));
  const [prompt, setPrompt] = useState(samples[0]!);
  const [busy, setBusy] = useState<"model" | "mock" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [decision, setDecision] = useState<"rejected" | null>(null);

  async function generate(mode: "model" | "mock") {
    setBusy(mode);
    setError(null);
    setOutcome(null);
    setDecision(null);
    try {
      setOutcome(await api<Outcome>("/api/ai/generate", { prompt, mode }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!outcome?.candidate) return;
    setBusy("approve");
    setError(null);
    try {
      const res = await api<{ saved: boolean; id: string }>("/api/content/events", {
        definition: outcome.candidate,
        source: outcome.candidate.source,
        note: `Approved ${outcome.generation.isMock ? "mock" : "AI"} draft for review`,
        create: true,
      });
      if (!res.saved) throw new Error(t("gen.couldNotSave"));
      router.push(`/content/events/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("gen.describe")} icon={<Sparkles size={16} />} subtitle={t("gen.describeSub")} />
        <div className="space-y-3 px-4 pb-4">
          <textarea className="field min-h-28" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} aria-label={t("gen.prompt")} />
          <div className="scroll-x">
            {samples.map((s) => (
              <button key={s} type="button" onClick={() => setPrompt(s)} className="max-w-64 shrink-0 truncate rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink">{s}</button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className={buttonClass("primary", "lg")} disabled={!model || busy !== null} onClick={() => generate("model")} title={model ? undefined : t("gen.noProvider")}>
              {busy === "model" ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />} {model ? t("gen.generateWith", { model: model.label }) : t("gen.notConfigured")}
            </button>
            <button className={buttonClass("secondary", "lg")} disabled={busy !== null} onClick={() => generate("mock")}>
              {busy === "mock" ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />} {t("gen.mock")}
            </button>
          </div>
          {busy === "model" && <p className="text-[12px] text-ink-3">{t("gen.waiting")}</p>}
          <ErrorText error={error} />
        </div>
      </Card>

      {outcome && (
        <>
          <div className={`rounded-2xl border p-4 text-sm ${outcome.generation.isMock ? "border-warn/50 bg-warn/10" : "border-knowledge/50 bg-knowledge/10"}`}>
            <div className="font-semibold">{outcome.generation.isMock ? t("gen.mockBanner") : t("gen.generatedBy", { provider: outcome.generation.provider, model: outcome.generation.model })}</div>
            <div className="mt-1 text-ink-2">{t("gen.notSaved")}</div>
          </div>

          <Card>
            <CardHeader title={t("gen.validation")} subtitle={t("gen.validationSub")} />
            <div className="space-y-3 px-4 pb-4">
              <ValidationPanel errors={outcome.validation.errors} warnings={outcome.validation.warnings} />
              {decision === "rejected" ? (
                <p className="text-sm text-ink-3">{t("gen.rejected")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button className={buttonClass("primary")} disabled={!outcome.validation.value || busy !== null || outcome.validation.errors.some((e) => e.code === "id.duplicate")} onClick={approve}>
                    {busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t("gen.approve")}
                  </button>
                  <button className={buttonClass("danger")} disabled={busy !== null} onClick={() => setDecision("rejected")}><X size={16} /> {t("gen.reject")}</button>
                </div>
              )}
              {!outcome.validation.valid && outcome.validation.value && <p className="text-[12px] text-ink-3">{t("gen.errorsNote")}</p>}
            </div>
          </Card>

          {outcome.validation.value && <DefinitionView def={outcome.validation.value} />}

          <details className="card">
            <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-sm font-medium">{t("gen.raw")}</summary>
            <pre className="num max-h-96 overflow-auto border-t border-line p-4 text-[12px] text-ink-2">{outcome.generation.rawText || outcome.generation.parseError}</pre>
          </details>
        </>
      )}
    </div>
  );
}
