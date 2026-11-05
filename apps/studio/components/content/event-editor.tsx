"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { validateEventDefinition } from "@genesis/narrative";
import { api } from "@/lib/client-api";
import { buttonClass } from "@/components/ui";
import { ErrorText } from "@/components/forms";
import { ValidationPanel } from "./definition-view";
import { useI18n } from "@/components/i18n";

/**
 * JSON editor with live validation. Validation runs in the browser using the
 * same pure validator as the server; the server re-validates on save.
 */
export function EventEditor({ initial, knownEventIds, knownStorylineIds, expectedId, creating }: { initial: string; knownEventIds: string[]; knownStorylineIds: string[]; expectedId?: string; creating?: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx = useMemo(() => ({ knownEventIds: new Set(knownEventIds), knownStorylineIds: new Set(knownStorylineIds) }), [knownEventIds, knownStorylineIds]);

  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(text) as unknown, error: null };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  }, [text]);
  const validation = useMemo(() => (parsed.value === null ? null : validateEventDefinition(parsed.value, ctx)), [parsed.value, ctx]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ saved: boolean; id: string | null; validation: { errors: unknown[] } }>("/api/content/events", { definition: parsed.value, expectedId, create: creating === true });
      if (!res.saved) throw new Error(t("editor.notSaved", { n: res.validation.errors.length }));
      router.push(`/content/events/${res.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <label className="label-xs" htmlFor="event-json">{t("editor.jsonLabel")}</label>
        <textarea
          id="event-json"
          className="field num mt-1 min-h-[60vh] resize-y text-[13px] leading-relaxed"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="space-y-3 lg:col-span-2">
        <div className="label-xs">{t("editor.live")}</div>
        {parsed.error ? (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{t("editor.syntax")} {parsed.error}</div>
        ) : validation ? (
          <ValidationPanel errors={validation.errors} warnings={validation.warnings} />
        ) : null}
        <p className="text-[12px] text-ink-3">{t("editor.saveNote")}</p>
        <button className={buttonClass("primary", "lg", "w-full")} disabled={busy || parsed.value === null || (validation !== null && validation.value === null)} onClick={save}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {t("editor.save")}
        </button>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
