// Team Tracker: the data model and fixed lists. No imports from the rest of the app, so this folder can move to its own project.

export type TeamId = "founders_office" | "product" | "marketing" | "sales" | "support" | "operations" | "revops";
export type RoleId = "founder" | "admin" | "lead" | "member" | "viewer";
export type Status = "new" | "todo" | "doing" | "waiting" | "done";
export type Priority = "urgent" | "high" | "normal" | "low";
export type Kind = "task" | "request" | "issue" | "idea";

export type Team = { id: TeamId; name: string; short: string; colour: string; about: string };

export type Person = { id: string; name: string; title: string; team: TeamId; role: RoleId; active: boolean };

export type Comment = { id: string; by: string; at: string; text: string };
export type TicketEvent = { at: string; by: string; text: string };

/** Who a waiting ticket is stuck on. A team always; a person when known. */
export type Waiting = { team: TeamId; person: string | null; reason: string; since: string };

export type Ticket = {
  id: string;
  number: number;
  title: string;
  description: string;
  kind: Kind;
  /** The team that owns the work. */
  team: TeamId;
  assignee: string | null;
  /** Who raised it, and from which team: cross-team requests are where delays hide. */
  requestedBy: string;
  requestingTeam: TeamId;
  status: Status;
  priority: Priority;
  /** YYYY-MM-DD, IST. */
  due: string | null;
  waiting: Waiting | null;
  dropped: boolean;
  comments: Comment[];
  events: TicketEvent[];
  createdAt: string;
  updatedAt: string;
  statusSince: string;
  doneAt: string | null;
  /** Bumped on every save, so two people saving at once cannot overwrite each other. */
  version: number;
  sample: boolean;
};

export const TEAMS: Team[] = [
  { id: "founders_office", name: "Founder's office", short: "Founder's office", colour: "#f472b6", about: "Priorities, reviews and anything that needs a founder." },
  { id: "product", name: "Product", short: "Product", colour: "#a78bfa", about: "The app, Shopify, tools and process." },
  { id: "marketing", name: "Marketing & category", short: "Marketing", colour: "#fb923c", about: "Campaigns, creatives, pricing and the product range." },
  { id: "sales", name: "Sales", short: "Sales", colour: "#47d7a0", about: "Hubs, POCs and customer deals." },
  { id: "support", name: "Customer support", short: "Support", colour: "#4fd6e0", about: "Calls customers, complaints, follow-ups." },
  { id: "operations", name: "Operations", short: "Ops", colour: "#70b5ff", about: "Inventory, procurement, dispatch and installation." },
  { id: "revops", name: "RevOps", short: "RevOps", colour: "#f4bd50", about: "Payments, refunds, invoices and finance checks." },
];

export const ROLES: Record<RoleId, { label: string; can: string }> = {
  founder: { label: "Founder", can: "Sees and changes everything." },
  admin: { label: "Admin", can: "Everything, plus the people list." },
  lead: { label: "Team lead", can: "Runs their team's tickets and the ones their team raised." },
  member: { label: "Member", can: "Raises tickets, works the ones given to them, picks up their team's unassigned ones." },
  viewer: { label: "Viewer", can: "Sees everything and comments. Cannot change tickets." },
};

export const STATUSES: Array<{ id: Status; label: string; hint: string }> = [
  { id: "new", label: "New", hint: "Raised, not picked up yet" },
  { id: "todo", label: "To do", hint: "Accepted, not started" },
  { id: "doing", label: "In progress", hint: "Someone is on it" },
  { id: "waiting", label: "Waiting", hint: "Stuck on another team or person" },
  { id: "done", label: "Done", hint: "Finished or dropped" },
];

export const PRIORITIES: Array<{ id: Priority; label: string; days: number }> = [
  { id: "urgent", label: "Urgent", days: 1 },
  { id: "high", label: "High", days: 3 },
  { id: "normal", label: "Normal", days: 7 },
  { id: "low", label: "Low", days: 14 },
];

export const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "task", label: "Task" },
  { id: "request", label: "Request" },
  { id: "issue", label: "Issue" },
  { id: "idea", label: "Idea" },
];

/** The starting team. Edit on the People page; this list is only used until someone saves it. */
export const DEFAULT_PEOPLE: Person[] = [
  { id: "gautama", name: "Gautama", title: "Founder", team: "founders_office", role: "founder", active: true },
  { id: "bhavya", name: "Bhavya Goyal", title: "Founder's office", team: "founders_office", role: "admin", active: true },
  { id: "saurav", name: "Saurav", title: "Product manager", team: "product", role: "lead", active: true },
  { id: "abhiman", name: "Abhiman", title: "Category", team: "marketing", role: "lead", active: true },
  { id: "piyush", name: "Piyush", title: "Inventory", team: "operations", role: "lead", active: true },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);
export const TEAM_IDS = TEAMS.map((t) => t.id);
export const PRIORITY_IDS = PRIORITIES.map((p) => p.id);
export const KIND_IDS = KINDS.map((k) => k.id);
export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export function teamOf(id: string | null | undefined): Team {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0];
}
export function statusLabel(id: Status): string {
  return STATUSES.find((s) => s.id === id)?.label ?? id;
}
export function priorityLabel(id: Priority): string {
  return PRIORITIES.find((p) => p.id === id)?.label ?? id;
}
