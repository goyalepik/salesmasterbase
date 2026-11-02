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
  return [s.late, s.open, s.waiting].join("|");
}

/** The tracker keeps its tickets in this browser for now, so its numbers are read here, not on the server. */
export function TrackerStat() {
  const text = useSyncExternalStore(noop, read, () => "");
  const [late, open, waiting] = text ? text.split("|") : ["–", "–", "–"];
  return (
    <>
      <p className="hm-figure">
        <b className={late !== "0" && late !== "–" ? "is-alert" : undefined}>{late}</b>
        <span>late tickets</span>
      </p>
      <dl className="hm-pair">
        <div><dt>Open</dt><dd>{open}</dd></div>
        <div><dt>Waiting on a team</dt><dd>{waiting}</dd></div>
      </dl>
    </>
  );
}
