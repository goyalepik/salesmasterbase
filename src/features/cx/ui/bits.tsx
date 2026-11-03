"use client";

import { Facebook, Globe, Instagram, Mail, MessageCircle, Phone, PhoneMissed, Smartphone, type LucideIcon } from "lucide-react";
import { slaState, type SlaState } from "../domain/sla";
import type { Channel, Label, Ticket, TicketEvent } from "../domain/types";

export const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  facebook: Facebook,
  email: Mail,
  web_chat: Globe,
  call: Phone,
  missed_call: PhoneMissed,
  sms: Smartphone,
};

export const CHANNEL_NAME: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  web_chat: "Web chat",
  call: "Call",
  missed_call: "Missed call",
  sms: "SMS",
};

export function LabelBadge({ label }: { label: Label }) {
  return <span className={`cx-label is-${label.toLowerCase()}`}>{label}</span>;
}

export function duration(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  return `${Math.round(h / 24)}d`;
}

export function slaText(s: SlaState): string {
  if (s.state === "met") return "SLA met";
  if (s.state === "breached") return s.remainingMs < 0 ? `Breached ${duration(s.remainingMs)} ago` : "Breached";
  return `${duration(s.remainingMs)} left${s.clock === "first_response" ? " to reply" : ""}`;
}

export function SlaChip({ ticket, events, now }: { ticket: Ticket; events: TicketEvent[]; now: Date }) {
  const s = slaState(ticket, events, now);
  return (
    <span className={`cx-sla is-${s.state}`} title={`${Math.round(s.share * 100)}% of the ${s.clock === "first_response" ? "first-response" : "resolution"} time used`}>
      <i />
      {slaText(s)}
    </span>
  );
}

export function when(at: string, now: Date): string {
  const diff = now.getTime() - new Date(at).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 86_400_000) return `${duration(diff)} ago`;
  return new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function clock(at: string): string {
  return new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
