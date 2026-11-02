import { addDays, todayIst } from "./insights";
import type { Kind, Priority, Status, TeamId, Ticket } from "./model";

type Seed = {
  title: string;
  description: string;
  kind: Kind;
  team: TeamId;
  assignee: string | null;
  requestedBy: string;
  requestingTeam: TeamId;
  status: Status;
  priority: Priority;
  /** Days from today; negative is in the past. */
  due: number | null;
  /** Days ago it was raised, and days ago it reached its current status. */
  raised: number;
  moved: number;
  waiting?: { team: TeamId; person: string | null; reason: string };
  comments?: Array<{ by: string; ago: number; text: string }>;
};

const SEEDS: Seed[] = [
  { title: "Refund ₹18,500 for #PIK3871 (customer called 3 times)", description: "Customer returned an Ecovacs T30 on 24 Oct. Support promised a refund in 5 days. Still not processed.", kind: "issue", team: "support", assignee: null, requestedBy: "bhavya", requestingTeam: "founders_office", status: "waiting", priority: "urgent", due: -2, raised: 6, moved: 4, waiting: { team: "revops", person: null, reason: "Refund needs RevOps approval and the UTR of the original payment" }, comments: [{ by: "bhavya", ago: 1, text: "Customer escalated on Google review. Please close today." }] },
  { title: "Diwali creatives for Dreame L50 and X50", description: "Instagram and WhatsApp creatives with the festive price. Needs final price from category.", kind: "task", team: "marketing", assignee: "abhiman", requestedBy: "gautama", requestingTeam: "founders_office", status: "doing", priority: "high", due: 1, raised: 5, moved: 2 },
  { title: "Raise PO for 50 Dreame L50 before Diwali", description: "Stock covers 9 days at the current run rate. Vendor: Value-One. Confirm cost with RevOps.", kind: "task", team: "operations", assignee: "piyush", requestedBy: "abhiman", requestingTeam: "marketing", status: "waiting", priority: "high", due: 0, raised: 4, moved: 3, waiting: { team: "founders_office", person: "gautama", reason: "PO over ₹10 lakh needs founder approval" } },
  { title: "Shopify orders created automatically from Slack", description: "Needs a Shopify custom app token with order write access.", kind: "request", team: "product", assignee: "saurav", requestedBy: "bhavya", requestingTeam: "founders_office", status: "waiting", priority: "normal", due: 5, raised: 3, moved: 2, waiting: { team: "product", person: null, reason: "Waiting for the Shopify admin to create the app token" } },
  { title: "Verify 12 UPI payments from Hebbal hub", description: "Salespeople say paid; bank statement not matched yet.", kind: "task", team: "revops", assignee: null, requestedBy: "piyush", requestingTeam: "operations", status: "new", priority: "high", due: 0, raised: 2, moved: 2 },
  { title: "Ecovacs X2 not mapping after install (#PIK3902)", description: "Customer says the robot keeps getting lost. Needs an installer revisit.", kind: "issue", team: "support", assignee: null, requestedBy: "piyush", requestingTeam: "operations", status: "new", priority: "urgent", due: 0, raised: 1, moved: 1 },
  { title: "Stock check: app vs Inventory Tracker", description: "Compare every SKU and fix mismatches before the sheet goes read-only.", kind: "task", team: "operations", assignee: "piyush", requestedBy: "gautama", requestingTeam: "founders_office", status: "doing", priority: "high", due: 2, raised: 3, moved: 1, comments: [{ by: "piyush", ago: 0, text: "Halfway. 14 SKUs off so far, mostly accessories." }] },
  { title: "October incentive numbers per POC", description: "Use offered price and the last-5-days rule.", kind: "task", team: "sales", assignee: null, requestedBy: "gautama", requestingTeam: "founders_office", status: "todo", priority: "normal", due: 3, raised: 2, moved: 2 },
  { title: "New price list for Narwal Freo X Ultra", description: "Brand changed DP on 1 Nov. Update the price on Shopify and tell sales.", kind: "task", team: "marketing", assignee: "abhiman", requestedBy: "saurav", requestingTeam: "product", status: "todo", priority: "normal", due: 4, raised: 1, moved: 1 },
  { title: "Weekly founder review: delays by team", description: "One page every Monday: what is late, who is waiting on whom.", kind: "request", team: "founders_office", assignee: "bhavya", requestedBy: "gautama", requestingTeam: "founders_office", status: "doing", priority: "normal", due: 3, raised: 2, moved: 0 },
  { title: "Samsung TV delivery date for #PIK3889", description: "Brand ships direct. Customer wants a date before the weekend.", kind: "request", team: "operations", assignee: "piyush", requestedBy: "bhavya", requestingTeam: "sales", status: "waiting", priority: "high", due: -1, raised: 5, moved: 3, waiting: { team: "sales", person: null, reason: "Need the customer's alternate address from the POC" } },
  { title: "Call back 9 customers who missed installation", description: "List from the installation tracker. Book new slots.", kind: "task", team: "support", assignee: null, requestedBy: "piyush", requestingTeam: "operations", status: "todo", priority: "normal", due: 2, raised: 3, moved: 3 },
  { title: "Team roles in the ops app", description: "Add every person's Slack ID and role in Settings.", kind: "task", team: "product", assignee: "bhavya", requestedBy: "gautama", requestingTeam: "founders_office", status: "done", priority: "normal", due: -1, raised: 7, moved: 2 },
  { title: "Bill reader for Stock in", description: "Upload a bill photo, AI reads lines and serials.", kind: "idea", team: "product", assignee: "saurav", requestedBy: "piyush", requestingTeam: "operations", status: "done", priority: "high", due: 0, raised: 6, moved: 1 },
  { title: "Festive bundle: robot vacuum + extra brush kit", description: "Check margin and stock of brush kits before we announce.", kind: "idea", team: "marketing", assignee: null, requestedBy: "abhiman", requestingTeam: "marketing", status: "new", priority: "low", due: 10, raised: 0, moved: 0 },
];

