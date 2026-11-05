import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEventDefinition, listEventDefinitions, listStorylines } from "@genesis/database";
import { PageHeader } from "@/components/ui";
import { EventEditor } from "@/components/content/event-editor";
import { db } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getI18n();
  const row = getEventDefinition(db(), id);
  if (!row) notFound();
  const { status: _status, version: _version, source: _source, ...editable } = row.definition;
  return (
    <div>
      <Link href={`/content/events/${id}`} className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {row.definition.title}</Link>
      <PageHeader title={t("editor.editTitle", { id })} description={t("editor.editDescription")} />
      <EventEditor
        initial={JSON.stringify(editable, null, 2)}
        expectedId={id}
        knownEventIds={listEventDefinitions(db()).map((d) => d.id)}
        knownStorylineIds={listStorylines(db()).map((s) => s.id)}
      />
    </div>
  );
}
