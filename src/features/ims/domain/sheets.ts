// The Inventory Management System reads three team sheets. Each reader finds the heading row by name (so columns can
// move), and turns rows into plain records. Pure (no "server-only"): tests use it.
//
//   Procurement sheet → "Procurement list"      one row per PO line raised: what is coming
//   Inventory Masterbase → "Inventory Masterbase" one row per serial: goods in, and goods out to a customer
//   Inventory Tracker → "Current Stock"           the team's daily count per SKU, used as a cross-check

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v: string | undefined) => {
  const n = Number(clean(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const orNull = (v: string) => (v ? v : null);

/** "01/11/2026" or "23-06-2026" (day first, as the sheets write it) → "2026-11-01"; null when it isn't a date. */
export function sheetDay(v: string | undefined): string | null {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(clean(v));
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const skuKey = (v: string | null | undefined) => clean(v ?? "").toLowerCase();

/** The row (among the first ten) that has every one of these headings, and where each heading is. */
function headings(rows: string[][], wanted: Record<string, string[]>, must: string[]) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = (rows[r] ?? []).map((h) => norm(h ?? ""));
    const at: Record<string, number> = {};
    for (const [field, names] of Object.entries(wanted)) {
      const i = row.findIndex((h) => names.some((n) => norm(n) === h));
      if (i >= 0) at[field] = i;
    }
    if (must.every((f) => at[f] != null)) return { row: r, at };
  }
  return null;
}

// ── Inventory Masterbase: one row per serial ─────────────────────────────────

export type Unit = {
  serial: string | null;
  sku: string;
  name: string;
  brand: string | null;
  /** SOR (sale or return) or Cash and Carry. */
  terms: string | null;
  qty: number;
  inStock: boolean;
  inwardOn: string | null;
  vendor: string | null;
  invoice: string | null;
  po: string | null;
  cost: number;
  hub: string | null;
  condition: string | null;
  receivedBy: string | null;
  dispatchedOn: string | null;
  price: number;
  customer: string | null;
  poc: string | null;
  returnedToVendor: boolean;
  damaged: boolean;
};

const UNIT_HEADINGS = {
  serial: ["Serial No.", "Serial No", "Serial"],
  sku: ["SKU Code", "SKU"],
  name: ["Product Name"],
  brand: ["Brand"],
  qty: ["Quantity"],
  terms: ["SOR/CnC", "SOR / CnC"],
  inward: ["Inward Date"],
  vendor: ["Vendor"],
  invoice: ["Invoice no.", "Invoice No."],
  po: ["PO/PI ID"],
  cost: ["Unit Cost"],
  hub: ["Hub"],
  condition: ["Condition on Inward"],
  receivedBy: ["Receiving Personnel"],
  inSystem: ["In System (Y/N)"],
  dispatch: ["Dispatch Date"],
  price: ["Price"],
  customer: ["Customer Name"],
  poc: ["POC"],
  rtv: ["Returned to Vendor (Y/N)"],
  damaged: ["Damaged (Y/N)"],
};

export function readUnits(rows: string[][]): Unit[] {
  const h = headings(rows, UNIT_HEADINGS, ["sku", "inSystem"]);
  if (!h) return [];
  const get = (row: string[], f: keyof typeof UNIT_HEADINGS) => (h.at[f] == null ? "" : clean(row[h.at[f]]));
  const out: Unit[] = [];
  for (const row of rows.slice(h.row + 1)) {
    const sku = get(row, "sku");
    if (!sku) continue;
    const inStock = /^y/i.test(get(row, "inSystem"));
    const qty = num(get(row, "qty"));
    out.push({
      serial: orNull(get(row, "serial")),
      sku,
      name: get(row, "name") || sku,
      brand: orNull(get(row, "brand")),
      terms: orNull(get(row, "terms")),
      qty: inStock ? Math.max(qty, 1) : qty,
      inStock,
      inwardOn: sheetDay(get(row, "inward")),
      vendor: orNull(get(row, "vendor")),
      invoice: orNull(get(row, "invoice")),
      po: orNull(get(row, "po")),
      cost: num(get(row, "cost")),
      hub: orNull(get(row, "hub")),
      condition: orNull(get(row, "condition")),
      receivedBy: orNull(get(row, "receivedBy")),
      dispatchedOn: sheetDay(get(row, "dispatch")),
      price: num(get(row, "price")),
      customer: orNull(get(row, "customer")),
      poc: orNull(get(row, "poc")),
      returnedToVendor: /^y/i.test(get(row, "rtv")),
      damaged: /^y/i.test(get(row, "damaged")),
    });
  }
  return out;
}

// ── Procurement list: one row per PO line ────────────────────────────────────

export type PoLine = {
  row: number;
  raisedOn: string | null;
  po: string | null;
  vendor: string | null;
  sku: string | null;
  name: string;
  brand: string | null;
  qty: number;
  hub: string | null;
  owner: string | null;
  type: string | null;
  raised: boolean;
  terms: string | null;
  expectedDispatchOn: string | null;
  dispatchedOn: string | null;
  grnStatus: string | null;
  poStatus: string | null;
  receivedOn: string | null;
  /** The latest expected date the team wrote (revised, else current, else first ETA, else expected dispatch). */
  eta: string | null;
  notComing: boolean;
  delayReason: string | null;
  priority: string | null;
  unitPrice: number;
};

const PO_HEADINGS = {
  date: ["Date"],
  po: ["PO/PI ID"],
  vendor: ["Brand / vendor Name", "Vendor"],
  name: ["SKU Name"],
  sku: ["SKU Code"],
  qty: ["Qty Raised", "Qty"],
  hub: ["Hub Location"],
  owner: ["Procurement Owner"],
  type: ["Procurement Type (Brand/ Vendor)"],
  raised: ["PO / PI Raised (Y/N)"],
  terms: ["Payement Terms", "Payment Terms"],
  expDispatch: ["Expected Dispatch Date"],
  dispatch: ["Dispatch Date"],
  grn: ["GRN Status"],
  poStatus: ["PO Status"],
  received: ["Received Date"],
  eta: ["ETA"],
  currentEta: ["Current ETA"],
  revisedEta: ["Revised ETA"],
  delay: ["Delay Reason"],
  priority: ["Priority (High/Medium/Low)"],
  brand: ["Brand"],
  unitPrice: ["Unit price (inc GST)"],
};

export function readPoLines(rows: string[][]): PoLine[] {
  const h = headings(rows, PO_HEADINGS, ["po", "qty", "grn"]);
  if (!h) return [];
  const get = (row: string[], f: keyof typeof PO_HEADINGS) => (h.at[f] == null ? "" : clean(row[h.at[f]]));
  const out: PoLine[] = [];
  rows.slice(h.row + 1).forEach((row, i) => {
    const qty = num(get(row, "qty"));
    const po = get(row, "po");
    if (qty <= 0 || (!po && !get(row, "sku"))) return;
    const name = get(row, "name");
    const revised = get(row, "revisedEta");
    out.push({
      row: h.row + i + 2,
      raisedOn: sheetDay(get(row, "date")),
      po: /^po\s*-?\s*$/i.test(po) || !po ? null : po,
      vendor: orNull(get(row, "vendor")),
      sku: orNull(get(row, "sku")),
      name: name && !/^#n\/a$/i.test(name) ? name : get(row, "sku") || "Unknown product",
      brand: orNull(get(row, "brand")),
      qty,
      hub: orNull(get(row, "hub")),
      owner: orNull(get(row, "owner")),
      type: orNull(get(row, "type")),
      raised: !/^no$/i.test(get(row, "raised")),
      terms: orNull(get(row, "terms")),
      expectedDispatchOn: sheetDay(get(row, "expDispatch")),
      dispatchedOn: sheetDay(get(row, "dispatch")),
      grnStatus: orNull(get(row, "grn")),
      poStatus: orNull(get(row, "poStatus")),
      receivedOn: sheetDay(get(row, "received")),
      eta: sheetDay(revised) ?? sheetDay(get(row, "currentEta")) ?? sheetDay(get(row, "eta")) ?? sheetDay(get(row, "expDispatch")),
      notComing: /not coming|cancel/i.test(`${revised} ${get(row, "poStatus")}`),
      delayReason: orNull(get(row, "delay")),
      priority: orNull(get(row, "priority").replace(/^meduim$/i, "Medium")),
      unitPrice: num(get(row, "unitPrice")),
    });
  });
  return out;
}

// ── Inventory Tracker "Current Stock": the team's count per SKU ──────────────

export type TrackerCount = { sku: string; name: string; brand: string | null; units: number; costPerUnit: number };
export type TrackerStock = { asOf: string | null; counts: TrackerCount[] };

export function readTrackerStock(rows: string[][]): TrackerStock {
  const asOf = rows.slice(0, 4).map((r) => clean(r[0])).find((c) => /as of/i.test(c))?.replace(/^as of:\s*/i, "") ?? null;
  const h = headings(rows, { brand: ["Brand"], sku: ["SKU Code"], name: ["Product Name"], units: ["Units"], cost: ["COGS / unit"] }, ["sku", "units"]);
  if (!h) return { asOf, counts: [] };
  const get = (row: string[], f: string) => (h.at[f] == null ? "" : clean(row[h.at[f]]));
  const counts = rows
    .slice(h.row + 1)
    .map((row) => ({ sku: get(row, "sku"), name: get(row, "name"), brand: orNull(get(row, "brand")), units: num(get(row, "units")), costPerUnit: num(get(row, "cost")) }))
    .filter((c) => c.sku);
  return { asOf, counts };
}

// ── Procurement sheet → Inward Sheet: one row per unit received ───────────────

export type Inward = {
  id: string;
  on: string | null;
  po: string | null;
  invoice: string | null;
  brand: string | null;
  vendor: string | null;
  category: string | null;
  name: string;
  sku: string | null;
  serial: string | null;
  qty: number;
  /** Cost incl. GST, after any credit note when the sheet has it. */
  cost: number;
  condition: string | null;
  receivedBy: string | null;
  terms: string | null;
  billedTo: string | null;
  source: "sheet" | "app";
};

const INWARD_HEADINGS = {
  id: ["Inward id"],
  on: ["Inward Date"],
  po: ["PO/PI ID"],
  invoice: ["Invoice No."],
  brand: ["Brand Name"],
  vendor: ["Vendor"],
  category: ["Product Category"],
  name: ["Product Name"],
  sku: ["SKU"],
  serial: ["Serial No."],
  qty: ["Quantity"],
  cost: ["Unit Cost"],
  cnCost: ["Credit Note Adjusted COGS"],
  condition: ["Condition Recieved", "Condition Received"],
  receivedBy: ["Recieved By", "Received By"],
  terms: ["SOR/CnC"],
  billedTo: ["Billed to"],
};

export function readInwards(rows: string[][]): Inward[] {
  const h = headings(rows, INWARD_HEADINGS, ["id", "on", "sku"]);
  if (!h) return [];
  const get = (row: string[], f: keyof typeof INWARD_HEADINGS) => (h.at[f] == null ? "" : clean(row[h.at[f]]));
  const out: Inward[] = [];
  for (const row of rows.slice(h.row + 1)) {
    const id = get(row, "id");
    const name = get(row, "name");
    if (!id || (!name && !get(row, "sku"))) continue;
    const po = get(row, "po");
    out.push({
      id,
      on: sheetDay(get(row, "on")),
      po: po && /\d/.test(po) ? po : null,
      invoice: orNull(get(row, "invoice")),
      brand: orNull(get(row, "brand")),
      vendor: orNull(get(row, "vendor")),
      category: orNull(get(row, "category")),
      name: name || get(row, "sku"),
      sku: orNull(get(row, "sku")),
      serial: orNull(get(row, "serial")),
      qty: Math.max(1, num(get(row, "qty"))),
      cost: num(get(row, "cnCost")) || num(get(row, "cost")),
      condition: orNull(get(row, "condition")),
      receivedBy: orNull(get(row, "receivedBy")),
      terms: orNull(get(row, "terms")),
      billedTo: orNull(get(row, "billedTo")),
      source: "sheet",
    });
  }
  return out;
}

// ── Inventory Masterbase → Dispatch Tracker: one row per item sent ────────────

export type Dispatch = {
  id: string | null;
  order: string | null;
  on: string | null;
  serial: string | null;
  name: string;
  sku: string | null;
  poc: string | null;
  hub: string | null;
  orderStatus: string | null;
  status: string | null;
  deliveredOn: string | null;
  expectedOn: string | null;
};

/** Sheets stores some dates as day numbers (46326 = 1 Nov 2026). */
function sheetDayOrSerial(v: string | undefined): string | null {
  const d = sheetDay(v);
  if (d) return d;
  const n = Number(clean(v));
  if (Number.isInteger(n) && n > 40000 && n < 60000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  return null;
}

const DISPATCH_HEADINGS = {
  id: ["ID"],
  order: ["Shopify Order ID"],
  on: ["Invoice Date"],
  serial: ["Product Serial #"],
  name: ["Product Name"],
  sku: ["SKU CODE"],
  poc: ["POC"],
  hub: ["HUB"],
  orderStatus: ["Order Status"],
  status: ["Delivery Status"],
  deliveredOn: ["Delivery Date"],
  expectedOn: ["Expected Delivery Date"],
};

export function readDispatches(rows: string[][]): Dispatch[] {
  const h = headings(rows, DISPATCH_HEADINGS, ["order", "serial", "status"]);
  if (!h) return [];
  const get = (row: string[], f: keyof typeof DISPATCH_HEADINGS) => (h.at[f] == null ? "" : clean(row[h.at[f]]));
  const out: Dispatch[] = [];
  for (const row of rows.slice(h.row + 1)) {
    const name = get(row, "name");
    if (!name && !get(row, "serial")) continue;
    out.push({
      id: orNull(get(row, "id")),
      order: orNull(get(row, "order")),
      on: sheetDayOrSerial(get(row, "on")),
      serial: orNull(get(row, "serial")),
      name: name || get(row, "sku"),
      sku: orNull(get(row, "sku")),
      poc: orNull(get(row, "poc")),
      hub: orNull(get(row, "hub")),
      orderStatus: orNull(get(row, "orderStatus")),
      status: orNull(get(row, "status")),
      deliveredOn: sheetDayOrSerial(get(row, "deliveredOn")),
      expectedOn: sheetDayOrSerial(get(row, "expectedOn")),
    });
  }
  return out;
}

// ── Inventory Tracker → In warehouse: the product list (category, list price) ─

export type CatalogItem = { sku: string; name: string; brand: string | null; category: string | null; listPrice: number; endOfLife: boolean };

export function readCatalog(rows: string[][]): CatalogItem[] {
  const h = headings(rows, { sku: ["SKU Codes", "SKU Code"], name: ["Mapped Product Name", "Product Name"], brand: ["Brand"], category: ["Category"], price: ["Selling Price"], eol: ["EOL"] }, ["sku", "category"]);
  if (!h) return [];
  const get = (row: string[], f: string) => (h.at[f] == null ? "" : clean(row[h.at[f]]));
  return rows
    .slice(h.row + 1)
    .map((row) => ({ sku: get(row, "sku"), name: get(row, "name"), brand: orNull(get(row, "brand")), category: orNull(get(row, "category")), listPrice: num(get(row, "price")), endOfLife: /^y/i.test(get(row, "eol")) }))
    .filter((c) => c.sku && c.sku !== "0");
}
