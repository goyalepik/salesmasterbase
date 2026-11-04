// The cards on the EPIK home. Each workspace says which roles may open it; until personal logins exist, everyone sees every card.

export type HomeRole = "founder" | "admin" | "sales" | "revops" | "inventory" | "logistics" | "support" | "marketing";

export type Workspace = {
  id: "ops" | "tracker" | "support" | "assistant" | "admin";
  title: string;
  description: string;
  /** Shown when you hover the card: what you can do there, three short lines. */
  brief: [string, string, string];
  /** The card's colour. */
  accent: string;
  href: string;
  roles: HomeRole[] | "everyone";
};

export const WORKSPACES: Workspace[] = [
  {
    id: "ops",
    title: "Post-sales Ops",
    description: "Orders from sale to installation.",
    brief: ["Check payment, send to inventory", "Reserve stock, dispatch, deliver", "Installations due after delivery"],
    accent: "#00239b",
    href: "/ops",
    roles: ["founder", "admin", "sales", "revops", "inventory", "logistics"],
  },
  {
    id: "tracker",
    title: "Team Tracker",
    description: "Every team's work, and what is stuck.",
    brief: ["What, who and by when", "See what is late or blocked", "Edit the team chart"],
    accent: "#0f8a6a",
    href: "/tracker",
    roles: "everyone",
  },
  // The CX ticketing pilot, shown only when NEXT_PUBLIC_CX_PILOT=true.
  ...(process.env.NEXT_PUBLIC_CX_PILOT === "true"
    ? [{
        id: "support" as const,
        title: "EPIK Support",
        description: "Every customer message as a ticket, with SLAs.",
        brief: ["Messages become tickets", "SLA timers and routing", "One view per customer"] as Workspace["brief"],
        accent: "#6d3fd8",
        href: "/cx",
        roles: "everyone" as const,
      }]
    : []),
  {
    id: "assistant",
    title: "Ask EPIK",
    description: "Questions about orders, stock and payments.",
    brief: ["Ask in plain words", "Answers from live orders and stock", "A daily briefing"],
    accent: "#b7791f",
    href: "/assistant",
    roles: "everyone",
  },
  {
    id: "admin",
    title: "Access Admin",
    description: "Team roles and setup.",
    brief: ["Add people and their roles", "Post the Slack New sale button", "Connections and setup"],
    accent: "#475569",
    href: "/settings",
    roles: ["founder", "admin"],
  },
];

/** Workspaces we plan to add. Shown as a quiet "coming soon" card so the grid has room to grow. */
export const COMING_SOON = ["Shopify orders", "Finance exports", "Returns"];

export function canSee(workspace: Workspace, role: HomeRole | null): boolean {
  if (!role || workspace.roles === "everyone") return true;
  return workspace.roles.includes(role);
}
