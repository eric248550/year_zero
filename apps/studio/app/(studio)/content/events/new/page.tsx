import { listEventDefinitions, listStorylines } from "@genesis/database";
import { PageHeader } from "@/components/ui";
import { EventEditor } from "@/components/content/event-editor";
import { db } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("editor.newTitle") };
}

const TEMPLATE = {
  id: "my-new-event",
  title: "Collapsed Tunnel",
  scope: "settlement",
  category: "environment",
  description: "An old service tunnel caves in.",
  preconditions: [{ type: "settlement_kind", kind: "bunker" }, { type: "world_tick", op: ">=", value: 3 }],
  roles: [{ id: "engineer", profession: "Engineer", minAge: 16 }],
  effects: [{ type: "ADJUST_RESOURCE", resource: "materials", amount: -10 }],
  choices: [
    { id: "shore_up", label: "Shore up the tunnel", tags: ["cautious", "industry"], costs: { materials: 8 }, effects: [{ type: "CHANGE_SETTLEMENT_STAT", stat: "morale", delta: 2 }], outcome: "{{engineer}} braces the ceiling with salvaged beams." },
    { id: "seal", label: "Seal it off", tags: ["cautious"], effects: [{ type: "CHANGE_SETTLEMENT_STAT", stat: "capacity", delta: -2 }] },
  ],
  priority: 4,
  chance: 0.15,
  cooldown: 8,
  maxOccurrences: null,
  storylineIds: [],
  importance: "notable",
  narrative: { headline: "Tunnel collapse in {{settlement}}", text: "A roar echoed through {{settlement}} as an old tunnel gave way." },
};

export default async function NewEventPage() {
  const { t } = await getI18n();
  return (
    <div>
      <PageHeader eyebrow={t("nav.content")} title={t("editor.newTitle")} description={t("editor.newDescription")} />
      <EventEditor
        creating
        initial={JSON.stringify(TEMPLATE, null, 2)}
        knownEventIds={listEventDefinitions(db()).map((d) => d.id)}
        knownStorylineIds={listStorylines(db()).map((s) => s.id)}
      />
    </div>
  );
}
