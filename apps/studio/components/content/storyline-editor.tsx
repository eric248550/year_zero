"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { buttonClass } from "@/components/ui";
import { ErrorText } from "@/components/forms";
import { useI18n } from "@/components/i18n";

export function StorylineEditor({ initial }: { initial: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <details className="card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-sm font-medium">{t("storyline.editJson")}</summary>
      <div className="space-y-2 border-t border-line p-4">
        <textarea className="field num min-h-80 text-[13px]" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("storyline.editJson")} />
        <button
          className={buttonClass("primary")}
          onClick={async () => {
            setError(null);
            setOk(null);
            try {
              const res = await api<{ saved: boolean; validation: { errors: { path: string; message: string }[]; warnings: { message: string }[] } }>("/api/content/storylines", { storyline: JSON.parse(text) });
              if (!res.saved) throw new Error(res.validation.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
              setOk(res.validation.warnings.length ? `${t("storyline.savedWarnings")} ${res.validation.warnings.map((w) => w.message).join("; ")}` : t("storyline.saved"));
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {t("storyline.save")}
        </button>
        {ok && <p className="text-sm text-ok">{ok}</p>}
        <ErrorText error={error} />
      </div>
    </details>
  );
}
