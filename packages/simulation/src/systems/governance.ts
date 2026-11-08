import type { WorldState } from "@genesis/schemas";
import { getCharacter, isZh, notify } from "@genesis/narrative";

/** Tell the proposer and the players who decided how a proposal ended. Once each. */
export function proposalNotices(st: WorldState): void {
  for (const p of st.proposals ?? []) {
    if (p.status === "open" || p.notified) continue;
    p.notified = true;
    const zh = isZh(st);
    const title = {
      executed: zh ? `提案通過：${p.title}` : `Approved: ${p.title}`,
      rejected: zh ? `提案被否決：${p.title}` : `Rejected: ${p.title}`,
      failed: zh ? `提案無法執行：${p.title}` : `Could not be carried out: ${p.title}`,
      open: "",
    }[p.status];
    const text = p.status === "failed" ? (zh ? `原因：${reasonZh(p.failReason)}` : `Reason: ${p.failReason ?? "unknown"}`) : (zh ? `贊成 ${p.approvedBy.length}，反對 ${p.rejectedBy.length}。` : `${p.approvedBy.length} for, ${p.rejectedBy.length} against.`);
    for (const id of new Set([p.proposerId, ...p.deciders])) if (getCharacter(st, id)?.controllerId) notify(st, id, title, text);
  }
}

function reasonZh(r: string | undefined): string {
  if (!r) return "條件已經不符合";
  if (r.includes("already being built")) return "已經有人在蓋了";
  if (r.includes("Nobody")) return "沒有人留下來決定";
  if (r.includes("cannot spend") || r.includes("short of")) return "聚落現在付不起";
  return "條件已經不符合";
}
