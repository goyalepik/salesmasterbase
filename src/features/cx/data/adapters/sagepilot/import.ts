import { ingest, reply, resolve, type Actor } from "../../../domain/service";
import { MemoryCxRepository, type CxSnapshot } from "../mock/memory-repo";
import type { ImportedChat } from "./map";

const SAGEPILOT: Actor = { id: "sagepilot", role: "admin" };

/**
 * Runs imported Sagepilot tickets through our own pipeline (classify, route, SLA), oldest first,
 * then replays what already happened in Sagepilot: the first reply and the close.
 */
export async function buildFromSagepilot(items: ImportedChat[], now: Date): Promise<CxSnapshot> {
  const repo = new MemoryCxRepository();
  const ordered = [...items].sort((a, b) => a.msg.at.localeCompare(b.msg.at));
  for (const item of ordered) {
    const at = new Date(item.msg.at);
    const result = await ingest(repo, { ...item.msg, at }, at);
    const t = result.ticket;
    if (result.reopened || result.mergedIntoCallback || t.status === "closed") continue;
    await repo.saveTicket({ ...t, explanation: [...t.explanation, `Imported from Sagepilot ticket #${item.sagepilot.code ?? item.sagepilot.id.slice(0, 8)}.`] });
    const sp = item.sagepilot;
    if (sp.firstResponseAt && sp.firstResponseAt >= item.msg.at) await reply(repo, t.id, sp.firstReplyBy === "ai" ? "Answered by the AI in Sagepilot" : "Replied in Sagepilot", SAGEPILOT, new Date(sp.firstResponseAt));
    const closedAt = sp.closedAt ?? (sp.status === "closed" ? item.msg.at : null);
    if (closedAt && new Date(closedAt) <= now) {
      await resolve(repo, t.id, { comment: "Closed in Sagepilot.", closeReason: "Closed in Sagepilot", resolutionType: t.type }, SAGEPILOT, new Date(Math.max(new Date(closedAt).getTime(), at.getTime())));
    }
    if (sp.csat != null) {
      const customer = await repo.getCustomer(t.customerUid);
      if (customer) await repo.saveCustomer({ ...customer, csat: Math.max(1, Math.min(5, Math.round(sp.csat))) });
    }
  }
  return repo.snapshot();
}
