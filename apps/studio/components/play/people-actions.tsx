"use client";

import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { buttonClass } from "@/components/ui";
import { useAct } from "./use-act";

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Create an invite for a specific character, or (no characterId) for the player's next child. */
export function InviteButton({ characterId, label }: { characterId?: string; label: string }) {
  const { act, busy, error } = useAct();
  const { t } = useI18n();
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void act({ type: "INVITE", code: inviteCode(), ...(characterId ? { characterId } : {}) })} className={buttonClass("secondary", "sm", "justify-start")}>
        <UserPlus size={14} aria-hidden /> {label}
      </button>
      {error && <p role="alert" className="text-xs text-danger">{t("play.error", { message: error })}</p>}
    </>
  );
}

export function CopyLink({ code, worldId }: { code: string; worldId: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => {
          const link = `${window.location.origin}/play/enter?world=${encodeURIComponent(worldId)}&invite=${code}`;
          setUrl(link);
          navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        <Copy size={14} aria-hidden /> {copied ? t("play.people.copied") : t("play.people.copy")}
      </button>
      {url && <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="num w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs" aria-label={t("play.people.copy")} />}
    </div>
  );
}

export function LeaveWorld() {
  const { t } = useI18n();
  const { act, busy } = useAct();
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="text-xs text-ink-3 underline underline-offset-4" onClick={() => setOpen(true)}>{t("play.leave")}</button>;
  return (
    <div className="card space-y-3 p-4 text-sm">
      <p className="text-ink-2">{t("play.leave.body")}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void act({ type: "LEAVE_WORLD" })} className={buttonClass("danger", "sm")}>{t("play.leave.confirm")}</button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>{t("play.cancel")}</button>
      </div>
    </div>
  );
}
