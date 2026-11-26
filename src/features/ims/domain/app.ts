// What people enter in the IMS itself (Editor role): bills received (stock goes up) and status updates on PO lines and
// dispatched units. Stored in the IMS's own tables, never in the sheets; merged with the sheets by serial or invoice so
// nothing counts twice. Pure types and rules: tests use them.

export type ReceiptLine = { sku: string; name: string; qty: number; unitCost: number; serials: string[]; condition: "Good" | "Damaged" | "Open box" };

export type Receipt = {
  id: string;
  at: string;
  by: string;
  vendor: string;
  invoice: string;
  invoiceDate: string | null;
  po: string | null;
  billedTo: string | null;
  terms: "Cash and Carry" | "SOR";
  lines: ReceiptLine[];
  billPath: string | null;
  billName: string | null;
  note: string | null;
  voided: boolean;
};

export const PO_STATUSES = ["In transit", "Received", "Partly received", "Delayed", "Not coming"] as const;
export const DISPATCH_STATUSES = ["Out for delivery", "Delivered", "Installed", "Returned", "RTO", "Damaged in transit"] as const;

export type StatusNote = {
  at: string;
  by: string;
  kind: "po" | "dispatch";
  /** PO line: "PO|SKU"; dispatched unit: its serial (or order id when there is no serial). */
  ref: string;
  status: string;
  eta: string | null;
  note: string | null;
};

export type AppEntries = { receipts: Receipt[]; statuses: StatusNote[]; ready: boolean };
export const NO_ENTRIES: AppEntries = { receipts: [], statuses: [], ready: false };

export const poRef = (po: string | null, sku: string | null) => `${(po ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")}|${(sku ?? "").toLowerCase().trim()}`;

/** The latest status per ref. */
export function latestStatus(notes: StatusNote[], kind: StatusNote["kind"]): Map<string, StatusNote> {
  const out = new Map<string, StatusNote>();
  for (const n of [...notes].filter((x) => x.kind === kind).sort((a, b) => a.at.localeCompare(b.at))) out.set(n.ref, n);
  return out;
}

/** Problems with a receipt before it is saved (plain words for the form). */
export function receiptProblems(r: Pick<Receipt, "vendor" | "invoice" | "lines">): string[] {
  const out: string[] = [];
  if (!r.vendor.trim()) out.push("Add the vendor.");
  if (!r.invoice.trim()) out.push("Add the invoice number.");
  if (!r.lines.length) out.push("Add at least one product.");
  r.lines.forEach((l, i) => {
    if (!l.sku.trim()) out.push(`Line ${i + 1}: pick the product.`);
    if (!(l.qty > 0)) out.push(`Line ${i + 1}: quantity must be more than 0.`);
    if (l.serials.length > l.qty) out.push(`Line ${i + 1}: more serials (${l.serials.length}) than units (${l.qty}).`);
    const dup = l.serials.find((s, j) => l.serials.indexOf(s) !== j);
    if (dup) out.push(`Line ${i + 1}: serial ${dup} is there twice.`);
  });
  return out;
}

// ── Matching a bill line to a product ────────────────────────────────────────

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["the", "and", "for", "with", "pro", "of", "gb"].includes(w));

/** The products a bill line most likely is, best first (score 0–1). Model numbers count most. */
export function matchProducts(description: string, products: Array<{ sku: string; name: string }>, limit = 3): Array<{ sku: string; name: string; score: number }> {
  const want = new Set(words(description));
  const codes = [...want].filter((w) => /\d/.test(w));
  if (!want.size) return [];
  return products
    .map((p) => {
      const have = new Set(words(`${p.name} ${p.sku.replace(/-/g, " ")}`));
      let hit = 0;
      for (const w of want) if (have.has(w)) hit += /\d/.test(w) ? 2 : 1;
      const codeMiss = codes.filter((c) => !have.has(c)).length;
      const score = Math.max(0, hit / (want.size + codes.length) - codeMiss * 0.15);
      return { sku: p.sku, name: p.name, score: Math.round(score * 100) / 100 };
    })
    .filter((m) => m.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
