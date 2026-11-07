import { Lock, Unlock } from "lucide-react";
import { population, residents } from "@genesis/narrative";
import { availableOrigins, civilization } from "@genesis/simulation";
import { CivilizationCard } from "@/components/civ/civilization";
import { queryHistory } from "@genesis/database";
import { SectionTitle } from "@/components/ui";
import { requirePlaying } from "@/components/play/guard";
import { db } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function WorldPage() {
  const { t } = await getI18n();
  const { state, runId } = await requirePlaying();
  const players = Object.values(state.players ?? {}).filter((p) => p.status !== "left").length;
  const chronicle = queryHistory(db(), runId, { minImportance: "major", order: "desc", limit: 12 }).items;
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{state.worldName}</h1>
      <p className="text-sm text-ink-3">{t("play.yearN", { year: state.startYear + state.tick })} · {t("play.world.population", { n: population(state) })} · {t("play.world.players", { n: players })}</p>

      <div className="mt-4"><CivilizationCard civ={civilization(state)} t={t} /></div>

      <SectionTitle>{t("play.world.settlements")}</SectionTitle>
      <ul className="card divide-y divide-line">
        {state.settlements.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className={s.status === "active" ? "" : "text-ink-3 line-through"}>{s.name}</span>
            <span className="num text-xs text-ink-3">{s.status === "active" ? residents(state, s.id).length : t("play.world.abandoned")}</span>
          </li>
        ))}
      </ul>

      <SectionTitle>{t("play.world.origins")}</SectionTitle>
      <ul className="card divide-y divide-line">
        {availableOrigins(state).map((o) => (
          <li key={o.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            {o.available ? <Unlock size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden /> : <Lock size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />}
            <span className="min-w-0">
              <span className={o.available ? "font-medium" : "text-ink-2"}>{t(`play.origin.${o.id}`)}</span>
              {!o.available && o.reason && <span className="block text-xs text-ink-3">{o.reason}</span>}
            </span>
          </li>
        ))}
      </ul>

      <SectionTitle>{t("play.world.chronicle")}</SectionTitle>
      <ol className="space-y-2">
        {chronicle.map((e) => (
          <li key={e.id} className="card px-4 py-3">
            <div className="num text-[11px] text-ink-3">{e.year}</div>
            <div className="text-sm font-medium">{e.title}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
