import { advanceClock, listRuns } from "@genesis/database";
import { db, handle } from "@/lib/server";

/** Advance every live world whose year is due. Point a cron here (e.g. every 5 minutes). */
export async function POST() {
  return handle(() => {
    const d = db();
    return listRuns(d)
      .filter((r) => r.status === "active")
      .map((r) => ({ runId: r.id, ...advanceClock(d, r.id) }));
  });
}
