// The three roles of the simple dashboard: Sales, Inventory, Admin. For now anyone inside the site (it still needs
// the dashboard access code) picks a role with the switch at the top; a personal code (Settings → Team roles) fixes
// it to that person's role. Pages, menus and every button check the role on the server, so a real login can replace
// the switch later without changing anything else. Pure (no "server-only"): the proxy, layout and tests use it.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@/lib/ops/types";

export const APP_ROLES = ["sales", "inventory", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = { sales: "Sales", inventory: "Inventory", admin: "Admin" };

/** Where each role starts. */
export const APP_ROLE_HOME: Record<AppRole, string> = { sales: "/sales", inventory: "/logistics", admin: "/post-sales" };

export const ROLE_COOKIE = "epik_role";

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** The service roles each role carries (what `canAct` checks in service.ts). */
export function serviceRolesFor(role: AppRole): Role[] {
  if (role === "admin") return ["admin"];
  if (role === "inventory") return ["inventory", "logistics", "procurement", "installation"];
  return ["sales"];
}

/** A Team roles person's role in the simple dashboard. */
export function appRoleForPerson(roles: Role[]): AppRole {
  if (roles.includes("admin")) return "admin";
  if (roles.some((r) => r === "inventory" || r === "logistics" || r === "procurement" || r === "installation")) return "inventory";
  return "sales";
}

// ── Signed role cookie (set only by the server, so a page can't fake a role) ──

const sign = (secret: string, role: string) => createHmac("sha256", secret).update(`epik-app-role:${role}`).digest("hex").slice(0, 32);

export function roleCookieValue(secret: string, role: AppRole): string {
  return `${role}.${sign(secret, role)}`;
}

export function roleFromCookie(secret: string, cookie: string | undefined): AppRole | null {
  if (!cookie) return null;
  const [role, mac] = cookie.split(".");
  if (!isAppRole(role) || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(secret, role));
  return a.length === b.length && timingSafeEqual(a, b) ? role : null;
}

// ── Which pages each role may open ───────────────────────────────────────────
// Everyone on the team can see every post-sales area (read). The role decides what they can change: every button
// checks it on the server. Settings, setup and the older RevOps/overview screens stay Admin only.

/** An order page (/orders/EPK-000123), not the list, the new-sale form or the detailed view. */
const ORDER_PAGE = /^\/orders\/(?!new(\/|$))[^/]+$/;

/** Post-sales pages every role may open. */
const TEAM_PAGES = ["/post-sales", "/sales", "/orders/new", "/logistics", "/inventory", "/procurement", "/dispatch", "/installations"];

export function pathAllowed(role: AppRole, path: string): boolean {
  if (role === "admin") return true;
  if (path === "/access" || path === "/" || path === "/orders" || ORDER_PAGE.test(path)) return true;
  return TEAM_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
}

export type MenuLink = { href: string; label: string; icon: string };

/** The post-sales areas: the cards on /post-sales and the menu's "All areas". */
export const POST_SALES_AREAS: Array<MenuLink & { description: string; who: string }> = [
  { href: "/sales", label: "Sales and payment", icon: "store", description: "Book a sale, see every sale with its payment and status.", who: "Sales" },
  { href: "/logistics", label: "Order view", icon: "decide", description: "Each new order: set NEW, CONFIRMED, EPIK_OFD and the rest.", who: "Inventory" },
  { href: "/inventory", label: "Inventory view", icon: "boxes", description: "Current stock, incoming goods and purchase orders.", who: "Inventory" },
  { href: "/dispatch", label: "Logistics and installation", icon: "truck", description: "What goes out today, what's on the road, installations due.", who: "Inventory" },
];

/** The menu: the role's own pages first, every post-sales area for everyone, and Admin's setup screens under More. */
export function menuFor(role: AppRole): { main: MenuLink[]; areas: MenuLink[]; more: MenuLink[] } {
  const areas: MenuLink[] = POST_SALES_AREAS.map(({ href, label, icon }) => ({ href, label, icon }));
  const main: MenuLink[] =
    role === "sales"
      ? [{ href: "/sales", label: "My sales", icon: "store" }, { href: "/orders/new", label: "New sale", icon: "plus" }]
      : role === "inventory"
        ? [{ href: "/logistics", label: "Update status", icon: "decide" }]
        : [{ href: "/post-sales", label: "Post-sales home", icon: "layout" }, { href: "/orders/new", label: "New sale", icon: "plus" }, { href: "/orders?stage=all", label: "All orders", icon: "list" }];
  const more: MenuLink[] =
    role === "admin"
      ? [
          { href: "/ops", label: "Overview", icon: "layout" },
          { href: "/revops", label: "Payment review", icon: "rupee" },
          { href: "/briefing", label: "Daily briefing", icon: "sun" },
          { href: "/system", label: "System", icon: "gauge" },
          { href: "/settings", label: "Settings", icon: "settings" },
        ]
      : [];
  return { main, areas, more };
}
