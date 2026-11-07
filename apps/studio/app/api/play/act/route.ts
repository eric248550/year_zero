import { NextResponse } from "next/server";
import { fullName, getCharacter } from "@genesis/narrative";
import { db, handle, readJson } from "@/lib/server";
import { PLAYER_COOKIE, actAs, currentPlayerId, currentWorldId, newPlayerId } from "@/lib/play";

/**
 * POST { action } — apply a player action to the live world immediately.
 * `playerId` is taken from the player cookie (created on JOIN_WORLD).
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const action = body.action && typeof body.action === "object" ? (body.action as Record<string, unknown>) : {};
  let playerId = await currentPlayerId();
  const joining = action.type === "JOIN_WORLD";
  if (!playerId && joining) playerId = newPlayerId();
  if (!playerId) return NextResponse.json({ error: "Join the world first" }, { status: 401 });

  const runId = await currentWorldId();
  const res = await handle(() => {
    if (!runId) throw new RangeError("Choose a world first");
    const r = actAs(runId, playerId!, action);
    // Names of everyone involved, so the client can show results without another request.
    const names: Record<string, string> = {};
    for (const e of r.events) for (const id of e.characterIds) {
      const c = getCharacter(r.state, id);
      if (c) names[id] = fullName(c);
    }
    return { events: r.events.map((e) => ({ id: e.id, title: e.title, text: e.text, characterIds: e.characterIds })), names };
  });
  if (joining && res.ok) {
    res.cookies.set(PLAYER_COOKIE, playerId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}
