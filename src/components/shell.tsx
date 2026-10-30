"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BadgeIndianRupee,
  Boxes,
  ClipboardPlus,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Menu,
  PauseCircle,
  Settings,
  ShoppingCart,
  Store,
  SunMedium,
  Truck,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { AskDrawer } from "@/components/ask-drawer";
import { avatarStyle, initials } from "@/components/avatar";
import { LiveProvider } from "@/components/live-provider";
import { ActorControl } from "@/components/ops/actor-control";
import { ActionToastProvider } from "@/components/ops/action-form";
import { SpaceTransition } from "@/components/space-transition";
import type { AssistantStatus } from "@/lib/ai/runtime";
import type { HealthReport } from "@/lib/health";
import { SPACE_COOKIE, SPACES, spaceById, spaceForPath, type Space, type SpaceId } from "@/lib/spaces";

export const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  layout: LayoutDashboard,
  list: ListOrdered,
  sun: SunMedium,
  store: Store,
  plus: ClipboardPlus,
  pause: PauseCircle,
  rupee: BadgeIndianRupee,
  boxes: Boxes,
  cart: ShoppingCart,
  truck: Truck,
  wrench: Wrench,
};

function active(path: string, href: string): boolean {
  const base = href.split("?")[0];
  if (base === "/") return path === "/";
  // "/orders/new" has its own entry, so "All orders" should not light up there.
  if (base === "/orders" && path.startsWith("/orders/new")) return false;
  return path === base || path.startsWith(`${base}/`);
}

function rememberSpace(id: SpaceId) {
  document.cookie = `${SPACE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}

export function Shell({
  path,
  mode,
  health,
  actorName,
  initialSpace,
  assistant,
  children,
}: {
  path: string;
  mode: "demo" | "live" | "blocked";
  health: HealthReport;
  actorName: string;
  initialSpace: SpaceId;
  assistant: AssistantStatus;
  children: ReactNode;
}) {
  // The root layout does not re-render on client navigation, so the server-sent path goes stale.
  const current = usePathname() ?? path;
  const router = useRouter();
  const [chosen, setChosen] = useState<SpaceId>(initialSpace);
  const [open, setOpen] = useState(false);
  const [arriving, setArriving] = useState<Space | null>(null);
  const [seenPath, setSeenPath] = useState(current);
  const space = spaceById(chosen);
  const modeText = health.modeLabel === "Demo" ? "Demo" : health.source === "live" ? "Live" : "Setup";
  const modeClass = health.modeLabel === "Demo" ? "is-demo" : health.source === "live" ? "is-live" : "is-setup";

  // Landing on a page of another space (a link, the back button) moves you into that space.
  // Only on a real page change, so a switch in progress is not undone before its page loads.
  if (current !== seenPath) {
    setSeenPath(current);
    const fromPath = spaceForPath(current);
    if (fromPath && fromPath !== chosen) setChosen(fromPath);
  }
  useEffect(() => {
    rememberSpace(chosen);
  }, [chosen]);

  // Warm every space's first page, so a switch lands quickly.
  useEffect(() => {
    for (const s of SPACES) router.prefetch(s.home);
  }, [router]);

  function travel(next: Space) {
    setOpen(false);
    if (next.id === space.id) {
      router.push(next.home);
      return;
    }
    setChosen(next.id);
    setArriving(next);
    // Swap the page while the train covers the screen.
    window.setTimeout(() => router.push(next.home), 520);
  }

  return (
    <LiveProvider mode={mode}>
      <ActionToastProvider>
      <div className="app-shell" style={{ "--space": space.colour } as CSSProperties}>
        <div className="app-layout">
          {open ? <button type="button" className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
          {/* A slim icon rail that opens over the page on hover, so the content keeps its width. */}
          <aside className={`app-sidebar ${open ? "is-open" : ""}`}>
            <div className="sidebar-brand">
              <Link href={space.home} className="flex min-w-0 items-center gap-2.5" aria-label={space.name} onClick={() => setOpen(false)}>
                <span className="brand-mark" aria-hidden="true">e</span>
                <span className="nav-label min-w-0">
                  <span className="block text-[17px] leading-none font-bold tracking-[-0.04em] text-ink">epik</span>
                  <span className="mt-1 block text-[11px] leading-none text-[var(--space)]">{space.name}</span>
                </span>
              </Link>
              <button type="button" className="md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <nav className="sidebar-nav" aria-label={space.name}>
              {space.links.map((link) => (
                <NavItem key={link.href} href={link.href} label={link.label} icon={ICONS[link.icon]} current={active(current, link.href)} onNavigate={() => setOpen(false)} />
              ))}
              {/* On a phone the rail is a drawer, so the spaces live here too. */}
              <div className="mt-4 md:hidden">
                <p className="nav-section nav-label">Spaces</p>
                {SPACES.map((s) => {
                  const Icon = ICONS[s.icon];
                  return (
                    <button key={s.id} type="button" className="nav-link w-full" aria-current={s.id === space.id ? "page" : undefined} onClick={() => travel(s)}>
                      <Icon size={18} strokeWidth={1.8} className="shrink-0" style={{ color: s.colour }} />
                      <span className="nav-label truncate">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
            <div className="px-[10px]">
              <NavItem href="/settings" label="Settings" icon={Settings} current={active(current, "/settings")} onNavigate={() => setOpen(false)} />
            </div>
            <div className="sidebar-user">
              <span className="avatar size-8 text-[12px]" style={avatarStyle(actorName)}>{initials(actorName)}</span>
              <span className="nav-label min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{actorName}</span>
                <span className="block truncate text-[11px] text-faint">{space.name}</span>
              </span>
            </div>
          </aside>
          <main className="app-main">
            <div className="app-topbar">
              <span>
                <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-line bg-white/5 md:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
                  <Menu size={16} />
                </button>
              </span>
              <nav className="space-switcher" aria-label="Spaces">
                {SPACES.map((s) => {
                  const Icon = ICONS[s.icon];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="space-tab"
                      aria-current={s.id === space.id ? "true" : undefined}
                      style={{ "--tint": s.colour } as CSSProperties}
                      title={s.name}
                      onClick={() => travel(s)}
                    >
                      <Icon size={16} strokeWidth={2} />
                      <span className="space-tab-label">{s.short}</span>
                    </button>
                  );
                })}
              </nav>
              <span className="flex min-w-0 items-center justify-end gap-3">
                <span className={`mode-pill ${modeClass}`}><span className="mode-dot" /><span className="hidden sm:inline">{modeText}</span></span>
                <ActorControl name={actorName} />
              </span>
            </div>
            {children}
          </main>
        </div>
        {current.startsWith("/assistant") || current === "/access" ? null : <AskDrawer status={assistant} />}
        <SpaceTransition space={arriving} arrived={arriving ? current === arriving.home : false} onDone={() => setArriving(null)} />
      </div>
      </ActionToastProvider>
    </LiveProvider>
  );
}

function NavItem({ href, label, icon: Icon, current, onNavigate }: { href: string; label: string; icon: LucideIcon; current: boolean; onNavigate: () => void }) {
  return (
    <Link href={href} title={label} aria-label={label} aria-current={current ? "page" : undefined} className="nav-link" onClick={onNavigate}>
      <Icon size={18} strokeWidth={1.8} className="shrink-0" />
      <span className="nav-label truncate">{label}</span>
    </Link>
  );
}
