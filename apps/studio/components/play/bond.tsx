import type { MessageKey } from "@/lib/i18n/core";

/** Bond tiers, so a number reads as a relationship. */
export function bondTier(v: number): { key: MessageKey; tone: string } {
  if (v <= -60) return { key: "play.rel.enemy", tone: "text-danger" };
  if (v <= -20) return { key: "play.rel.bad", tone: "text-danger" };
  if (v < 0) return { key: "play.rel.cool", tone: "text-ink-3" };
  if (v < 20) return { key: "play.rel.known", tone: "text-ink-3" };
  if (v < 50) return { key: "play.rel.friend", tone: "text-ok" };
  if (v < 80) return { key: "play.rel.close", tone: "text-ok" };
  return { key: "play.rel.dear", tone: "text-signal" };
}
