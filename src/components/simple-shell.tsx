"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Menu, Settings, X, type LucideIcon } from "lucide-react";
import { setRoleAction } from "@/app/actions/ops";
import { AskDrawer } from "@/components/ask-drawer";
import { LiveProvider, RefreshOnOrderChange } from "@/components/live-provider";
import { ActionToastProvider } from "@/components/ops/action-form";
import { ActorControl } from "@/components/ops/actor-control";
import { ICONS } from "@/components/shell";
import { EpikLogo } from "@/features/brand/epik-logo";
import type { AssistantStatus } from "@/lib/ai/runtime";
import { APP_ROLE_LABELS, APP_ROLES, menuFor, type AppRole, type MenuLink } from "@/lib/app-roles";
import type { HealthReport } from "@/lib/health";

const ICON_FOR: Record<string, LucideIcon> = { ...ICONS, settings: Settings };

function isActive(path: string, href: string): boolean {
  const base = href.split("?")[0];
  if (base === "/orders" && path.startsWith("/orders/")) return false;
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The simple dashboard frame: a top bar (menu, logo, role, name) and a short menu for the role. Sales and Inventory
 * see only their own pages; Admin also gets the older detailed screens under More.
 */
export function SimpleShell({
  path,
  mode,
  health,
  actorName,
  role,
  canSwitchRole,
  signedIn,
  assistant,
  statusLink,
  children,
}: {
  path: string;
  mode: "demo" | "live" | "blocked";
  health: HealthReport;
  actorName: string;
  role: AppRole;
  canSwitchRole: boolean;
  signedIn: "admin" | "person";
  assistant: AssistantStatus;
  statusLink: string | null;
  children: ReactNode;
}) {
  const current = usePathname() ?? path;
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(() => menuFor(role).more.some((l) => isActive(path, l.href)));
  const menu = menuFor(role);
  const modeText = health.modeLabel === "Demo" ? "Demo" : health.source === "live" ? "Live" : "Setup";
  const modeClass = health.modeLabel === "Demo" ? "is-demo" : health.source === "live" ? "is-live" : "is-setup";

  // Close the menu after a page change.
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const item = (link: MenuLink) => {
    const Icon = ICON_FOR[link.icon] ?? ICONS.list;
    return (
      <Link key={link.href} href={link.href} className="s-menu-link" aria-current={isActive(current, link.href) ? "page" : undefined}>
        <Icon size={18} strokeWidth={1.8} />
        <span>{link.label}</span>
      </Link>
    );
  };

  return (
    <LiveProvider mode={mode}>
      <ActionToastProvider>
        <div className="s-shell">
          <header className="s-top">
            <button type="button" className="s-icon-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
              <Menu size={18} />
            </button>
            {/* The EPIK home has its own layout, so this is a full page load. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="s-logo" aria-label="EPIK home">
              <EpikLogo height={22} className="text-ink" />
            </a>
            <span className="flex-1" />
            <span className={`mode-pill ${modeClass} s-mode`}><span className="mode-dot" /><span className="hidden sm:inline">{modeText}</span></span>
            <RoleSwitch role={role} canSwitch={canSwitchRole} className="s-role-top" />
            <ActorControl name={actorName} signedIn={signedIn} />
          </header>

          {open ? <button type="button" className="s-scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
          <nav className={`s-drawer ${open ? "is-open" : ""}`} aria-label="Menu" aria-hidden={!open}>
            <div className="s-drawer-head">
              <EpikLogo height={22} className="text-ink" />
              <button type="button" className="s-icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <RoleSwitch role={role} canSwitch={canSwitchRole} className="s-role-drawer" />
            <div className="s-menu">{menu.main.map(item)}</div>
            <div className="s-menu s-menu-more">
              <p className="s-menu-label">All areas</p>
              {menu.areas.filter((a) => !menu.main.some((m) => m.href === a.href)).map(item)}
              {statusLink ? (
                <a href={`${statusLink}?view=people`} target="_blank" rel="noreferrer" className="s-menu-link">
                  <ExternalLink size={18} strokeWidth={1.8} />
                  <span>Salespeople&apos;s orders</span>
                </a>
              ) : null}
            </div>
            {menu.more.length ? (
              <div className="s-menu s-menu-more">
                <button type="button" className="s-more-toggle" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
                  More <ChevronDown size={15} className={showMore ? "rotate-180" : ""} />
                </button>
                {showMore ? menu.more.map(item) : null}
              </div>
            ) : null}
          </nav>

          <main className="s-main">{children}</main>
          {role === "admin" && !current.startsWith("/assistant") ? <AskDrawer status={assistant} /> : null}
          {mode === "live" ? <RefreshOnOrderChange /> : null}
        </div>
      </ActionToastProvider>
    </LiveProvider>
  );
}

function RoleSwitch({ role, canSwitch, className }: { role: AppRole; canSwitch: boolean; className: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useState(role);
  if (!canSwitch) return <span className={`role-chip ${className}`}>{APP_ROLE_LABELS[role]}</span>;
  return (
    <div className={`role-switch ${className}`} role="radiogroup" aria-label="Role">
      {APP_ROLES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={shown === r}
          disabled={pending}
          onClick={() => {
            if (r === shown) return;
            setShown(r);
            start(async () => {
              const result = await setRoleAction(r);
              if (!result.ok) {
                setShown(role);
                return;
              }
              router.push(result.home ?? "/");
              router.refresh();
            });
          }}
        >
          {APP_ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}
