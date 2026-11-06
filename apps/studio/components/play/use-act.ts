"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";

export interface ActResult {
  events: { id: string; title: string; text: string; characterIds: string[] }[];
  names: Record<string, string>;
}

/** Send a player action to the live world. Refreshes the page unless told not to. */
export function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function act(action: Record<string, unknown>, opts: { refresh?: boolean } = {}): Promise<ActResult | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ActResult>("/api/play/act", { action });
      if (opts.refresh !== false) startTransition(() => router.refresh());
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  const refresh = () => startTransition(() => router.refresh());
  return { act, busy, error, refresh };
}
