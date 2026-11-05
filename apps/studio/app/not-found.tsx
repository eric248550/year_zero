import { LinkButton } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <div className="label-xs text-signal">{t("notFound.eyebrow")}</div>
      <h1 className="mt-2 text-lg font-semibold">{t("notFound.title")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("notFound.body")}</p>
      <LinkButton href="/" variant="primary" className="mt-5">{t("notFound.back")}</LinkButton>
    </div>
  );
}
