import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, NotebookPen, RotateCcw, Search, Sheet } from "lucide-react";
import { addInventoryNoteAction, setInventoryNoteDoneAction } from "@/app/actions/ops";
import { BlockedState } from "@/components/blocked-state";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Panel } from "@/components/ops/bits";
import { InventoryTabs } from "@/components/ops/inventory-tabs";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader } from "@/components/ui";
import type { OpsStore } from "@/lib/ops/store";
import { groupStock, type StockGroupBy } from "@/lib/ops/stock-category";
import type { InventoryNote } from "@/lib/ops/types";
import { inr, inrCompact, requestNow, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam } from "@/lib/query";
import { sheetSyncStatus } from "@/lib/sheets/run";

export default async function InventoryViewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const by: StockGroupBy = firstParam(params.by) === "brand" ? "brand" : "category";
  const q = firstParam(params.q).replace(/\s+/g, " ").trim().slice(0, 60);
  return (
    <section>
      <PageHeader title="Inventory view" description="All stock on one screen, by category or brand. Tap a group to see its products. The same numbers go to the live stock tab in the team sheet." />
      <InventoryTabs store={ops.store} current="view" />
      <div className="iv-layout">
        <Suspense key={`${by}|${q}`} fallback={<SectionSkeleton height={620} />}>
          <Groups store={ops.store} by={by} q={q} />
        </Suspense>
        <aside className="grid content-start gap-3">
          <Suspense fallback={<SectionSkeleton height={260} />}>
            <Notes store={ops.store} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton height={120} />}>
            <SheetPanel store={ops.store} />
          </Suspense>
        </aside>
      </div>
    </section>
  );
}

function href(by: StockGroupBy, q: string): string {
  const params = new URLSearchParams();
  if (by !== "category") params.set("by", by);
  if (q) params.set("q", q);
  const text = params.toString();
  return `/inventory/view${text ? `?${text}` : ""}`;
}

