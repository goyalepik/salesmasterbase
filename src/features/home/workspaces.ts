// The tiles on the EPIK home. Each workspace says which roles may open it; until personal logins exist, everyone sees every tile.

export type HomeRole = "founder" | "admin" | "sales" | "revops" | "inventory" | "logistics" | "support" | "marketing";

export type Workspace = {
  id: "ops" | "tracker" | "support" | "assistant" | "admin";
  title: string;
  description: string;
  href: string;
  roles: HomeRole[] | "everyone";
};

export const WORKSPACES: Workspace[] = [
  { id: "ops", title: "Post-sales Ops", description: "Orders from sale to installation.", href: "/ops", roles: ["founder", "admin", "sales", "revops", "inventory", "logistics"] },
  { id: "tracker", title: "Team Tracker", description: "Every team's work, and what is stuck.", href: "/tracker", roles: "everyone" },
  // The CX ticketing pilot, shown only when NEXT_PUBLIC_CX_PILOT=true.
  ...(process.env.NEXT_PUBLIC_CX_PILOT === "true" ? [{ id: "support" as const, title: "EPIK Support", description: "Every customer message as a ticket, with SLAs. Pilot.", href: "/cx", roles: "everyone" as const }] : []),
  { id: "assistant", title: "Ask EPIK", description: "Questions about orders, stock and payments.", href: "/assistant", roles: "everyone" },
  { id: "admin", title: "Access Admin", description: "Team roles and setup.", href: "/settings", roles: ["founder", "admin"] },
];

export function canSee(workspace: Workspace, role: HomeRole | null): boolean {
  if (!role || workspace.roles === "everyone") return true;
  return workspace.roles.includes(role);
}
