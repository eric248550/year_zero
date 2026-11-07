import { EmptyState } from "@/components/ui";
import { WorldList } from "@/components/play/world-list";
import { currentPlayerId, currentWorldId, listWorlds } from "@/lib/play";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Choose a world, like choosing a server. Each world has its own history, clock and players. */
export default async function WorldsPage() {
  const { t } = await getI18n();
  const worlds = listWorlds(await currentPlayerId());
  const current = await currentWorldId();
  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("play.worlds.title")}</h1>
        <p className="text-sm text-ink-2">{t("play.worlds.body")}</p>
      </div>
      {worlds.length === 0 ? (
        <EmptyState title={t("play.noWorld.title")}>{t("play.noWorld.body")}</EmptyState>
      ) : (
        <WorldList worlds={worlds} current={current} />
      )}
    </div>
  );
}
