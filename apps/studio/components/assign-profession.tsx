"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROFESSIONS } from "@genesis/schemas";
import { api } from "@/lib/client-api";
import { buttonClass } from "./ui";
import { ErrorText } from "./forms";
import { useI18n } from "./i18n";

export function AssignProfession({ runId, characterId, current }: { runId: string; characterId: string; current: string | null }) {
  const router = useRouter();
  const { t, term } = useI18n();
  const [profession, setProfession] = useState(current ?? "Engineer");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div className="flex gap-2">
        <select className="field" value={profession} onChange={(e) => setProfession(e.target.value)} aria-label={t("assign.label")}>
          {PROFESSIONS.map((p) => <option key={p} value={p}>{term.profession(p)}</option>)}
        </select>
        <button
          className={buttonClass("secondary")}
          onClick={async () => {
            setError(null);
            setMsg(null);
            try {
              await api(`/api/runs/${runId}/actions`, { action: { type: "ASSIGN_PROFESSION", characterId, profession } });
              setMsg(t("assign.queued"));
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {t("assign.queue")}
        </button>
      </div>
      {msg && <p className="mt-2 text-[12px] text-ok">{msg}</p>}
      <ErrorText error={error} />
    </div>
  );
}
