import { RESOURCES } from "@genesis/schemas";
import { fullName, residents } from "@genesis/narrative";
import { Pill, ProgressBar, SectionTitle } from "@/components/ui";
import { requirePlaying } from "@/components/play/guard";
import { ageOf } from "@/lib/play";
import { RESOURCE_META } from "@/lib/resource-meta";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettlementPage() {
  const { t, term } = await getI18n();
  const { state, character: me } = await requirePlaying();
  const home = state.settlements.find((s) => s.id === me.homeId)!;
  const people = residents(state, home.id).sort((a, b) => Number(!!b.controllerId) - Number(!!a.controllerId) || ageOf(state, b) - ageOf(state, a));
  const players = people.filter((c) => c.controllerId).length;
  const per = (n: number) => Math.round((n / Math.max(1, people.length)) * 10) / 10;
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{home.name}</h1>
      <p className="text-sm text-ink-3">{t("play.st.residents", { n: people.length })} · {t("play.st.players", { n: players })}</p>

      <SectionTitle>{t("play.st.stores")}</SectionTitle>
      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-line">
        {RESOURCES.map((r) => (
          <div key={r} className="bg-surface p-3">
            <div className="text-xs text-ink-3">{term.resource(r)}</div>
            <div className={`num text-lg ${RESOURCE_META[r].text}`}>{Math.round(home.resources[r])}</div>
            {(r === "food" || r === "water") && <div className="text-[11px] text-ink-3">{t("play.st.perPerson", { n: per(home.resources[r]) })}</div>}
          </div>
        ))}
      </div>
      <div className="card mt-3 space-y-3 p-4">
        {(["morale", "health"] as const).map((k) => (
          <div key={k} className="space-y-1">
            <div className="flex justify-between text-sm"><span className="text-ink-2">{t(`play.st.${k}`)}</span><span className="num">{Math.round(home[k])}</span></div>
            <ProgressBar value={home[k]} max={100} color={home[k] < 40 ? "bg-danger" : home[k] < 60 ? "bg-warn" : "bg-ok"} />
          </div>
        ))}
      </div>

      <SectionTitle>{t("play.st.residents", { n: people.length })}</SectionTitle>
      <ul className="card divide-y divide-line">
        {people.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 truncate">{fullName(c)}{c.id === me.id && " ★"}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-ink-3">
              {c.controllerId && <Pill tone="ok">{t("play.people.player")}</Pill>}
              {ageOf(state, c)} · {c.profession ? term.profession(c.profession) : t("play.me.child")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
