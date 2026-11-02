"use client";

import { useSyncExternalStore } from "react";
import { summarise, todayIst } from "@/features/tracker/lib/insights";
import type { Ticket } from "@/features/tracker/lib/model";
import { sampleTickets } from "@/features/tracker/lib/samples";

const noop = () => () => {};

function read(): string {
  let tickets: Ticket[];
  try {
    const raw = window.localStorage.getItem("epik-tracker-v1");
    tickets = raw ? (JSON.parse(raw) as { tickets: Ticket[] }).tickets : sampleTickets();
  } catch {
    tickets = sampleTickets();
  }
  const s = summarise(tickets, todayIst());
  return `${s.open} open · ${s.late} late`;
}

/** The tracker keeps its tickets in this browser for now, so its number is read here, not on the server. */
export function TrackerStat() {
  return <>{useSyncExternalStore(noop, read, () => "")}</>;
}
