"use client";

import { useI18n } from "./i18n";
import { CHART } from "@/lib/chart-palette";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";


const axisProps = { stroke: CHART.axis, tick: { fill: CHART.axis, fontSize: 11 }, tickLine: false, axisLine: false } as const;

function TooltipBox({ active, payload, label, xLabel }: { active?: boolean; payload?: { name?: string; value?: number | null; color?: string }[]; label?: number | string; xLabel: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 font-medium text-ink">{xLabel} {label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num text-ink">{p.value === null || p.value === undefined ? "—" : Math.round(p.value * 10) / 10}</span>
        </div>
      ))}
    </div>
  );
}

export interface SeriesPoint {
  tick: number;
  year: number;
  population: number;
  food: number;
  water: number;
  materials: number;
  knowledge: number;
}

export function PopulationChart({ data, height = 180 }: { data: SeriesPoint[]; height?: number }) {
  const { t } = useI18n();
  if (data.length < 2) return <ChartEmpty height={height} />;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="popFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.runA} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART.runA} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="year" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip content={<TooltipBox xLabel={t("chart.year")} />} cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }} />
          <Area type="monotone" dataKey="population" name={t("chart.population")} stroke={CHART.runA} strokeWidth={2} fill="url(#popFill)" isAnimationActive={false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ResourceChart({ data, height = 200 }: { data: SeriesPoint[]; height?: number }) {
  const { t, term } = useI18n();
  if (data.length < 2) return <ChartEmpty height={height} />;
  const series = (["food", "water", "materials", "knowledge"] as const).map((key) => ({ key, name: term.resource(key), color: CHART[key] }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="year" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={44} />
          <Tooltip content={<TooltipBox xLabel={t("chart.year")} />} cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }} />
          <Legend iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 11, color: CHART.ink2, paddingTop: 4 }} formatter={(v) => <span style={{ color: CHART.ink2 }}>{v}</span>} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompareChart({ data, dataKeyA, dataKeyB, nameA, nameB, height = 200 }: { data: Record<string, number | null>[]; dataKeyA: string; dataKeyB: string; nameA: string; nameB: string; height?: number }) {
  const { t } = useI18n();
  if (data.length < 2) return <ChartEmpty height={height} />;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="tick" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} allowDecimals={false} width={44} />
          <Tooltip content={<TooltipBox xLabel={t("chart.tick")} />} cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }} />
          <Legend iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} formatter={(v) => <span style={{ color: CHART.ink2 }}>{v}</span>} />
          <Line type="monotone" dataKey={dataKeyA} name={nameA} stroke={CHART.runA} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} />
          <Line type="monotone" dataKey={dataKeyB} name={nameB} stroke={CHART.runB} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartEmpty({ height }: { height: number }) {
  const { t } = useI18n();
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-xl border border-dashed border-line text-xs text-ink-3">
      {t("chart.empty")}
    </div>
  );
}
