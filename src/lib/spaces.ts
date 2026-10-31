// Department spaces. Each team works in its own space; the AI and order pages are shared.
// No server-only imports: the shell (client) and the layout (server) both read this.

export type SpaceId = "command" | "sales" | "payments" | "inventory" | "delivery";

export type SpaceLink = { href: string; label: string; icon: string };

export type Space = {
  id: SpaceId;
  name: string;
  short: string;
  welcome: string;
  tagline: string;
  colour: string;
  icon: string;
  home: string;
  links: SpaceLink[];
};

export const SPACES: Space[] = [
  {
    id: "command",
    name: "Command Deck",
    short: "Command",
    welcome: "Welcome to the EPIK Command Deck",
    tagline: "The whole business, at a glance.",
    colour: "#3b82f6",
    icon: "gauge",
    home: "/",
    links: [
      { href: "/", label: "Overview", icon: "layout" },
      { href: "/orders", label: "All orders", icon: "list" },
      { href: "/briefing", label: "Daily briefing", icon: "sun" },
    ],
  },
  {
    id: "sales",
    name: "Sales Lounge",
    short: "Sales",
    welcome: "Welcome to the EPIK Sales Lounge",
    tagline: "Book the sale. We take it from here.",
    colour: "#47d7a0",
    icon: "store",
    home: "/sales",
    links: [
      { href: "/sales", label: "Lounge", icon: "store" },
      { href: "/orders/new", label: "New sale", icon: "plus" },
      { href: "/orders?stage=on_hold", label: "Sent back", icon: "pause" },
    ],
  },
  {
    id: "payments",
    name: "Payments Desk",
    short: "Payments",
    welcome: "Welcome to the EPIK Payments Desk",
    tagline: "Match every rupee to the bank.",
    colour: "#f4bd50",
    icon: "rupee",
    home: "/revops",
    links: [{ href: "/revops", label: "Payment checks", icon: "rupee" }],
  },
  {
    id: "inventory",
    name: "Inventory Lounge",
    short: "Inventory",
    welcome: "Welcome to the EPIK Inventory Lounge",
    tagline: "Every unit, in the right hands.",
    colour: "#a78bfa",
    icon: "boxes",
    home: "/inventory",
    links: [
      { href: "/inventory", label: "Overview", icon: "layout" },
      { href: "/inventory/decisions", label: "Decisions", icon: "decide" },
      { href: "/procurement", label: "Procurement", icon: "cart" },
    ],
  },
  {
    id: "delivery",
    name: "Delivery Hub",
    short: "Delivery",
    welcome: "Welcome to the EPIK Delivery Hub",
    tagline: "Out the door, into homes, installed.",
    colour: "#4fd6e0",
    icon: "truck",
    home: "/dispatch",
    links: [
      { href: "/dispatch", label: "Dispatch", icon: "truck" },
      { href: "/installations", label: "Installations", icon: "wrench" },
    ],
  },
];

export const SPACE_COOKIE = "epik_space";

export function spaceById(id: string | null | undefined): Space {
  return SPACES.find((space) => space.id === id) ?? SPACES[0];
}

/** The space a page belongs to. Null for shared pages (orders, assistant, settings), which keep the current space. */
export function spaceForPath(path: string): SpaceId | null {
  if (path === "/" || path.startsWith("/briefing")) return "command";
  if (path.startsWith("/sales") || path.startsWith("/orders/new")) return "sales";
  if (path.startsWith("/revops")) return "payments";
  if (path.startsWith("/inventory") || path.startsWith("/procurement")) return "inventory";
  if (path.startsWith("/dispatch") || path.startsWith("/installations")) return "delivery";
  return null;
}
