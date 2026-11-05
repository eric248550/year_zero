import { LOCATION_BY_ID, TECH_BY_ID, type Importance } from "@genesis/schemas";

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function signed(n: number, digits = 1): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return `${r > 0 ? "+" : ""}${fmt(r, digits)}`;
}

export function techName(id: string): string {
  return TECH_BY_ID[id]?.name ?? id;
}

export function locationName(id: string): string {
  return LOCATION_BY_ID[id]?.name ?? id;
}

export function humanize(s: string): string {
  return s.replace(/[_.-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function formatValue(v: unknown, yesNo: [string, string] = ["yes", "no"]): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return fmt(v, 2);
  if (typeof v === "boolean") return v ? yesNo[0] : yesNo[1];
  return String(v);
}

export const IMPORTANCE_RANK: Record<Importance, number> = { minor: 0, notable: 1, major: 2, critical: 3 };

/** Localised relative time lives on the translator: `i18n.relativeTime(iso)`. */
