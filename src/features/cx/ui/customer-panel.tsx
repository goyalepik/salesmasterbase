"use client";

import { useState } from "react";
import { CalendarCheck, MessageSquare, Package, Phone, PhoneMissed, Ticket as TicketIcon, type LucideIcon } from "lucide-react";
import type { Customer360, TimelineItem } from "../domain/customer360";
import { CHANNEL_NAME, when } from "./bits";
import { useCx } from "./cx-store";

const KIND_ICON: Record<TimelineItem["kind"], LucideIcon> = { ticket: TicketIcon, message: MessageSquare, call: Phone, missed_call: PhoneMissed, order: Package, demo: CalendarCheck };
const FLAG_TEXT: Record<string, string> = { vip: "VIP", repeat_complainer: "Repeat complainer", unpaid_order: "Unpaid order", missed_demo: "Missed demo", outside_cod_zone: "Outside COD zone", unidentified: "Unidentified" };

/** Customer 360: everything about the person behind the ticket, newest first. */
export function CustomerPanel({ view, ticketId, onOpenTicket }: { view: Customer360 | null; ticketId: string; onOpenTicket: (id: string) => void }) {
  const { now, can, detail } = useCx();
  // The full number is fetched only on request, for levels allowed to see it, and forgotten when another customer opens.
  const [revealed, setFull] = useState<{ uid: string; phone: string } | null>(null);
  const uid = view?.customer.uid ?? "";
  const full = revealed?.uid === uid ? revealed.phone : null;

  if (!view) return <div className="cx-empty">No customer details for this ticket.</div>;
  const c = view.customer;
  const phone = full ?? c.display ?? "Unidentified";
  const canReveal = can("reveal_phone", detail?.ticket) && c.uid.startsWith("c_") && !full;
  const reveal = async () => {
    // Each reveal is written to the ticket's history (who and when, never the number).
    const r = await fetch(`/api/cx/customer?ref=${encodeURIComponent(c.uid)}&ticket=${encodeURIComponent(ticketId)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    setFull(r?.phone ? { uid: c.uid, phone: r.phone } : null);
  };
  return (
    <div className="cx-360">
      <header>
        <span className="cx-avatar">{(c.name ?? "?").slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0">
          <b>{c.name ?? "Unknown name"}</b>
          <span>{phone}{canReveal ? <button type="button" className="cx-link" onClick={() => void reveal()}> Show number</button> : null}</span>
        </span>
        <span className={`cx-mood is-${view.label}`}>{view.label}</span>
      </header>
      {c.uid.startsWith("unidentified") ? <p className="cx-note">No phone number on this channel. Match by name or handle when the customer shares one.</p> : null}
      <div className="cx-chips">
        {view.channels.map((ch) => <span key={ch}>{CHANNEL_NAME[ch as keyof typeof CHANNEL_NAME] ?? ch}</span>)}
        {c.flags.map((f) => <span key={f} className="is-flag">{FLAG_TEXT[f] ?? f}</span>)}
        {c.csat ? <span>CSAT {c.csat}/5</span> : null}
      </div>
      <dl className="cx-counters">
        {([
          ["Tickets", view.counters.tickets],
          ["Open", view.counters.openIssues],
          ["Complaints", view.counters.complaints],
          ["Orders", view.counters.orders],
          ["Demos", view.counters.demos],
          ["Missed calls", view.counters.missedCalls],
        ] as const).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <h3>History</h3>
      <ol className="cx-timeline">
        {view.timeline.map((item, i) => {
          const Icon = KIND_ICON[item.kind];
          const itemTicket = item.kind === "ticket" ? item.title.split(" · ")[0] : null;
          return (
            <li key={i} className={item.tone ? `is-${item.tone}` : undefined}>
              <span className="cx-tl-icon"><Icon size={13} /></span>
              <span className="min-w-0 flex-1">
                {itemTicket ? (
                  <button type="button" className="cx-tl-title" onClick={() => onOpenTicket(itemTicket)}>{item.title}</button>
                ) : <span className="cx-tl-title">{item.title}</span>}
                {item.detail ? <span className="cx-tl-detail">{item.detail}</span> : null}
              </span>
              <time>{when(item.at, now)}</time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
