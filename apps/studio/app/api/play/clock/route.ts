import { advanceClock, getActiveRunId } from "@genesis/database";
import { db, handle } from "@/lib/server";

/** Advance the live world if a tick is due. Point a cron here (e.g. every 5 minutes). */
export async function POST() {
  return handle(() => {
    const runId = getActiveRunId(db());
    if (!runId) throw new RangeError("No world is running yet");
    return advanceClock(db(), runId);
  });
}