/** Realistic sample tickets dated around today, so the board looks like a normal week. */
export function sampleTickets(now: Date = new Date()): Ticket[] {
  const today = todayIst(now);
  const ago = (days: number, hours = 3) => new Date(now.getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();
  return SEEDS.map((s, index) => {
    const raised = ago(s.raised, 5);
    const moved = ago(s.moved, 2);
    const events = [{ at: raised, by: s.requestedBy, text: s.requestingTeam === s.team ? "raised this" : "raised this for another team" }];
    if (s.status !== "new") events.push({ at: moved, by: s.assignee ?? s.requestedBy, text: s.waiting ? `is waiting: ${s.waiting.reason}` : `moved this to ${s.status === "doing" ? "In progress" : s.status === "done" ? "Done" : "To do"}` });
    return {
      id: `s${index + 1}`,
      number: 101 + index,
      title: s.title,
      description: s.description,
      kind: s.kind,
      team: s.team,
      assignee: s.assignee,
      requestedBy: s.requestedBy,
      requestingTeam: s.requestingTeam,
      status: s.status,
      priority: s.priority,
      due: s.due == null ? null : addDays(today, s.due),
      waiting: s.waiting ? { ...s.waiting, since: moved } : null,
      dropped: false,
      comments: (s.comments ?? []).map((c, i) => ({ id: `c${index}-${i}`, by: c.by, at: ago(c.ago, 1), text: c.text })),
      events,
      createdAt: raised,
      updatedAt: s.comments?.length ? ago(Math.min(...s.comments.map((c) => c.ago)), 1) : moved,
      statusSince: moved,
      doneAt: s.status === "done" ? moved : null,
      version: 1,
      sample: true,
    };
  });
}
