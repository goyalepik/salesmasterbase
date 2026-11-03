import { z } from "zod";
import type { MemoryCxRepository } from "../data/adapters/mock/memory-repo";
import * as svc from "../domain/service";
import type { CxStoreAdapter } from "./store";
import { mutate } from "./workspace";

// Every change from the browser arrives here by name. The server checks the role (in service.ts),
// checks nobody changed the ticket in the meantime, and writes the event with the signed-in person as actor.

const text = z.string().max(4000);
const ACTIONS = {
  take: z.object({}),
  start: z.object({}),
  stop: z.object({}),
  assign: z.object({ queueId: z.string() }),
  back_to_l1: z.object({ reason: text.optional() }),
  escalate: z.object({ reason: text }),
  override: z.object({ priority: z.enum(["P0", "P1", "P2", "P3"]).optional(), label: z.enum(["Low", "Medium", "High", "VIP"]).optional() }),
  hold: z.object({ reason: z.enum(["brand", "customer", "internal"]) }),
  resume: z.object({}),
  reply: z.object({ text }),
  note: z.object({ text }),
  resolve: z.object({ comment: text, closeReason: z.string().max(80), resolutionType: z.enum(["informative", "actionable"]) }),
  reopen: z.object({ reason: text.optional() }),
  call: z.object({ outcome: z.enum(["connected", "not_connected"]) }),
  lead: z.object({ outcome: z.enum(["picked", "not_picked", "pending"]) }),
} as const;

export type ActionName = keyof typeof ACTIONS;
export type ActionInput = { action: string; ticketId: string; payload?: unknown; /** Events the browser has seen for this ticket. */ expect?: number };

export class ConflictError extends Error {}

function apply(name: ActionName, p: Record<string, unknown>, repo: MemoryCxRepository, id: string, actor: svc.Actor, now: Date): Promise<void> {
  switch (name) {
    case "take": return svc.takeOwnership(repo, id, actor, now);
    case "start": return svc.startWork(repo, id, actor, now);
    case "stop": return svc.stopWork(repo, id, actor, now);
    case "assign": return svc.assign(repo, id, String(p.queueId), actor, now);
    case "back_to_l1": return svc.sendBackToL1(repo, id, actor, now, String(p.reason ?? ""));
    case "escalate": return svc.escalateToL3(repo, id, String(p.reason), actor, now);
    case "override": return svc.override(repo, id, p as Parameters<typeof svc.override>[2], actor, now);
    case "hold": return svc.hold(repo, id, p.reason as Parameters<typeof svc.hold>[2], actor, now);
    case "resume": return svc.resume(repo, id, actor, now);
    case "reply": return svc.reply(repo, id, String(p.text), actor, now);
    case "note": return svc.addNote(repo, id, String(p.text), actor, now);
    case "resolve": return svc.resolve(repo, id, p as Parameters<typeof svc.resolve>[2], actor, now);
    case "reopen": return svc.reopen(repo, id, String(p.reason ?? ""), actor, now);
    case "call": return svc.logOutboundCall(repo, id, p.outcome as "connected" | "not_connected", actor, now);
    case "lead": return svc.setLeadOutcome(repo, id, p.outcome as Parameters<typeof svc.setLeadOutcome>[2], actor, now);
  }
}

export async function runAction(store: CxStoreAdapter, input: ActionInput, actor: svc.Actor, now = new Date()): Promise<{ version: number }> {
  if (!(input.action in ACTIONS)) throw new svc.CxError("Unknown action.");
  const name = input.action as ActionName;
  const parsed = ACTIONS[name].safeParse(input.payload ?? {});
  if (!parsed.success) throw new svc.CxError("Some details are missing or wrong. Check the form and try again.");
  const { version } = await mutate(store, `t:${input.ticketId}`, async (repo) => {
    const events = await repo.listEvents(input.ticketId);
    if (input.expect != null && events.length !== input.expect) {
      const last = [...events].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      throw new ConflictError(`Updated by ${last ? svc.actorName(last.actorId) : "someone else"} just now. You now see the latest; try again if still needed.`);
    }
    await apply(name, parsed.data as Record<string, unknown>, repo, input.ticketId, actor, now);
  });
  return { version };
}

const SIMULATE = z.object({
  kind: z.enum(["message", "missed"]),
  channel: z.enum(["call", "whatsapp", "sms", "email", "instagram", "facebook", "web_chat"]).optional(),
  text: text.optional(),
  phone: z.string().max(20).optional(),
  orderRef: z.string().max(20).optional(),
});

/** Simulator: a made-up message goes through the real pipeline into the shared store. */
export async function simulate(store: CxStoreAdapter, payload: unknown, actor: svc.Actor, now = new Date()): Promise<{ version: number; ticketId: string }> {
  if (actor.role === "viewer") throw new svc.CxError("Viewers can look but not create tickets.");
  const p = SIMULATE.safeParse(payload);
  if (!p.success) throw new svc.CxError("Some details are missing or wrong.");
  const { kind, channel = "whatsapp", text: body, phone, orderRef } = p.data;
  const { result, version } = await mutate(store, "ingest", async (repo) => {
    const msg: svc.IncomingMessage = kind === "missed" ? { channel: "missed_call", phone } : { channel, text: body, phone: phone || undefined, orderRef: orderRef || undefined, handle: !svc.normalisePhone(phone) ? "@simulator" : undefined };
    const res = await svc.ingest(repo, msg, now);
    return res.ticket.id;
  });
  return { version, ticketId: result };
}
