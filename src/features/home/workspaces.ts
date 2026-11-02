// The tiles on the EPIK home. Each workspace says which roles may open it; until personal logins exist, everyone sees every tile.

export type HomeRole = "founder" | "admin" | "sales" | "revops" | "inventory" | "logistics" | "support" | "marketing";

export type Workspace = {
  id: "ops" | "tracker" | "assistant" | "admin";
  title: string;
  description: string;
  href: string;
  roles: HomeRole[] | "everyone";
};

export const WORKSPACES: Workspace[] = [
  { id: "ops", title: "Post-sales Ops", description: "Every order from sale to installation: payments, stock, dispatch and delivery.", href: "/ops", roles: ["founder", "admin", "sales", "revops", "inventory", "logistics"] },
  { id: "tracker", title: "Team Tracker", description: "Every team's work on one board: what is late, and who is waiting on whom.", href: "/tracker", roles: "everyone" },
  { id: "assistant", title: "Ask EPIK", description: "Ask anything about orders, stock, payments and deliveries in plain words.", href: "/assistant", roles: "everyone" },
  { id: "admin", title: "Access Admin", description: "Team roles, Slack setup and who can do what.", href: "/settings", roles: ["founder", "admin"] },
];

/** Shortcuts into the parts of Post-sales Ops people open most. */
export const SHORTCUTS = [
  { label: "New sale", href: "/orders/new" },
  { label: "Payments", href: "/revops" },
  { label: "Inventory", href: "/inventory" },
  { label: "Dispatch", href: "/dispatch" },
  { label: "Installations", href: "/installations" },
  { label: "All orders", href: "/orders" },
];

export const COMING = [
  { title: "Shopify sync", description: "The #PIK order is created by itself when a sale is made." },
  { title: "Finance exports", description: "Tally-ready sales, purchases and stock value." },
  { title: "Customer updates", description: "WhatsApp messages on dispatch and delivery." },
];

export function canSee(workspace: Workspace, role: HomeRole | null): boolean {
  if (!role || workspace.roles === "everyone") return true;
  return workspace.roles.includes(role);
}
