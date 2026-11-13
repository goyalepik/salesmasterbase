import type { Ticket, TicketEvent } from "../domain/types";
import type { CxStore } from "./store";

// One-off (v5 5.1): tickets numbered CX-10001… get their real key. With a Sagepilot id: "sp:<uuid>", shown "#<number>".
// Without: a website-only number "W-<n>". Events are copied to the new key; the old records are renamed to
// cx:legacy:t:<old id>, never deleted. A first response that was really the AI's reply is moved to firstAiReplyAt.

export async function migrateTicketIds(store: CxStore, tickets: Iterable<Ticket>): Promise<number> {
  const old = [...tickets].filter((t) => t.id.startsWith("CX-"));
  if (!old.length) return 0;
  if (!(await store.lock("migrate-ids", 120_000))) return 0;
  try {
    let moved = 0;
    for (const t of old) {
      const id = t.external?.id ? `sp:${t.external.id}` : `W-${await store.nextSeq("W", 1000)}`;
      const ref = t.external?.code ? `#${t.external.code}` : id;
      const events = await store.getEvents(t.id);
      const aiFirst = events.find((e) => e.kind === "agent_replied" && e.actorId === "sagepilot" && /AI/.test(String(e.payload.text ?? "")));
      const copied: TicketEvent[] = events.map((e) => ({ ...e, ticketId: id }));
      const next: Ticket = { ...t, id, ref, firstResponseAt: aiFirst && t.firstResponseAt === aiFirst.at ? undefined : t.firstResponseAt, firstAiReplyAt: aiFirst?.at ?? t.firstAiReplyAt, sp: t.sp ? { ...t.sp, lastMessageAt: null } : undefined };
      await store.commit({ tickets: [next], events: copied, customers: [], interactions: [], calls: [] });
      await store.kv.run([
        ["ZREM", "cx:idx:activity", t.id], ["SREM", "cx:idx:open", t.id], ["SREM", `cx:idx:phone:${t.customerUid}`, t.id], ["ZREM", "cx:chg", t.id],
        ["RENAME", `cx:t:${t.id}`, `cx:legacy:t:${t.id}`],
        ...(events.length ? [["RENAME", `cx:t:${t.id}:ev`, `cx:legacy:t:${t.id}:ev`]] : []),
        ["INCR", "cx:ver"],
      ]);
      moved++;
    }
    return moved;
  } finally {
    await store.unlock("migrate-ids");
  }
}
