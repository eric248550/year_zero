import { NextResponse } from "next/server";
import { listRuns } from "@genesis/database";
import { WORLD_COOKIE } from "@/lib/play";
import { db } from "@/lib/server";

/** GET /play/enter?world=ID[&invite=CODE] — open a world from a shared link (invites are per world). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const world = url.searchParams.get("world") ?? "";
  const invite = url.searchParams.get("invite");
  const target = new URL(invite ? `/play?invite=${encodeURIComponent(invite)}` : "/play", url);
  const res = NextResponse.redirect(target);
  if (listRuns(db()).some((r) => r.id === world && r.status === "active")) {
    res.cookies.set(WORLD_COOKIE, world, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}
