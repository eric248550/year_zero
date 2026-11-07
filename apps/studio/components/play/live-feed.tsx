"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useI18n } from "@/components/i18n";
import type { InboxItem } from "@/lib/play";
import { DecisionCard, type DecisionView } from "./decision-card";

/** Re-render every second so events scheduled for later in the year pop up on time. */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** This year's decisions, each appearing at its moment in the year. */
export function DecisionList({ decisions }: { decisions: DecisionView[] }) {
  const { t } = useI18n();
  const now = useNow();
  const visible = decisions.filter((d) => !d.appearAt || (now !== null && Date.parse(d.appearAt) <= now));
  if (visible.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">{t("play.decisions.empty")}</p>;
  }
  return <div className="space-y-3">{visible.map((d) => <DecisionCard key={d.id} d={d} />)}</div>;
}

const key = (scope: string) => `yz-seen:${scope}`;

function readSeen(scope: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key(scope));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(scope: string, ids: Iterable<string>) {
  try {
    localStorage.setItem(key(scope), JSON.stringify([...ids].slice(-200)));
  } catch {
    /* private mode: notices just show again */
  }
}

/**
 * What other people's actions did to you, since you last looked. Per-browser
 * "seen" marks; the first visit starts with everything already seen.
 */
export function Inbox({ items, scope }: { items: InboxItem[]; scope: string }) {
  const { t } = useI18n();
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => {
    const s = readSeen(scope);
    if (s) setSeen(s);
    else {
      const all = new Set(items.map((i) => i.id));
      writeSeen(scope, all);
      setSeen(all);
    }
  }, [scope, items]);
  if (!seen) return null;
  const fresh = items.filter((i) => !seen.has(i.id));
  if (fresh.length === 0) return null;
  const dismiss = () => {
    const next = new Set([...seen, ...fresh.map((i) => i.id)]);
    writeSeen(scope, next);
    setSeen(next);
  };
  return (
    <section className="card mt-3 space-y-3 border-signal/40 p-4" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-medium text-signal"><Bell size={13} aria-hidden /> {t("play.inbox.title", { n: fresh.length })}</div>
      {fresh.map((i) => (
        <div key={i.id} className="space-y-0.5">
          <div className="text-sm font-medium"><span className="num mr-2 text-ink-3">{i.year}</span>{i.title}</div>
          <p className="whitespace-pre-line text-xs leading-relaxed text-ink-2">{i.text}</p>
        </div>
      ))}
      <button type="button" onClick={dismiss} className="text-xs text-ink-3 underline-offset-2 hover:underline">{t("play.inbox.dismiss")}</button>
    </section>
  );
}
