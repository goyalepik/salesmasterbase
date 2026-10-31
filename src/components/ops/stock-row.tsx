"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import type { StockLevel } from "@/lib/ops/types";
import { inr, shortDate } from "@/lib/ops-ui/format";
import { movementLabel, type StockDetail } from "@/lib/ops-ui/serials";

type Loaded = { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "ready"; detail: StockDetail };

/** One product in the stock table. Tap it to see the serial numbers on the shelf and the latest movements. */
export function StockRow({ row }: { row: StockLevel }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded>({ state: "idle" });
  const [filter, setFilter] = useState("");
  const share = row.onHand > 0 ? Math.max(0, Math.min(1, row.available / row.onHand)) : 0;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data.state === "ready" || data.state === "loading") return;
    setData({ state: "loading" });
    try {
      const response = await fetch(`/api/stock/${encodeURIComponent(row.sku)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load this product.");
      setData({ state: "ready", detail: body as StockDetail });
    } catch (error) {
      setData({ state: "error", message: error instanceof Error ? error.message : "Could not load this product." });
    }
  }

  const serials = data.state === "ready" ? data.detail.serials.filter((s) => !filter || s.serial.toLowerCase().includes(filter.toLowerCase())) : [];

  return (
    <>
      <tr className={`inv-row ${open ? "is-open" : ""}`} onClick={toggle} aria-expanded={open}>
        <td>
          <span className="flex items-center gap-2">
            <ChevronRight size={14} className="inv-row-chevron shrink-0" />
            <span className="min-w-0">
              <span className="inv-cell-name" title={row.name}>{row.name}</span>
              <span className="inv-cell-sub">{row.sku}{row.brand ? ` · ${row.brand}` : ""}</span>
            </span>
          </span>
        </td>
        <td className="num">
          <span className={`inv-free-cell ${row.available > 0 ? "is-good" : "is-bad"}`}>{row.available}</span>
          <span className="inv-bar" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></span>
        </td>
        <td className="num">{row.onHand}</td>
        <td className="num">{row.reserved || <span className="text-faint">0</span>}</td>
        <td className="num">
          {row.incoming ? <span className="text-info">+{row.incoming}</span> : <span className="text-faint">0</span>}
          {row.nextEta ? <span className="inv-cell-sub">{shortDate(row.nextEta)}</span> : null}
        </td>
        <td className="num text-muted">{inr(row.unitCostMinor)}</td>
        <td className="num">{row.unitCostMinor != null ? inr(row.unitCostMinor * Math.max(0, row.onHand)) : "—"}</td>
      </tr>
      {open ? (
        <tr className="inv-detail-row">
          <td colSpan={7}>
            {data.state === "loading" || data.state === "idle" ? (
              <p className="flex items-center gap-2 py-3 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Loading serial numbers…</p>
            ) : data.state === "error" ? (
              <p className="py-3 text-[13px] text-bad">{data.message}</p>
            ) : (
              <div className="inv-detail">
                <section>
                  <div className="inv-detail-head">
                    <h4>Serial numbers on the shelf <span>{data.detail.serials.length}</span></h4>
                    {data.detail.serials.length > 8 ? (
                      <label className="inv-detail-search">
                        <Search size={13} aria-hidden="true" />
                        <span className="sr-only">Find a serial number</span>
                        <input value={filter} onChange={(event) => setFilter(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder="Find a serial" />
                      </label>
                    ) : null}
                  </div>
                  {serials.length ? (
                    <ul className="serial-grid">
                      {serials.map((s, index) => (
                        <li key={`${s.serial}-${index}`} title={`${s.source} on ${shortDate(s.since)}`}>
                          <code>{s.serial}</code>
                          <span>{s.source} · {shortDate(s.since)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-muted">{filter ? "No serial matches." : "No serial numbers recorded for this product yet."}</p>
                  )}
                  {data.detail.unserialised > 0 ? (
                    <p className="inv-detail-note">
                      {data.detail.unserialised} {data.detail.unserialised === 1 ? "unit has" : "units have"} no serial number yet (opening stock from the sheet, or received without one). Serials are added when stock is received with them.
                    </p>
                  ) : null}
                </section>
                <section>
                  <div className="inv-detail-head"><h4>Latest movements</h4></div>
                  {data.detail.movements.length ? (
                    <ol className="move-list">
                      {data.detail.movements.map((m, index) => (
                        <li key={index}>
                          <span className={`move-qty ${m.qty > 0 ? "is-in" : "is-out"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] text-ink">{movementLabel(m.kind)}{m.serial ? <code className="ml-1.5">{m.serial}</code> : null}</span>
                            <span className="block truncate text-[11.5px] text-faint">{shortDate(m.at)} · {m.actor}{m.note ? ` · ${m.note}` : ""}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-[12.5px] text-muted">No movements yet.</p>
                  )}
                </section>
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
