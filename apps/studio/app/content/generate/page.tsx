import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Pill } from "@/components/ui";
import { Generator } from "@/components/content/generator";
import { aiStatus } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("gen.metaTitle") };
}

export default async function GeneratePage() {
  const { t } = await getI18n();
  const status = aiStatus();
  return (
    <div>
      <Link href="/content" className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {t("nav.content")}</Link>
      <PageHeader
        eyebrow={t("gen.eyebrow")}
        title={t("gen.title")}
        description={t("gen.description")}
        action={status.model ? <Pill tone="ok">{status.model.label}</Pill> : <Pill tone="warn">{t("gen.noModel")}</Pill>}
      />
      {!status.model && <p className="mb-4 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[13px] text-ink-2">{status.reason}. {t("gen.noModelBody")}</p>}
      <Generator model={status.model ? { label: status.model.label } : null} />
    </div>
  );
}
