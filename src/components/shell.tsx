"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  BadgeIndianRupee,
  Boxes,
  ClipboardPlus,
  Contact,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Menu,
  MessagesSquare,
  PanelLeft,
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
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const modeText = health.modeLabel === "Demo" ? "Demo" : health.source === "live" ? "Live" : "Setup";
  const modeClass = health.modeLabel === "Demo" ? "text-[#f4bd50]" : health.source === "live" ? "text-[#47d7a0]" : "text-[#ff6978]";
  const workspace = health.modeLabel === "Demo" ? "Demo workspace" : health.source === "live" ? "Live workspace" : "Setup incomplete";

  return (
    <LiveProvider mode={mode}>
      <ActionToastProvider>
      <div className="app-shell">
        <div className={`app-layout ${collapsed ? "is-collapsed" : ""}`}>
          {open ? <button type="button" className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
          <aside className={`app-sidebar ${open ? "is-open" : ""}`}>
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
              <Link href="/" className="min-w-0" aria-label="EPIK Operations" onClick={() => setOpen(false)}>
                <span className="font-serif text-[18px] leading-none tracking-[-0.04em] text-ink">epik</span>
                <span className="brand-copy mt-1 block text-[10px] leading-3 tracking-[0.02em] text-faint">Operations</span>
              </Link>
              <button type="button" className="md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Main">
              {NAV.map((item) => (
                <NavItem key={item.href} item={item} current={active(path, item.href)} onNavigate={() => setOpen(false)} />
              ))}
              <p className="nav-label mt-3 mb-1 px-2.5 text-[10px] tracking-[0.08em] text-faint uppercase">More</p>
              {MORE.map((item) => (
                <NavItem key={item.href} item={item} current={active(path, item.href)} onNavigate={() => setOpen(false)} />
              ))}
            </nav>
            <div className="mt-auto px-3 py-3">
              <p className="brand-copy text-[11px] text-faint">{workspace}</p>
              <button type="button" className="nav-link mt-1 hidden w-full md:flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((value) => !value)}>
                <PanelLeft size={16} />
                <span className="nav-label">Collapse</span>
              </button>
            </div>
          </aside>
          <main className="app-main">
            <div className="app-topbar">
              <button type="button" className="mr-auto flex size-8 items-center justify-center rounded-[10px] border border-line md:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
                <Menu size={16} />
              </button>
              <ActorControl name={actorName} />
              <span className={`text-[11px] tracking-[0.08em] uppercase ${modeClass}`}>{modeText}</span>
              {health.facts && health.facts.failedCount > 0 ? (
                <Link href="/exceptions" className="text-[12px] text-warn">{health.facts.failedCount} failed</Link>
              ) : null}
              <Link href="/settings" aria-label="Settings" title="Settings" className="hidden sm:inline"><Settings size={15} /></Link>
              <span className="hidden items-center gap-2.5 sm:flex"><ConnectionStatus /></span>
            </div>
            {mode === "demo" && path !== "/" ? <DemoNotice /> : null}
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
      <Icon size={16} strokeWidth={1.7} />
      <span className="nav-label truncate">{item.label}</span>
    </Link>
  );
}
