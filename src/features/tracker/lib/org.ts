import { MAX_LEVELS, type OrgNode } from "./model";

// The team chart: Founder → branches → people, never deeper than three levels.

export class OrgError extends Error {}

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];
export const FOUNDERS = { id: "founders", name: "Founders", colour: "#111827" };

export type Branch = { id: string; name: string; colour: string };

export const childrenOf = (org: OrgNode[], id: string | null) => org.filter((n) => n.parentId === id);

/** 1 for founders, 2 for branch heads, 3 for their people. */
export function levelOf(org: OrgNode[], id: string): number {
  let level = 1;
  let node = org.find((n) => n.id === id);
  while (node?.parentId) {
    level += 1;
    node = org.find((n) => n.id === node!.parentId);
    if (level > 10) break;
  }
  return level;
}

/** How many levels a node and everything under it take up (1 for a person with nobody under them). */
function heightOf(org: OrgNode[], id: string): number {
  const kids = childrenOf(org, id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(org, k.id))) : 0);
}

/** The branches, in chart order, each with a steady colour. */
export function branches(org: OrgNode[]): Branch[] {
  const heads = org.filter((n) => n.parentId && levelOf(org, n.id) === 2);
  return heads.map((h, i) => ({ id: h.id, name: h.branch?.trim() || h.title || h.name, colour: COLOURS[i % COLOURS.length] }));
}

/** The branch someone works in. Founders sit above the branches. */
export function branchOf(org: OrgNode[], personId: string | null | undefined): Branch | null {
  if (!personId) return null;
  const level = levelOf(org, personId);
  if (level === 1) return FOUNDERS;
  const head = level === 2 ? personId : org.find((n) => n.id === personId)?.parentId;
  return branches(org).find((b) => b.id === head) ?? null;
}

/** Everyone in a branch: the head and their people. */
export function branchMembers(org: OrgNode[], branchId: string): string[] {
  if (branchId === FOUNDERS.id) return org.filter((n) => !n.parentId).map((n) => n.id);
  return [branchId, ...childrenOf(org, branchId).map((n) => n.id)];
}

export function isAdmin(org: OrgNode[], personId: string): boolean {
  const n = org.find((x) => x.id === personId);
  return Boolean(n && (!n.parentId || n.admin));
}

export function canAddUnder(org: OrgNode[], parentId: string | null): boolean {
  return parentId === null || levelOf(org, parentId) < MAX_LEVELS;
}

function slug(name: string, org: OrgNode[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "person";
  let id = base;
  for (let i = 2; org.some((n) => n.id === id); i += 1) id = `${base}_${i}`;
  return id;
}

export function addPerson(org: OrgNode[], input: { name: string; title: string; parentId: string | null; branch?: string }): OrgNode[] {
  const name = input.name.trim();
  if (!name) throw new OrgError("Write a name.");
  if (input.parentId && !org.some((n) => n.id === input.parentId)) throw new OrgError("That manager is not on the chart.");
  if (!canAddUnder(org, input.parentId)) throw new OrgError(`The chart has ${MAX_LEVELS} levels at most. Add them under a branch head instead.`);
  const node: OrgNode = { id: slug(name, org), name, title: input.title.trim(), parentId: input.parentId };
  if (input.parentId && levelOf(org, input.parentId) === 1) node.branch = input.branch?.trim() || input.title.trim() || name;
  return [...org, node];
}

export function updatePerson(org: OrgNode[], id: string, patch: Partial<Pick<OrgNode, "name" | "title" | "branch" | "admin">>): OrgNode[] {
  if (patch.name !== undefined && !patch.name.trim()) throw new OrgError("A name cannot be empty.");
  return org.map((n) => (n.id === id ? { ...n, ...patch, name: patch.name?.trim() ?? n.name, title: patch.title?.trim() ?? n.title } : n));
}

/** Move someone (and the people under them) to a new manager. Never deeper than three levels, never under themselves. */
export function movePerson(org: OrgNode[], id: string, parentId: string | null): OrgNode[] {
  if (id === parentId) throw new OrgError("Someone cannot report to themselves.");
  for (let p = parentId; p; p = org.find((n) => n.id === p)?.parentId ?? null) {
    if (p === id) throw new OrgError("Someone cannot report to a person under them.");
  }
  const newLevel = parentId ? levelOf(org, parentId) + 1 : 1;
  if (newLevel + heightOf(org, id) - 1 > MAX_LEVELS) throw new OrgError(`That would make the chart deeper than ${MAX_LEVELS} levels.`);
  return org.map((n) => {
    if (n.id !== id) return n;
    const next: OrgNode = { ...n, parentId };
    // A new branch head gets a branch name; someone leaving level 2 no longer heads one.
    if (newLevel === 2) next.branch = n.branch || n.title || n.name;
    else delete next.branch;
    return next;
  });
}

/** Removes a person with nobody under them. Their open tickets become unassigned (done by the caller). */
export function removePerson(org: OrgNode[], id: string): OrgNode[] {
  if (childrenOf(org, id).length) throw new OrgError("Move or remove the people under them first.");
  if (!org.find((n) => n.id === id)?.parentId && org.filter((n) => !n.parentId).length === 1) throw new OrgError("The chart needs at least one founder.");
  return org.filter((n) => n.id !== id);
}
