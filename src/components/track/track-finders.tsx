"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import { nameMatches, orderMatches, STAGES, TRACK_LABELS, TRACK_TONE, type PocRow, type TrackOrder } from "@/lib/sheets/smb-orders";

function FindBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="track-find">
      <Search size={18} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Clear"><X size={18} /></button>
      ) : null}
    </div>
  );
}

/** The names, A to Z. Typing narrows them: the start of a name ("bal") or the initials ("bs"). */
export function NameFinder({ people, base, website }: { people: PocRow[]; base: string; website: number }) {
  const [typed, setTyped] = useState("");
  const shown = people.filter((p) => nameMatches(p.name, typed));
  return (
    <>
      <FindBox value={typed} onChange={setTyped} placeholder="Type your name or initials" label="Find your name" />
      {shown.length ? (
        <ul className="s-card pub-rows">
          {shown.map((p) => (
            <li key={p.key}>
              <Link href={`${base}?poc=${encodeURIComponent(p.name)}`} className="pub-row track-name">
                <span className="track-avatar" aria-hidden="true">{initials(p.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="pub-row-title"><strong>{p.name}</strong></span>
                  <span className="pub-row-sub">{p.total} order{p.total === 1 ? "" : "s"}</span>
                  <span className="track-mini" aria-hidden="true">
                    {STAGES.filter((g) => p.stages[g.id]).map((g) => (
                      <span key={g.id} style={{ flexGrow: p.stages[g.id], background: g.colour }} />
                    ))}
                  </span>
                </span>
                <span className="pub-row-side">
                  {p.open ? <span className="badge tone-warn">{p.open} open</span> : <span className="badge tone-good">All done</span>}
                  <ChevronRight size={16} className="text-faint" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="s-card s-empty">No name starts with “{typed}”. Try your first name.</p>
      )}
      {website && !typed ? (
        <Link href={`${base}?poc=${encodeURIComponent("Shopify direct")}`} className="track-website">
          Website orders (Shopify direct) <span>{website}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ) : null}
    </>
  );
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** One CD's orders: not delivered first. Typing narrows them by customer, product, #PIK or phone. */
export function OrderFinder({ orders, base, poc }: { orders: TrackOrder[]; base: string; poc: string }) {
  const [typed, setTyped] = useState("");
  const shown = orders.filter((o) => orderMatches(o, typed));
  const groups: Array<[string, TrackOrder[]]> = [
    ["Not delivered yet", shown.filter((o) => o.status !== "delivered" && o.status !== "cancelled")],
    ["Delivered", shown.filter((o) => o.status === "delivered")],
    ["Cancelled", shown.filter((o) => o.status === "cancelled")],
  ];
  return (
    <>
      <FindBox value={typed} onChange={setTyped} placeholder="Customer, product, #PIK or phone" label="Find an order" />
      {shown.length ? (
        groups.map(([title, list]) =>
          list.length ? (
            <section key={title} className="pub-section" aria-label={title}>
              <h2>{title} <span>{list.length}</span></h2>
              <ul className="s-card pub-rows">
                {list.map((o) => (
                  <li key={o.id}>
                    <Link href={`${base}?order=${encodeURIComponent(o.id)}&poc=${encodeURIComponent(poc)}`} className="pub-row">
                      <span className="min-w-0 flex-1">
                        <span className="pub-row-title"><strong>{o.customer}</strong></span>
                        <span className="pub-row-sub">{o.products.map((p) => p.name).join(", ") || "Product not filled in"}</span>
                        <span className="pub-row-sub track-pik">{[o.shopify, o.date].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="pub-row-side">
                        <span className={`badge ${TRACK_TONE[o.status]}`}>{o.status === "other" ? o.logisticStatus.slice(0, 18) : TRACK_LABELS[o.status]}</span>
                        <ChevronRight size={16} className="text-faint" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )
      ) : (
        <p className="s-card s-empty">No order matches “{typed}”.</p>
      )}
    </>
  );
}
