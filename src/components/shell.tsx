"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BadgeIndianRupee,
  Bell,
  Boxes,
  ClipboardPlus,
  Contact,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Menu,
  MessagesSquare,
  ScrollText,
  Settings,
  ShoppingCart,
  Store,
  SunMedium,
  TableProperties,
  TriangleAlert,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { ConnectionStatus, LiveProvider } from "@/components/live-provider";
import { ActorControl } from "@/components/ops/actor-control";
import { ActionToastProvider } from "@/components/ops/action-form";
import { avatarStyle, initials } from "@/components/avatar";
import { DemoNotice } from "@/components/ui";
import type { HealthReport } from "@/lib/health";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/orders/new", label: "New order", icon: ClipboardPlus },
  { href: "/orders", label: "Orders", icon: ListOrdered },
  { href: "/revops", label: "RevOps", icon: BadgeIndianRupee },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/procurement", label: "Procurement", icon: ShoppingCart },
  { href: "/dispatch", label: "Dispatch", icon: Truck },
  { href: "/installations", label: "Installations", icon: Wrench },
  { href: "/poc", label: "POC", icon: Store },
  { href: "/customers", label: "Customers", icon: Contact },
  { href: "/assistant", label: "AI Assistant", icon: MessagesSquare },
];

const MORE = [
  { href: "/inbox", label: "Slack inbox", icon: Inbox },
  { href: "/records", label: "Sales Records", icon: TableProperties },
  { href: "/contributors", label: "Salespeople", icon: Users },
  { href: "/exceptions", label: "Exceptions", icon: TriangleAlert },
  { href: "/activity", label: "Activity Log", icon: ScrollText },
  { href: "/briefing", label: "Briefing", icon: SunMedium },
  { href: "/settings", label: "Settings", icon: Settings },
];

function active(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  // "/orders/new" has its own entry, so "Orders" should not light up there.
  if (href === "/orders" && path.startsWith("/orders/new")) return false;
  return path === href || path.startsWith(`${href}/`);
}

export function Shell({
  path,
  mode,
  health,
  actorName,
  children,
}: {
  path: string;
  mode: "demo" | "live" | "blocked";
  health: HealthReport;
  actorName: string;
  children: ReactNode;
}) {
  // The root layout does not re-render on client navigation, so the server-sent path goes stale.
  const current = usePathname() ?? path;
  const [open, setOpen] = useState(false);
  const modeText = health.modeLabel === "Demo" ? "Demo mode" : health.source === "live" ? "Live" : "Setup";
  const modeClass = health.modeLabel === "Demo" ? "is-demo" : health.source === "live" ? "is-live" : "is-setup";
  const failed = health.facts?.failedCount ?? 0;
  const workspace = health.modeLabel === "Demo" ? "Demo workspace" : health.source === "live" ? "Live workspace" : "Setup incomplete";

  return (
    <LiveProvider mode={mode}>
      <ActionToastProvider>
      <div className="app-shell">
        <div className="app-layout">
          {open ? <button type="button" className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
          {/* A slim icon rail that opens over the page on hover, so the content keeps its width. */}
          <aside className={`app-sidebar ${open ? "is-open" : ""}`}>
            <div className="sidebar-brand">
              <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="EPIK Operations" onClick={() => setOpen(false)}>
                <span className="brand-mark" aria-hidden="true">e</span>
                <span className="nav-label min-w-0">
                  <span className="block text-[17px] leading-none font-bold tracking-[-0.04em] text-ink">epik</span>
                  <span className="mt-1 block text-[11px] leading-none text-faint">Operations</span>
                </span>
              </Link>
              <button type="button" className="md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <nav className="sidebar-nav" aria-label="Main">
              {NAV.map((item) => (
                <NavItem key={item.href} item={item} current={active(current, item.href)} onNavigate={() => setOpen(false)} />
              ))}
              <p className="nav-section nav-label">More</p>
              <span className="nav-divider" aria-hidden="true" />
              {MORE.map((item) => (
                <NavItem key={item.href} item={item} current={active(current, item.href)} onNavigate={() => setOpen(false)} />
              ))}
            </nav>
            <div className="sidebar-user">
              <span className="avatar size-8 text-[12px]" style={avatarStyle(actorName)}>{initials(actorName)}</span>
              <span className="nav-label min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{actorName}</span>
                <span className="block truncate text-[11px] text-faint">{workspace}</span>
              </span>
            </div>
          </aside>
          <main className="app-main">
            <div className="app-topbar">
              <button type="button" className="mr-auto flex size-9 items-center justify-center rounded-[12px] border border-line bg-white/5 md:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
                <Menu size={16} />
              </button>
              <span className="hidden items-center gap-3 text-[12px] text-muted 2xl:flex"><ConnectionStatus /></span>
              <span className={`mode-pill ${modeClass}`}><span className="mode-dot" />{modeText}</span>
              <Link href="/exceptions" className="topbar-icon" aria-label={failed ? `${failed} failed messages` : "Exceptions"} title={failed ? `${failed} failed` : "Exceptions"}>
                <Bell size={17} />
                {failed ? <span className="topbar-dot" /> : null}
              </Link>
              <ActorControl name={actorName} />
            </div>
            {mode === "demo" && current !== "/" ? <DemoNotice /> : null}
            {children}
          </main>
        </div>
      </div>
      </ActionToastProvider>
    </LiveProvider>
  );
}

function NavItem({ item, current, onNavigate }: { item: (typeof NAV)[number]; current: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} title={item.label} aria-label={item.label} aria-current={current ? "page" : undefined} className="nav-link" onClick={onNavigate}>
      <Icon size={18} strokeWidth={1.8} className="shrink-0" />
      <span className="nav-label truncate">{item.label}</span>
    </Link>
  );
}
