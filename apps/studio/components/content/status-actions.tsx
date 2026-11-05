"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { buttonClass } from "@/components/ui";
import { ConfirmButton, ErrorText } from "@/components/forms";
import { useI18n } from "@/components/i18n";

export function StatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function post(action: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api<{ row?: { status: string }; validation?: { valid: boolean; errors: unknown[] } }>(`/api/content/events/${id}/${action}`);
      if (action === "validate") setNote(res.validation?.valid ? t("status.passed") : t("status.failed", { n: res.validation?.errors.length ?? 0 }));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass("secondary")} disabled={busy} onClick={() => post("validate")}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} {t("status.validate")}
        </button>
        {status === "validated" && (
          <ConfirmButton
            label={t("status.publish")}
            variant="primary"
            icon={<Rocket size={16} />}
            description={t("status.publishConfirm")}
            confirmLabel={t("status.publishNow")}
            onConfirm={async () => { await api(`/api/content/events/${id}/publish`); router.refresh(); }}
          />
        )}
        {status !== "archived" && (
          <ConfirmButton
            label={status === "published" ? t("status.unpublish") : t("status.rejectArchive")}
            variant="danger"
            icon={<Archive size={16} />}
            description={t("status.archiveConfirm")}
            confirmLabel={t("forms.archive")}
            onConfirm={async () => { await api(`/api/content/events/${id}/archive`); router.refresh(); }}
          />
        )}
      </div>
      {note && <p className="mt-2 text-sm text-ink-2">{note}</p>}
      <ErrorText error={error} />
    </div>
  );
}

export function ChoiceOverride({ runId, definitionId, choices, current }: { runId: string; definitionId: string; choices: { id: string; label: string }[]; current: string | null }) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <select
        className="field"
        defaultValue={current ?? ""}
        onChange={async (e) => {
          setError(null);
          try {
            await api(`/api/runs/${runId}/overrides`, { definitionId, choiceId: e.target.value || null });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <option value="">{t("status.policyDecides")}</option>
        {choices.map((c) => <option key={c.id} value={c.id}>{t("status.always", { label: c.label })}</option>)}
      </select>
      <ErrorText error={error} />
    </div>
  );
}
