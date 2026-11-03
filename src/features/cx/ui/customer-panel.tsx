"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, MessageSquare, Package, Phone, PhoneMissed, Ticket as TicketIcon, type LucideIcon } from "lucide-react";
import { customer360, type Customer360, type TimelineItem } from "../domain/customer360";
import { maskPhone } from "../domain/service";
import { CHANNEL_NAME, when } from "./bits";
import { useCx } from "./cx-store";

const KIND_ICON: Record<TimelineItem["kind"], LucideIcon> = { ticket: TicketIcon, message: MessageSquare, call: Phone, missed_call: PhoneMissed, order: Package, demo: CalendarCheck };
const FLAG_TEXT: Record<string, string> = { vip: "VIP", repeat_complainer: "Repeat complainer", unpaid_order: "Unpaid order", missed_demo: "Missed demo", outside_cod_zone: "Outside COD zone", unidentified: "Unidentified" };

/** Customer 360: everything about the person behind the ticket, newest first. */
export function CustomerPanel({ uid, onOpenTicket }: { uid: string; onOpenTicket: (id: string) => void }) {
  const { data, repo, now, actor } = useCx();
  const [view, setView] = useState<Customer360 | null>(null);

  useEffect(() => {
    let live = true;
    if (repo) void customer360(repo, uid, now).then((v) => { if (live) setView(v); });
    return () => { live = false; };
  }, [repo, uid, now, data]);

  if (!view) return <div className="cx-empty">Loading customer…</div>;
  const c = view.customer;
  const phone = maskPhone(c.uid, actor.role);
  return (
    <div className="cx-360">
      <header>
        <span className="cx-avatar">{(c.name ?? "?").slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0">
          <b>{c.name ?? "Unknown name"}</b>
          <span>{phone}</span>
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
          const ticketId = item.kind === "ticket" ? item.title.split(" · ")[0] : null;
          return (
            <li key={i} className={item.tone ? `is-${item.tone}` : undefined}>
              <span className="cx-tl-icon"><Icon size={13} /></span>
              <span className="min-w-0 flex-1">
                {ticketId && data?.tickets.some((t) => t.id === ticketId) ? (
                  <button type="button" className="cx-tl-title" onClick={() => onOpenTicket(ticketId)}>{item.title}</button>
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
