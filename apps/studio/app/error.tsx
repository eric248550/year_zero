"use client";

import { AlertTriangle } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { useI18n } from "@/components/i18n";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <AlertTriangle className="mx-auto text-danger" />
      <h1 className="mt-3 text-lg font-semibold">{t("error.title")}</h1>
      <p className="mt-2 break-words text-sm text-ink-2">{error.message}</p>
      <p className="mt-2 text-xs text-ink-3">{t("error.dbHint")} <code className="num">pnpm db:migrate &amp;&amp; pnpm db:seed</code>.</p>
      <button onClick={reset} className={buttonClass("primary", "md", "mt-5")}>{t("error.retry")}</button>
    </div>
  );
}
