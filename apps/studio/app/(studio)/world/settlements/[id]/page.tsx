import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LOCATION_BY_ID, PROFESSIONS, RESOURCES } from "@genesis/schemas";
import { characterAge, fullName, residents } from "@genesis/narrative";
import { queryHistory } from "@genesis/database";
import { Card, CardHeader, KeyValue, Pill, ProgressBar } from "@/components/ui";
import { EventRow, ResourceTile } from "@/components/domain";
import { db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, term } = await getI18n();
  const run = loadActiveRun();
  if (!run) notFound();
  const { state } = run;
  const s = state.settlements.find((x) => x.id === id);
  if (!s) notFound();
  const people = residents(state, s.id).sort((a, b) => a.birthTick - b.birthTick);
  const loc = LOCATION_BY_ID[s.locationId];
  const history = queryHistory(db(), run.summary.id, { settlementId: s.id, minImportance: "notable", limit: 12 }).items;

  return (
    <div className="space-y-4">
      <Link href="/world" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {t("nav.world")}</Link>
      <Card>
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone={s.status === "active" ? "ok" : "danger"}>{term.status(s.status)}</Pill>
            <Pill>{term.settlementKind(s.kind)}</Pill>
            <Pill>{t("world.level", { n: s.level })}</Pill>
            {s.shortage.food > 0 && <Pill tone="warn">{t("settlement.shortage", { resource: term.resource("food"), n: s.shortage.food })}</Pill>}
            {s.shortage.water > 0 && <Pill tone="warn">{t("settlement.shortage", { resource: term.resource("water"), n: s.shortage.water })}</Pill>}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{s.name}</h1>
          <p className="mt-1 text-sm text-ink-2">{loc ? term.locationDescription(loc.id) : ""}</p>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[12px] text-ink-3"><span>{t("settlement.popCapacity")}</span><span className="num">{people.length}/{s.capacity}</span></div>
            <ProgressBar value={people.length} max={s.capacity} />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RESOURCES.map((r) => <ResourceTile key={r} resource={r} value={s.resources[r]} perCapita={people.length ? s.resources[r] / people.length : 0} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("settlement.stats")} />
          <div className="px-4 pb-4">
            <KeyValue items={[
              [t("world.morale"), <span key="m" className="num">{Math.round(s.morale)}/100</span>],
              [t("world.health"), <span key="h" className="num">{Math.round(s.health)}/100</span>],
              [t("settlement.founded"), <span key="f" className="num">{state.startYear + s.foundedTick}</span>],
              [t("settlement.features"), loc?.features.map(term.feature).join(", ") ?? "—"],
              ...PROFESSIONS.map((p) => [term.profession(p), <span key={p} className="num">{people.filter((c) => c.profession === p).length}</span>] as [string, React.ReactNode]),
            ]} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("settlement.notableHistory")} action={<Link className="text-sm text-signal" href={`/history?settlement=${s.id}`}>{t("common.all")}</Link>} />
          {history.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("settlement.nothingNotable")}</p> : history.map((e) => <EventRow key={e.id} event={e} href={`/history/${e.id}`} compact />)}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("settlement.residents")} subtitle={t("settlement.living", { n: people.length })} />
        <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
          {people.map((c) => (
            <li key={c.id}><Link href={`/world/characters/${c.id}`} className="flex min-h-11 items-center justify-between px-4 text-sm hover:bg-surface-2/50"><span className="truncate">{fullName(c)}</span><span className="shrink-0 text-ink-3">{term.profession(c.profession)} · {characterAge(state, c)}</span></Link></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
