import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { settings } from "../schema";
import { getRunRow, stepRun } from "./runs";

/** Never catch up more than this many ticks in one go (e.g. after the server was off). */
export const MAX_CATCH_UP_TICKS = 10;

/**
 * Real-time clock for live worlds: one tick every `GENESIS_TICK_MINUTES`
 * minutes (240 = 4 hours per world year for playtests, 1440 = one real day).
 * Unset or 0 = manual: time only moves when a developer steps the run.
 */
export function tickMinutes(): number | null {
  const n = Number(process.env.GENESIS_TICK_MINUTES ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface ClockStatus {
  enabled: boolean;
  minutes: number | null;
  /** ISO time of the next tick, or null when the clock is manual. */
  nextTickAt: string | null;
  /** Ticks advanced by this call. */
  stepped: number;
}

const key = (runId: string) => `clock.lastTickAt.${runId}`;

function readLast(db: Db, runId: string): number | null {
  const row = db.select().from(settings).where(eq(settings.key, key(runId))).get();
  const t = row ? Date.parse(row.value) : NaN;
  return Number.isFinite(t) ? t : null;
}

function writeLast(db: Db, runId: string, at: number) {
  const value = new Date(at).toISOString();
  db.insert(settings).values({ key: key(runId), value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/**
 * Advance the run if real time says a tick is due. Called lazily whenever
 * someone opens the game (or by a cron hitting /api/play/clock).
 */
export function advanceClock(db: Db, runId: string, now = Date.now(), minutes = tickMinutes()): ClockStatus {
  if (!minutes) return { enabled: false, minutes: null, nextTickAt: null, stepped: 0 };
  const interval = minutes * 60_000;
  const row = getRunRow(db, runId);
  let last = readLast(db, runId);
  if (last === null) {
    writeLast(db, runId, now);
    return { enabled: true, minutes, nextTickAt: new Date(now + interval).toISOString(), stepped: 0 };
  }
  let stepped = 0;
  const due = Math.floor((now - last) / interval);
  if (due > 0 && row.status === "active") {
    stepped = Math.min(due, MAX_CATCH_UP_TICKS);
    stepRun(db, runId, stepped);
    // A long outage does not replay a backlog: the world resumes from now.
    last = due > MAX_CATCH_UP_TICKS ? now : last + stepped * interval;
    writeLast(db, runId, last);
  }
  return { enabled: true, minutes, nextTickAt: new Date(last + interval).toISOString(), stepped };
}
