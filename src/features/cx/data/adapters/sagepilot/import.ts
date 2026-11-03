import type { CxRepository } from "../../repository";
import { ingest, reply, resolve, type Actor } from "../../../domain/service";
import { MemoryCxRepository, type CxSnapshot } from "../mock/memory-repo";
import type { ImportedChat } from "./map";

const SAGEPILOT: Actor = { id: "sagepilot", role: "admin" };

/**
 * Runs imported Sagepilot tickets through our own pipeline (classify, route, SLA), oldest first,
 * then replays what already happened in Sagepilot: the first reply and the close.
 * Tickets already in `repo` (same Sagepilot id) are skipped, so running it again adds only new ones.
 */
export async function importSagepilot(repo: CxRepository, items: ImportedChat[], now: Date): Promise<{ added: number; skipped: number }> {
  const known = new Set((await repo.listTickets()).map((t) => t.external?.id).filter(Boolean));
  const ordered = [...items].sort((a, b) => a.msg.at.localeCompare(b.msg.at));
  let added = 0;
  for (const item of ordered) {
    if (known.has(item.sagepilot.id)) continue;
    known.add(item.sagepilot.id);
    const at = new Date(item.msg.at);
    const result = await ingest(repo, { ...item.msg, at }, at);
    const t = result.ticket;
    if (result.reopened || result.mergedIntoCallback) continue;
    added += 1;
    const sp = item.sagepilot;
    // Tag every new ticket with its Sagepilot id (also ones the AI closed), so the next sync skips it.
    await repo.saveTicket({ ...t, external: { system: "sagepilot", id: sp.id, code: sp.code }, explanation: [...t.explanation, `Imported from Sagepilot ticket #${sp.code ?? sp.id.slice(0, 8)}.`] });
    if (t.status === "closed") continue;
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
  return { added, skipped: items.length - added };
}

/** A fresh in-memory copy built from Sagepilot items (used by tests and the replay check). */
export async function buildFromSagepilot(items: ImportedChat[], now: Date): Promise<CxSnapshot> {
  const repo = new MemoryCxRepository();
  await importSagepilot(repo, items, now);
  return repo.snapshot();
}
