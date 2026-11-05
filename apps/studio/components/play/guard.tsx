import { redirect } from "next/navigation";
import { loadPlay } from "@/lib/play";

/** Tabs other than "This year" need a living character who finished the prologue. */
export async function requirePlaying() {
  const ctx = await loadPlay();
  if (!ctx?.character || (ctx.player?.prologue?.length ?? 0) < 3) redirect("/play");
  return { ...ctx, character: ctx.character, player: ctx.player! };
}
