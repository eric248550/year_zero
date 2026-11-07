import { NextResponse } from "next/server";
import { listRuns } from "@genesis/database";
import { WORLD_COOKIE } from "@/lib/play";
import { db, readJson } from "@/lib/server";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365 };

/** POST { worldId } — choose which world this browser plays in. */
export async function POST(req: Request) {
  const body = await readJson(req);
  const id = typeof body.worldId === "string" ? body.worldId : "";
  if (!listRuns(db()).some((r) => r.id === id && r.status === "active")) return NextResponse.json({ error: "That world is not open" }, { status: 404 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(WORLD_COOKIE, id, COOKIE);
  return res;
}
