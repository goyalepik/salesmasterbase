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
export const APP_ROLE_HOME: Record<AppRole, string> = { sales: "/sales", inventory: "/logistics", admin: "/sales" };

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

/** An order page (/orders/EPK-000123), not the list or the new-sale form. */
const ORDER_PAGE = /^\/orders\/(?!new(\/|$))[^/]+$/;

/** Pages anyone inside may open (sign-in, the EPIK home, an order). */
function shared(path: string): boolean {
  return path === "/access" || path === "/" || ORDER_PAGE.test(path);
}

export function pathAllowed(role: AppRole, path: string): boolean {
  if (role === "admin" || shared(path)) return true;
  if (role === "sales") return path === "/sales" || path.startsWith("/sales/") || path === "/orders/new";
  return path === "/logistics" || path.startsWith("/logistics/");
}

export type MenuLink = { href: string; label: string; icon: string };

/** The menu for each role. Admin also gets the full set of older screens under More. */
export function menuFor(role: AppRole): { main: MenuLink[]; more: MenuLink[] } {
  const sales: MenuLink[] = [
    { href: "/sales", label: "My sales", icon: "store" },
    { href: "/orders/new", label: "New sale", icon: "plus" },
  ];
  const inventory: MenuLink[] = [{ href: "/logistics", label: "Update status", icon: "decide" }];
  if (role === "sales") return { main: sales, more: [] };
  if (role === "inventory") return { main: inventory, more: [] };
  return {
    main: [...sales, ...inventory, { href: "/orders?stage=all", label: "All orders", icon: "list" }],
    more: [
      { href: "/ops", label: "Overview", icon: "layout" },
      { href: "/revops", label: "Payment review", icon: "rupee" },
      { href: "/inventory", label: "Inventory and stock", icon: "boxes" },
      { href: "/procurement", label: "Purchase orders", icon: "cart" },
      { href: "/dispatch", label: "Dispatch", icon: "truck" },
      { href: "/installations", label: "Installations", icon: "wrench" },
      { href: "/briefing", label: "Daily briefing", icon: "sun" },
      { href: "/system", label: "System", icon: "gauge" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  };
}
