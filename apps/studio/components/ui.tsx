import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { Importance } from "@genesis/schemas";

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={clsx("card", className)}>{children}</As>;
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-signal">{icon}</div>}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold leading-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="label-xs mb-1 text-signal">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {action}
    </header>
  );
}

const pillTones = {
  neutral: "border-line-strong bg-surface-2 text-ink-2",
  signal: "border-signal/40 bg-signal/10 text-signal",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
  water: "border-water/40 bg-water/10 text-water",
  knowledge: "border-knowledge/40 bg-knowledge/10 text-knowledge",
} as const;
export type Tone = keyof typeof pillTones;

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", pillTones[tone], className)}>
      {children}
    </span>
  );
}

export function importanceTone(i: Importance): Tone {
  return i === "critical" ? "danger" : i === "major" ? "signal" : i === "notable" ? "knowledge" : "neutral";
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "thriving": return "ok";
    case "stable": return "water";
    case "struggling": return "warn";
    case "crisis":
    case "collapsed": return "danger";
    case "published": return "ok";
    case "validated": return "water";
    case "draft": return "warn";
    case "archived": return "neutral";
    case "active": return "ok";
    default: return "neutral";
  }
}

export function StatusDot({ status }: { status: string }) {
  const color = { thriving: "bg-ok", stable: "bg-water", struggling: "bg-warn", crisis: "bg-danger", collapsed: "bg-danger" }[status] ?? "bg-ink-3";
  return (
    <span className="relative inline-flex size-2.5">
      {status !== "collapsed" && <span className={clsx("absolute inline-flex size-full animate-ping rounded-full opacity-40", color)} />}
      <span className={clsx("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}

export function Stat({ label, value, hint, accent }: { label: ReactNode; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2/70 px-3 py-2.5">
      <div className="label-xs truncate">{label}</div>
      <div className={clsx("num mt-1 truncate text-xl font-semibold", accent ?? "text-ink")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ value, max, color = "bg-signal", className }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={clsx("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

const buttonStyles = {
  primary: "bg-signal text-black hover:bg-[#ffb94a] disabled:bg-signal-dim disabled:text-ink-3",
  secondary: "border border-line-strong bg-surface-2 text-ink hover:bg-surface-3 disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:text-ink-3",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50",
} as const;
export type ButtonVariant = keyof typeof buttonStyles;

export function buttonClass(variant: ButtonVariant = "secondary", size: "md" | "sm" | "lg" = "md", className?: string) {
  return clsx(
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed",
    size === "lg" ? "min-h-12 px-5 text-[15px]" : size === "md" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-[13px]",
    buttonStyles[variant],
    className,
  );
}

export function LinkButton({ href, children, variant = "secondary", size = "md", className }: { href: string; children: ReactNode; variant?: ButtonVariant; size?: "md" | "sm" | "lg"; className?: string }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <div className="max-w-sm text-sm text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export function Tabs({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="scroll-x -mx-4 mb-4 px-4" aria-label="Sections">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={clsx(
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
            t.key === active ? "border-signal/50 bg-signal/15 text-signal" : "border-line bg-surface text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num text-[11px] opacity-70">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 text-sm">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-2">
      <h2 className="label-xs">{children}</h2>
      {action}
    </div>
  );
}
