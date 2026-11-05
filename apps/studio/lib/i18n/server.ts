import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createI18n, LOCALE_COOKIE, resolveLocale } from "./core";

/** Per-request translator for server components (memoised per render). */
export const getI18n = cache(async () => {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return createI18n(resolveLocale(c.get(LOCALE_COOKIE)?.value, h.get("accept-language")));
});
