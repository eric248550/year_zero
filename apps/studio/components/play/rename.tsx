"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { buttonClass } from "@/components/ui";
import { NameFields } from "./name-fields";
import { useAct } from "./use-act";

export function RenameCharacter({ givenName, familyName }: { givenName: string; familyName: string }) {
  const { t } = useI18n();
  const { act, busy, error } = useAct();
  const [open, setOpen] = useState(false);
  const [given, setGiven] = useState(givenName);
  const [family, setFamily] = useState(familyName);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
        <Pencil size={12} aria-hidden /> {t("play.rename")}
      </button>
    );
  }
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act({ type: "RENAME", givenName: given.trim(), familyName: family.trim() });
        if (r) setOpen(false);
      }}
    >
      <NameFields idPrefix="rename" given={given} family={family} onGiven={setGiven} onFamily={setFamily} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !given.trim()} className={buttonClass("primary", "sm")}>{t("play.rename.save")}</button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>{t("play.cancel")}</button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{t("play.error", { message: error })}</p>}
    </form>
  );
}
