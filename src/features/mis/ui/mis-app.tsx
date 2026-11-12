"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clock3 } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import type { MisReport } from "../lib/types";
import { metric, monthName } from "./format";
import { MisProvider } from "./kit";
import { Demos, Mix, Operations, Overview, Pnl, Products, SalesTeam } from "./screens";

const TABS = [
  { id: "overview", label: "Overview", Screen: Overview },
  { id: "pnl", label: "P&L", Screen: Pnl },
  { id: "mix", label: "Category & brand", Screen: Mix },
  { id: "sales", label: "Sales team", Screen: SalesTeam },
  { id: "ops", label: "Operations", Screen: Operations },
  { id: "products", label: "Products", Screen: Products },
  { id: "demos", label: "Demos", Screen: Demos },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function MisApp({ report, problem }: { report: MisReport | null; problem: string | null }) {
  const [tab, setTab] = useState<TabId>("overview");
  useEffect(() => {
    // Open the tab named in the link (#pnl), on load and when the link changes.
    const read = () => {
      const fromHash = window.location.hash.slice(1);
      if (TABS.some((t) => t.id === fromHash)) setTab(fromHash as TabId);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = (id: TabId) => {
    setTab(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  if (!report) {
    return (
      <div className="mis">
        <div className="mis-empty">
          <EpikLogo height={26} />
          <h1>MIS</h1>
          <p>{problem ?? "No MIS yet."}</p>
          <Link href="/">Back to EPIK</Link>
        </div>
      </div>
    );
  }

  const checks = metric(report, "Tie-out checks passed").cur;
  const provisional = report.pnl.some((x) => x.basis === "Inputs");
  const Screen = TABS.find((t) => t.id === tab)!.Screen;

  return (
    <MisProvider>
      <div className="mis">
        <header className="mis-top">
          <Link href="/" className="mis-home" aria-label="Back to EPIK home">
            <ArrowLeft size={16} />
            <EpikLogo height={18} />
          </Link>
          <div className="mis-title">
            <b>MIS</b>
            <span>{monthName(report.month)} <i>vs {monthName(report.prev)}</i></span>
          </div>
          <nav className="mis-tabs" aria-label="MIS sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>{t.label}</button>
            ))}
          </nav>
          <div className="mis-status">
            {checks ? <span className="chip is-good"><Check size={12} /> {checks} of {checks} checks</span> : null}
            {provisional ? <span className="chip is-warn"><Clock3 size={12} /> Costs provisional</span> : null}
          </div>
        </header>
        <main className="mis-main" key={tab}>
          <Screen r={report} />
        </main>
        <footer className="mis-foot">₹ in lakhs unless a figure says ₹. Every number opens its source. Snapshot of {report.source}; it does not update by itself.</footer>
      </div>
    </MisProvider>
  );
}
