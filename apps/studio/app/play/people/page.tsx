import clsx from "clsx";
import type { Character } from "@genesis/schemas";
import { fullName, relationshipKey, residents } from "@genesis/narrative";
import { bondKind, isReserved } from "@genesis/simulation";
import { Pill, SectionTitle } from "@/components/ui";
import { CopyLink, InviteButton, LeaveWorld } from "@/components/play/people-actions";
import { bondTier } from "@/components/play/bond";
import { requirePlaying } from "@/components/play/guard";
import { ageOf } from "@/lib/play";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const { t, term } = await getI18n();
  const { state, character: me, player, runId } = await requirePlaying();
  const byId = (id: string) => state.characters.find((c) => c.id === id);
  const bond = (c: Character) => state.relationships[relationshipKey(me.id, c.id)] ?? 0;

  const parents = me.parentIds.map(byId).filter((c): c is Character => !!c);
  const children = state.characters.filter((c) => c.parentIds.includes(me.id));
  const cared = state.characters.filter((c) => c.caretakerIds?.includes(me.id));
  const caretakers = (me.caretakerIds ?? []).map(byId).filter((c): c is Character => !!c);
  const shown = new Set([me.id, ...parents, ...children, ...cared, ...caretakers].map((c) => (typeof c === "string" ? c : c.id)));
  const known = Object.entries(state.relationships)
    .filter(([k]) => k.split("|").includes(me.id))
    .map(([k, v]) => ({ c: byId(k.split("|").find((id) => id !== me.id)!), v }))
    .filter((x): x is { c: Character; v: number } => !!x.c && !shown.has(x.c.id))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  for (const k of known) shown.add(k.c.id);
  const neighbours = residents(state, me.homeId).filter((c) => !shown.has(c.id));

  const invites = Object.values(state.invites ?? {}).filter((i) => i.fromPlayerId === player.id);
  const invitable = (c: Character) => c.deathTick === null && !c.controllerId && !isReserved(state, c.id) && bondKind(state, me, c) !== null;

  const Row = ({ c, note }: { c: Character; note?: string }) => {
    const alive = c.deathTick === null;
    const controller = c.controllerId ? state.players?.[c.controllerId] : undefined;
    const v = bond(c);
    const tier = bondTier(v);
    return (
      <li className="space-y-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={clsx("font-medium", !alive && "text-ink-3")}>{fullName(c)}{!alive && " †"}</span>
            <div className="text-xs text-ink-3">
              {note && <>{note} · </>}
              {alive ? t("play.me.age", { age: ageOf(state, c) }) : t("play.people.dead", { year: state.startYear + c.deathTick! })}
              {c.profession && <> · {term.profession(c.profession)}</>}

            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {controller && <Pill tone="ok">{t("play.people.player")}</Pill>}
            {v !== 0 && <span className={`num text-xs ${tier.tone}`}>{t(tier.key)} {v > 0 ? "+" : ""}{v}</span>}
          </div>
        </div>
        {invitable(c) && <InviteButton characterId={c.id} label={t("play.people.inviteAs", { name: c.givenName })} />}
      </li>
    );
  };

  return (
    <div>
      {(parents.length > 0 || children.length > 0) && (
        <>
          <SectionTitle>{t("play.people.family")}</SectionTitle>
          <ul className="card divide-y divide-line">
            {parents.map((c) => <Row key={c.id} c={c} note={t("play.people.parent")} />)}
            {children.map((c) => <Row key={c.id} c={c} note={t("play.people.child")} />)}
          </ul>
        </>
      )}
      {(cared.length > 0 || caretakers.length > 0) && (
        <>
          <SectionTitle>{t("play.people.cared")}</SectionTitle>
          <ul className="card divide-y divide-line">
            {cared.map((c) => <Row key={c.id} c={c} />)}
            {caretakers.map((c) => <Row key={c.id} c={c} note={t("play.people.caresForYou")} />)}
          </ul>
        </>
      )}
      {known.length > 0 && (
        <>
          <SectionTitle>{t("play.people.bonds")}</SectionTitle>
          <p className="mb-2 text-xs text-ink-3">{t("play.people.bondsHint")}</p>
          <ul className="card divide-y divide-line">{known.map(({ c }) => <Row key={c.id} c={c} />)}</ul>
        </>
      )}

      <SectionTitle>{t("play.people.invite")}</SectionTitle>
      <div className="card space-y-3 p-4">
        <p className="text-sm text-ink-2">{t("play.people.inviteHint")}</p>
        {ageOf(state, me) >= 16 && <InviteButton label={t("play.people.inviteChild")} />}
        {invites.length > 0 && (
          <ul className="space-y-3 border-t border-line pt-3">
            {invites.map((inv) => {
              const target = inv.characterId ? byId(inv.characterId) : undefined;
              return (
                <li key={inv.code} className="space-y-1">
                  <div className="text-sm font-medium">{target ? t("play.people.inviteFor", { name: fullName(target) }) : t("play.people.inviteNextChild")}</div>
                  <div className="num text-xs text-ink-3">{inv.code} · {inv.acceptedBy ? t("play.people.accepted") : t("play.people.expires", { year: state.startYear + inv.expiresTick })}</div>
                  {!inv.acceptedBy && <CopyLink code={inv.code} worldId={runId} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {neighbours.length > 0 && (
        <>
          <SectionTitle>{t("play.people.neighbours")}</SectionTitle>
          <ul className="card divide-y divide-line">{neighbours.slice(0, 40).map((c) => <Row key={c.id} c={c} />)}</ul>
        </>
      )}

      <div className="mt-8"><LeaveWorld /></div>
    </div>
  );
}
