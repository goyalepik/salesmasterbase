import { addDays, todayIst } from "./insights";
import type { Status, Ticket } from "./model";

type Seed = {
  title: string;
  note?: string;
  assignee: string | null;
  createdBy: string;
  status: Status;
  /** Days from today; negative is in the past. */
  due: number | null;
  /** Days ago it was created. */
  raised: number;
  blocked?: { by: string; reason: string; ago: number };
  comment?: { by: string; ago: number; text: string };
};

const SEEDS: Seed[] = [
  { title: "Diwali creatives for Dreame L50 and X50", note: "Instagram and WhatsApp creatives with the festive price.", assignee: "abhiman", createdBy: "gautama", status: "doing", due: 1, raised: 5 },
  { title: "Raise PO for 50 Dreame L50 before Diwali", note: "Stock covers 9 days at the current run rate.", assignee: "piyush", createdBy: "abhiman", status: "doing", due: 0, raised: 4, blocked: { by: "gautama", reason: "PO over ₹10 lakh needs founder approval", ago: 3 } },
  { title: "Shopify orders created automatically from Slack", assignee: "saurav", createdBy: "bhavya", status: "todo", due: 5, raised: 3 },
  { title: "Stock check: app vs Inventory Tracker", note: "Compare every SKU and fix mismatches.", assignee: "piyush", createdBy: "gautama", status: "doing", due: 2, raised: 3, comment: { by: "piyush", ago: 0, text: "Halfway. 14 SKUs off so far, mostly accessories." } },
  { title: "New price list for Narwal Freo X Ultra", note: "Brand changed DP on 1 Nov.", assignee: "abhiman", createdBy: "saurav", status: "todo", due: 4, raised: 1 },
  { title: "Weekly founder review: delays by team", assignee: "bhavya", createdBy: "gautama", status: "doing", due: 3, raised: 2 },
  { title: "Samsung TV delivery date for #PIK3889", note: "Brand ships direct. Customer wants a date before the weekend.", assignee: "piyush", createdBy: "bhavya", status: "todo", due: -1, raised: 5 },
  { title: "October incentive numbers per POC", assignee: "bhavya", createdBy: "gautama", status: "todo", due: -2, raised: 6, blocked: { by: "piyush", reason: "Needs the final delivered list for October", ago: 2 } },
  { title: "Team roles in the ops app", assignee: "bhavya", createdBy: "gautama", status: "done", due: -1, raised: 7 },
  { title: "Bill reader for Stock in", assignee: "saurav", createdBy: "piyush", status: "done", due: 0, raised: 6 },
  { title: "Festive bundle: robot vacuum + brush kit", assignee: null, createdBy: "abhiman", status: "todo", due: 10, raised: 0 },
];

/** A believable week for the demo, dated relative to today. */
export function sampleTickets(now: Date = new Date()): Ticket[] {
  const today = todayIst(now);
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return SEEDS.map((s, i) => {
    const created = ago(s.raised);
    return {
      id: `s${i + 1}`,
      number: 101 + i,
      title: s.title,
      note: s.note ?? "",
      assignee: s.assignee,
      due: s.due == null ? null : addDays(today, s.due),
      status: s.status,
      blocked: s.blocked ? { by: s.blocked.by, reason: s.blocked.reason, since: ago(s.blocked.ago) } : null,
      createdBy: s.createdBy,
      createdAt: created,
      updatedAt: ago(Math.min(s.raised, 1)),
      doneAt: s.status === "done" ? ago(1) : null,
      comments: s.comment ? [{ id: `c${i}`, by: s.comment.by, at: ago(s.comment.ago), text: s.comment.text }] : [],
      history: [{ at: created, by: s.createdBy, text: "Created" }],
    };
  });
}
