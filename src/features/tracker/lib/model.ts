// Team Tracker: the data model. No imports from the rest of the app, so this folder can move to its own project.
//
// Kept small on purpose: a ticket is what, who and by when. The team chart says who is in which branch,
// so nobody picks a team on a ticket.

export type Status = "todo" | "doing" | "done";

/** One person on the team chart. Level 1 has no parent (founders); level 2 heads a branch; level 3 works in it. */
export type OrgNode = {
  id: string;
  name: string;
  title: string;
  parentId: string | null;
  /** Branch name, set on level 2 (e.g. "Operations"). Level 3 people belong to their head's branch. */
  branch?: string;
  /** Can change any ticket and the team chart. Founders always can. */
  admin?: boolean;
};

export type Comment = { id: string; by: string; at: string; text: string };
export type HistoryLine = { at: string; by: string; text: string };

/** Stuck on someone: who and why. */
export type Blocked = { by: string; reason: string; since: string };

export type Ticket = {
  id: string;
  number: number;
  title: string;
  note: string;
  assignee: string | null;
  /** YYYY-MM-DD, IST. */
  due: string | null;
  status: Status;
  blocked: Blocked | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  comments: Comment[];
  history: HistoryLine[];
};

export const STATUSES: Array<{ id: Status; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

export const MAX_LEVELS = 3;

/** The starting chart. Edit it on the Team screen; this is only used until someone saves a change. */
export const DEFAULT_ORG: OrgNode[] = [
  { id: "gautama", name: "Gautama", title: "Founder", parentId: null },
  { id: "bhavya", name: "Bhavya Goyal", title: "Founder's office", parentId: "gautama", branch: "Founder's office", admin: true },
  { id: "saurav", name: "Saurav", title: "Product manager", parentId: "gautama", branch: "Product" },
  { id: "abhiman", name: "Abhiman", title: "Category", parentId: "gautama", branch: "Marketing & category" },
  { id: "piyush", name: "Piyush", title: "Inventory", parentId: "gautama", branch: "Operations" },
];

export function statusLabel(id: Status): string {
  return STATUSES.find((s) => s.id === id)?.label ?? id;
}
