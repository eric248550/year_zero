import clsx from "clsx";
import { Droplet, HeartPulse, Smile, Utensils } from "lucide-react";
import { ProgressBar } from "@/components/ui";
import type { createI18n } from "@/lib/i18n/core";
import type { ConditionView } from "@/lib/play";

type T = ReturnType<typeof createI18n>["t"];

/** Need words: higher is worse. */
function needLevel(v: number) {
  return v <= 15 ? "fine" : v <= 35 ? "ok" : v <= 55 ? "some" : v <= 75 ? "bad" : "worst";
}
/** Wellbeing words: higher is better. */
function wellLevel(v: number) {
  return v < 25 ? "worst" : v < 45 ? "bad" : v < 65 ? "ok" : v < 85 ? "good" : "great";
}
const needTone = (v: number) => (v > 55 ? "bg-danger" : v > 35 ? "bg-warn" : "bg-ok");
const wellTone = (v: number) => (v < 25 ? "bg-danger" : v < 45 ? "bg-warn" : "bg-ok");

function Meter({ icon, label, word, value, color, why, danger }: { icon: React.ReactNode; label: string; word: string; value: number; color: string; why: string; danger: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-ink-2"><span className="text-ink-3">{icon}</span>{label}</span>
        <span className={clsx("num text-sm font-semibold", danger ? "text-danger" : "text-ink")} title={word}>{value}</span>
      </div>
      <ProgressBar value={value} max={100} color={color} />
      <p className="text-[11px] leading-snug text-ink-3">{why}</p>
    </div>
  );
}

/** How the character is doing right now, with the reason under each meter. */
export function ConditionPanel({ c, t }: { c: ConditionView; t: T }) {
  const hunger = needLevel(c.hunger.value);
  const thirst = needLevel(c.thirst.value);
  const health = wellLevel(c.health.value);
  const mood = wellLevel(c.mood.value);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Meter
          icon={<Utensils size={13} />}
          label={t("play.cond.hunger")}
          word={t(`play.cond.need.hunger.${hunger}`)}
          value={c.hunger.value}
          color={needTone(c.hunger.value)}
          danger={c.hunger.value > 55}
          why={c.hunger.shortYears > 0 ? t("play.cond.hunger.short", { n: c.hunger.shortYears }) : t("play.cond.hunger.stock", { n: c.hunger.foodYears })}
        />
        <Meter
          icon={<Droplet size={13} />}
          label={t("play.cond.thirst")}
          word={t(`play.cond.need.thirst.${thirst}`)}
          value={c.thirst.value}
          color={needTone(c.thirst.value)}
          danger={c.thirst.value > 55}
          why={c.thirst.shortYears > 0 ? t("play.cond.thirst.short", { n: c.thirst.shortYears }) : t("play.cond.thirst.stock", { n: c.thirst.waterYears })}
        />
        <Meter
          icon={<HeartPulse size={13} />}
          label={t("play.cond.health")}
          word={t(`play.cond.well.${health}`)}
          value={c.health.value}
          color={wellTone(c.health.value)}
          danger={c.health.value < 25}
          why={c.health.personal ? t("play.cond.health.why") : t("play.cond.health.settlement")}
        />
        <Meter
          icon={<Smile size={13} />}
          label={t("play.cond.mood")}
          word={t(`play.cond.well.${mood}`)}
          value={c.mood.value}
          color={wellTone(c.mood.value)}
          danger={c.mood.value < 25}
          why={c.mood.closest && c.mood.closest.bond >= 20 ? t("play.cond.mood.why", { morale: c.mood.morale, name: c.mood.closest.name }) : t("play.cond.mood.alone", { morale: c.mood.morale })}
        />
      </div>
      {c.abilities && (
        <div className="border-t border-line pt-3">
          <div className="label-xs mb-2">{t("play.cond.abilities")}</div>
          <div className="grid grid-cols-3 gap-3">
            {(["knowledge", "social", "survival"] as const).map((k) => (
              <div key={k} className="min-w-0 space-y-1" title={t(`play.attr.${k}.hint`)}>
                <div className="flex justify-between text-xs"><span className="text-ink-2">{t(`play.attr.${k}`)}</span><span className="num">{c.abilities![k]}</span></div>
                <ProgressBar value={c.abilities![k]} max={100} color={k === "knowledge" ? "bg-knowledge" : k === "social" ? "bg-signal" : "bg-materials"} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
