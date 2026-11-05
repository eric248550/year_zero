import {
  LOCATION_BY_ID,
  POLICY_INFO,
  RESOURCE_INFO,
  SECRET_BY_ID,
  TECH_BY_ID,
  type PolicyId,
  type ResourceId,
} from "@genesis/schemas";
import { en, type MessageKey } from "./messages/en";
import { zhTW } from "./messages/zh-TW";
import { ZH_TERMS } from "./terms";

/**
 * Minimal, dependency-free i18n. The locale lives in a cookie so server
 * components, client components and route refreshes all agree on it.
 * Only the Studio UI is translated; authored narrative content (event
 * definitions, storylines, generated history text) is data and stays in the
 * language it was written in.
 */
export const LOCALES = ["en", "zh-TW"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "genesis-locale";
export const LOCALE_LABELS: Record<Locale, string> = { en: "English", "zh-TW": "繁體中文" };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Cookie wins; otherwise pick Chinese when the browser prefers any zh variant. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("zh") ? "zh-TW" : DEFAULT_LOCALE;
}

export type Vars = Record<string, string | number>;
export type { MessageKey };

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, "zh-TW": zhTW };

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const humanize = (s: string) => s.replace(/[_.-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const ERA_EN: Record<string, string> = {
  Emergence: "Survivors take their first steps on the surface.",
  Rebuilding: "Basic survival technologies are being recovered.",
  Expansion: "Communities spread and specialise.",
  Renewal: "Infrastructure links the settlements together.",
  "New Dawn": "The bunker archives are exhausted; what comes next is unwritten.",
};

export function createI18n(locale: Locale) {
  const dict = DICTS[locale];
  const zh = locale === "zh-TW";

  /** Translate a UI message. `count === 1` selects an English `_one` variant when present. */
  function t(key: MessageKey, vars?: Vars): string {
    if (vars && vars.count === 1) {
      const one = (dict as Record<string, string | undefined>)[`${key}_one`] ?? (en as Record<string, string | undefined>)[`${key}_one`];
      if (one && !zh) return interpolate(one, vars);
    }
    return interpolate(dict[key] ?? en[key], vars);
  }

  const pick = (table: Record<string, string>, id: string, fallback: string) => (zh ? table[id] ?? fallback : fallback);

  const term = {
    resource: (id: ResourceId | string) => pick(ZH_TERMS.resource, id, RESOURCE_INFO[id as ResourceId]?.label ?? humanize(id)),
    resourceDescription: (id: ResourceId) => pick(ZH_TERMS.resourceDescription, id, RESOURCE_INFO[id].description),
    /** `null` profession means a child / youth. */
    profession: (p: string | null) => (p === null ? (zh ? "青少年" : "Youth") : pick(ZH_TERMS.profession, p, p)),
    policyName: (id: string) => pick(ZH_TERMS.policyName, id, POLICY_INFO[id as PolicyId]?.name ?? id),
    policyDescription: (id: string) => pick(ZH_TERMS.policyDescription, id, POLICY_INFO[id as PolicyId]?.description ?? ""),
    /** Short policy id label (balanced, scholarly …). */
    policy: (id: string) => pick(ZH_TERMS.policy, id, id),
    techName: (id: string) => pick(ZH_TERMS.techName, id, TECH_BY_ID[id]?.name ?? id),
    techDescription: (id: string) => pick(ZH_TERMS.techDescription, id, TECH_BY_ID[id]?.description ?? ""),
    techEffect: (id: string) => pick(ZH_TERMS.techEffect, id, TECH_BY_ID[id]?.effect ?? ""),
    /** Place names are proper nouns and stay as written; descriptions are translated. */
    locationName: (id: string) => LOCATION_BY_ID[id]?.name ?? id,
    locationDescription: (id: string) => pick(ZH_TERMS.locationDescription, id, LOCATION_BY_ID[id]?.description ?? ""),
    secretTitle: (id: string) => pick(ZH_TERMS.secretTitle, id, SECRET_BY_ID[id]?.title ?? id),
    secretRevelation: (id: string) => pick(ZH_TERMS.secretRevelation, id, SECRET_BY_ID[id]?.revelation ?? ""),
    eraName: (name: string) => pick(ZH_TERMS.eraName, name, name),
    eraDescription: (name: string) => pick(ZH_TERMS.eraDescription, name, ERA_EN[name] ?? ""),
    /** World status, run status, content status, settlement status. */
    status: (s: string) => pick(ZH_TERMS.status, s, s),
    importance: (s: string) => pick(ZH_TERMS.importance, s, s),
    category: (s: string) => pick(ZH_TERMS.category, s, humanize(s)),
    scope: (s: string) => pick(ZH_TERMS.scope, s, s),
    feature: (s: string) => pick(ZH_TERMS.feature, s, humanize(s)),
    tag: (s: string) => pick(ZH_TERMS.tag, s, s),
    trait: (s: string) => pick(ZH_TERMS.trait, s, s),
    settlementKind: (s: string) => pick(ZH_TERMS.settlementKind, s, s),
    aiOutcome: (s: string) => pick(ZH_TERMS.aiOutcome, s, s),
    decidedBy: (s: string) => {
      if (!zh) return s;
      if (s === "developer override") return "開發者覆寫";
      if (s.startsWith("policy:")) return `議會政策：${pick(ZH_TERMS.policy, s.slice(7), s.slice(7))}`;
      return s;
    },
  };

  function relativeTime(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return t("time.justNow");
    if (diff < 3600) return t("time.minutesAgo", { n: Math.floor(diff / 60) });
    if (diff < 86400) return t("time.hoursAgo", { n: Math.floor(diff / 3600) });
    return t("time.daysAgo", { n: Math.floor(diff / 86400) });
  }

  return { locale, t, term, relativeTime };
}

export type I18n = ReturnType<typeof createI18n>;
export type T = I18n["t"];
