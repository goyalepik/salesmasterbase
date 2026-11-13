import type { CxRepository } from "../data/repository";
import { scenario } from "./config";
import type { Customer, CustomerLabel } from "./types";

export type TimelineItem = { at: string; kind: "ticket" | "message" | "call" | "missed_call" | "order" | "demo"; title: string; detail?: string; tone?: "bad" | "good" | "warn"; ticketId?: string };

export type Customer360 = {
  customer: Customer;
  label: CustomerLabel;
  counters: { tickets: number; complaints: number; orders: number; demos: number; missedCalls: number; openIssues: number };
  channels: string[];
  timeline: TimelineItem[];
};

/** Everything we know about one customer, newest first. */
export async function customer360(repo: CxRepository, uid: string, now: Date): Promise<Customer360 | null> {
  const customer = await repo.getCustomer(uid);
  if (!customer) return null;
  const [tickets, interactions, orders, demos, calls] = await Promise.all([
    repo.listTickets().then((all) => all.filter((t) => t.customerUid === uid)),
    repo.listInteractions(uid),
    repo.listOrders(uid),
    repo.listDemos(uid),
    repo.listCalls(uid),
  ]);
  const timeline: TimelineItem[] = [
    ...tickets.map((t) => ({ at: t.createdAt, kind: "ticket" as const, ticketId: t.id, title: `${t.ref ?? t.id} · ${scenario(t.scenarioId).name}`, detail: `${t.priority} · ${t.status.replace("_", " ")}`, tone: t.bucket === "I" ? ("bad" as const) : undefined })),
    ...interactions.filter((i) => i.channel !== "missed_call").map((i) => ({ at: i.at, kind: "message" as const, title: `${i.direction === "inbound" ? "Message" : "Reply"} on ${i.channel.replace("_", " ")}`, detail: i.text?.slice(0, 120) })),
    ...calls.map((c) => ({
      at: c.at,
      kind: c.outcome === "missed" ? ("missed_call" as const) : ("call" as const),
      title: c.outcome === "missed" ? "Missed call" : `${c.direction === "outbound" ? "Called customer" : "Customer called"}: ${c.outcome === "connected" ? "connected" : "not connected"}`,
      tone: c.outcome === "missed" ? ("warn" as const) : c.outcome === "connected" ? ("good" as const) : ("warn" as const),
    })),
    ...orders.map((o) => ({ at: o.at, kind: "order" as const, title: `Order ${o.ref}: ${o.product}`, detail: `₹${o.amountRupees.toLocaleString("en-IN")} · ${o.payment.toUpperCase()} · ${o.status}`, tone: o.status === "unpaid" ? ("warn" as const) : undefined })),
    ...demos.map((d) => ({ at: d.at, kind: "demo" as const, title: `Demo: ${d.product}`, detail: d.status, tone: d.status === "missed" ? ("bad" as const) : d.status === "completed" ? ("good" as const) : undefined })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const open = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const complaints = tickets.filter((t) => t.bucket === "I").length;
  const recentNeg = tickets.some((t) => t.sentiment.tone === "neg" && now.getTime() - new Date(t.createdAt).getTime() < 14 * 86_400_000);
  const age = now.getTime() - new Date(customer.firstSeenAt).getTime();
  let label: CustomerLabel;
  if ((customer.csat ?? 5) <= 2 || recentNeg || open.some((t) => t.bucket === "I")) label = "unhappy";
  else if (tickets.length <= 1 && orders.length === 0 && age < 14 * 86_400_000) label = "new";
  else if ((customer.csat ?? 0) >= 4 && complaints === 0) label = "happy";
  else label = "average";

  return {
    customer,
    label,
    counters: { tickets: tickets.length, complaints, orders: orders.length, demos: demos.length, missedCalls: calls.filter((c) => c.outcome === "missed").length, openIssues: open.length },
    channels: [...new Set([...interactions.map((i) => i.channel), ...customer.handles.map((h) => h.channel)])],
    timeline,
  };
}