async function Groups({ store, by, q }: { store: OpsStore; by: StockGroupBy; q: string }) {
  const levels = await store.stockLevels({ q: q || undefined, only: "all", limit: 10_000 });
  const groups = groupStock(levels, by);
  const totals = groups.reduce((t, g) => ({ onHand: t.onHand + g.onHand, free: t.free + g.free, allocated: t.allocated + g.allocated, incoming: t.incoming + g.incoming, value: t.value + g.valueMinor }), { onHand: 0, free: 0, allocated: 0, incoming: 0, value: 0 });
  return (
    <div className="min-w-0">
      <div className="iv-tools">
        <nav className="iv-seg" aria-label="Group by">
          <Link href={href("category", q)} aria-current={by === "category" ? "page" : undefined} scroll={false}>By category</Link>
          <Link href={href("brand", q)} aria-current={by === "brand" ? "page" : undefined} scroll={false}>By brand</Link>
        </nav>
        <form action="/inventory/view" className="inv-search !m-0 min-w-[220px] flex-1">
          {by !== "category" ? <input type="hidden" name="by" value={by} /> : null}
          <Search size={15} aria-hidden="true" />
          <label className="sr-only" htmlFor="iv-q">Search stock</label>
          <input id="iv-q" name="q" defaultValue={q} placeholder="Search product, SKU or brand" />
        </form>
        <p className="iv-total">
          <b>{totals.onHand.toLocaleString("en-IN")}</b> on hand · <b className="text-good">{totals.free.toLocaleString("en-IN")}</b> free · <b>{totals.allocated}</b> allocated · <b className="text-info">{totals.incoming}</b> incoming · <b>{inrCompact(totals.value)}</b>
        </p>
      </div>

      {!groups.length ? (
        <div className="inv-empty">{q ? `Nothing matches “${q}”.` : "No stock yet."}</div>
      ) : (
        <>
          <nav className="iv-jump" aria-label={by === "brand" ? "Brands" : "Categories"}>
            {groups.map((g) => (
              <a key={g.key} href={`#g-${g.key}`}>
                {g.label} <span>{g.onHand}</span>
              </a>
            ))}
          </nav>
          <div className="grid gap-2">
            {groups.map((g) => (
              <details key={g.key} id={`g-${g.key}`} className="iv-group" open={!!q || groups.length === 1}>
                <summary>
                  <span className="iv-name">{g.label}</span>
                  <span className="iv-skus">{g.skus} product{g.skus === 1 ? "" : "s"}</span>
                  <span className="iv-num"><b className="text-good">{g.free}</b> free</span>
                  <span className="iv-num"><b>{g.onHand}</b> on hand</span>
                  <span className="iv-num">{g.allocated ? <><b>{g.allocated}</b> allocated</> : <span className="text-faint">0 allocated</span>}</span>
                  <span className="iv-num">{g.incoming ? <><b className="text-info">{g.incoming}</b> incoming</> : <span className="text-faint">0 incoming</span>}</span>
                  <span className="iv-value">{inrCompact(g.valueMinor)}</span>
                </summary>
                <div className="table-scroll">
                  <table className="inv-table iv-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Free</th>
                        <th className="num">On hand</th>
                        <th className="num">Allocated</th>
                        <th className="num">Incoming</th>
                        <th className="num">Unit cost</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((row) => (
                        <tr key={row.sku}>
                          <td>
                            <Link href={`/inventory/stock?q=${encodeURIComponent(row.sku)}#stock`} className="block min-w-0">
                              <span className="inv-cell-name" title={row.name}>{row.name}</span>
                              <span className="inv-cell-sub">{row.sku}{by === "category" && row.brand ? ` · ${row.brand}` : ""}</span>
                            </Link>
                          </td>
                          <td className={`num font-semibold ${row.available > 0 ? "text-good" : "text-faint"}`}>{Math.max(0, row.available)}</td>
                          <td className="num">{row.onHand}</td>
                          <td className="num">{row.reserved || <span className="text-faint">0</span>}</td>
                          <td className="num">{row.incoming ? <span className="text-info">{row.incoming}{row.nextEta ? <span className="block text-[11px] text-faint">{shortDate(row.nextEta)}</span> : null}</span> : <span className="text-faint">0</span>}</td>
                          <td className="num text-muted">{row.unitCostMinor ? inr(row.unitCostMinor) : "—"}</td>
                          <td className="num">{row.unitCostMinor ? inr(Math.max(0, row.onHand) * row.unitCostMinor) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Piyush's notes: a shared notes block. Open notes on top; tick one when it is done. */
async function Notes({ store }: { store: OpsStore }) {
  let notes: InventoryNote[] | null = null;
  try {
    notes = await store.listInventoryNotes(10);
  } catch {
    notes = null;
  }
  const open = notes?.filter((n) => !n.done) ?? [];
  const done = notes?.filter((n) => n.done) ?? [];
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><NotebookPen size={16} className="text-[var(--space)]" /> Piyush&apos;s notes</span>} subtitle="For the inventory team. Anyone can add one; tick it when done.">
      {notes == null ? (
        <p className="text-[13px] text-warn">Notes need a one-time database step (migration 0005). Until then they cannot be saved.</p>
      ) : (
        <>
          <ActionForm action={addInventoryNoteAction} className="grid gap-2">
            <label className="sr-only" htmlFor="note-body">New note</label>
            <textarea id="note-body" name="body" required maxLength={1000} rows={2} placeholder="e.g. Dreame L50 count is 2 short, recheck shelf B" className="field w-full px-3 py-2 text-[13px] outline-none" />
            <div><SubmitButton tone="quiet" small>Add note</SubmitButton></div>
          </ActionForm>
          {open.length ? (
            <ul className="iv-notes">
              {open.map((note) => (
                <li key={note.id}>
                  <ActionForm action={setInventoryNoteDoneAction}>
                    <input type="hidden" name="noteId" value={note.id} />
                    <input type="hidden" name="done" value="on" />
                    <button type="submit" className="iv-tick" title="Mark done" aria-label="Mark done"><CheckCircle2 size={16} /></button>
                  </ActionForm>
                  <div className="min-w-0">
                    <p className="iv-note-body">{note.body}</p>
                    <p className="iv-note-meta">{note.author} · {shortWhen(note.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted">No open notes.</p>
          )}
          {done.length ? (
            <details className="action-more mt-2">
              <summary>Done ({done.length})</summary>
              <ul className="iv-notes is-done">
                {done.map((note) => (
                  <li key={note.id}>
                    <ActionForm action={setInventoryNoteDoneAction}>
                      <input type="hidden" name="noteId" value={note.id} />
                      <button type="submit" className="iv-tick" title="Open again" aria-label="Open again"><RotateCcw size={14} /></button>
                    </ActionForm>
                    <div className="min-w-0">
                      <p className="iv-note-body">{note.body}</p>
                      <p className="iv-note-meta">{note.author} · done by {note.doneBy ?? "someone"} {shortWhen(note.doneAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** Where the link with the team's sheet stands. The sheet checks in every 5 minutes. */
async function SheetPanel({ store }: { store: OpsStore }) {
  const status = await sheetSyncStatus(store);
  const now = requestNow();
  const ago = (iso: string) => {
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    return minutes < 1 ? "just now" : minutes < 120 ? `${minutes} min ago` : shortWhen(iso);
  };
  const broken = !!status.lastError && (!status.lastOk || status.lastError > status.lastOk);
  const stale = !!status.lastOk && now - Date.parse(status.lastOk) > 20 * 60_000;
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Sheet size={16} className="text-good" /> Team sheet</span>} subtitle="Two-way with EPIK's copy of Inventory Masterbase. The team's original sheet is never written.">
      {!status.connected ? (
        <p className="text-[13px] text-muted">Not linked yet. Once linked, the sheet sends new stock and dispatches here, and gets the live stock tab back, every 5 minutes.</p>
      ) : (
        <div className="grid gap-2 text-[13px]">
          <p className={broken ? "text-bad" : stale ? "text-warn" : "text-muted"}>
            {broken
              ? `The last check-in failed ${ago(status.lastError!)}. Open the sheet → EPIK App sync log tab.`
              : status.lastOk
                ? `Last check-in ${ago(status.lastOk)}.${stale ? " It should check in every 5 minutes: open the sheet and run EPIK App → Sync now." : ""}`
                : "The sheet has not checked in yet."}
          </p>
          <p className="text-[12px] text-faint">Rows dated {shortDate(status.from)} or later sync. Older stock was already in the app.</p>
          {status.url ? (
            <a href={status.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-info">
              Open sheet <ExternalLink size={13} />
            </a>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
