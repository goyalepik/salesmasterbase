/**
 * Reads the three company workbooks (Inventory Tracker, Installation Tracker, Procurement sheet)
 * and writes one normalised seed: data/ops-seed.local.json (gitignored — it holds customer data).
 *
 *   npx tsx scripts/import-sheets.ts --inventory "Inventory Tracker.xlsx" --installation "Installation Tracker.xlsx" [--out data/ops-seed.local.json]
 *   npx tsx scripts/import-sheets.ts --seed data/ops-seed.local.json --push     # load into Supabase (live env vars)
 *
 * Demo mode on localhost reads data/ops-seed.local.json automatically when it exists.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import type { OpsSeed, SeedOrder } from "../src/lib/ops/snapshot";
import type { OrderStage, Product } from "../src/lib/ops/types";

type Cell = string | number | boolean | Date | null;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function plain(value: unknown): Cell {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }>; error?: unknown };
    if ("richText" in v && v.richText) return v.richText.map((p) => p.text).join("");
    if ("result" in v) return v.result instanceof Date ? v.result : plain(v.result);
    if ("text" in v) return plain(v.text);
    if ("error" in v) return null;
    return null;
  }
  if (typeof value === "string") return value.trim() || null;
  return value as Cell;
}

function key(header: Cell): string {
  return String(header ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Rows as objects keyed by the header row that contains every `must` label. */
function table(sheet: ExcelJS.Worksheet, must: string[], maxScan = 12): Array<Record<string, Cell>> {
  let headerRow = -1;
  let headers: string[] = [];
  for (let r = 1; r <= Math.min(maxScan, sheet.rowCount); r += 1) {
    const values = (sheet.getRow(r).values as unknown[]).map((v) => key(plain(v)));
    if (must.every((m) => values.includes(m))) {
      headerRow = r;
      headers = values;
      break;
    }
  }
  if (headerRow < 0) throw new Error(`Sheet “${sheet.name}” has no header row with ${must.join(", ")}`);
  const rows: Array<Record<string, Cell>> = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
    const values = sheet.getRow(r).values as unknown[];
    const row: Record<string, Cell> = {};
    let any = false;
    headers.forEach((header, i) => {
      const h = header || `#${i}`;
      if (h in row) return;
      const v = plain(values[i]);
      row[h] = v;
      if (v != null) any = true;
    });
    if (any) rows.push(row);
  }
  return rows;
}

const str = (v: Cell): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).trim() || null;
};
const num = (v: Cell): number | null => {
  if (v == null || v instanceof Date) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s/-]+$/g, "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const paise = (v: Cell): number => Math.max(0, Math.round((num(v) ?? 0) * 100));
const day = (v: Cell): string | null => {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    if (v.getUTCFullYear() > 2090 || v.getUTCFullYear() < 2015) return null;
    return v.toISOString().slice(0, 10);
  }
  return null;
};
const atNoonIst = (d: string) => `${d}T06:30:00.000Z`;
const sku = (v: Cell): string | null => {
  const s = str(v)?.toLowerCase();
  return s && /^ep-[a-z0-9-]+$/.test(s) ? s : null;
};

const HUB_ALIASES: Record<string, string> = { hsr: "HSR HQ", "hsr hq": "HSR HQ", hq: "HQ", jaynagar: "Jayanagar", jayanagar: "Jayanagar", hebbal: "Hebbal", kengeri: "Kengeri", mahadevpura: "Mahadevpura" };
const hub = (v: Cell): string | null => {
  const s = str(v);
  if (!s) return null;
  return HUB_ALIASES[s.toLowerCase()] ?? s;
};

const STAGE_FROM_DELIVERY: Record<string, OrderStage | "skip"> = {
  EPIK_DELIVERED: "delivered",
  BRAND_DEL_CX: "delivered",
  Replacement: "delivered",
  "Nothing to be physically delivered": "delivered",
  EPIK_CANCELLED: "cancelled",
  EPIK_RTV: "cancelled",
  EPIK_INTRANSIT_CX: "out_for_delivery",
  EPIK_OFD: "out_for_delivery",
  EPIK_HUB: "ready_to_dispatch",
  EPIK_RTS: "ready_to_dispatch",
  CONFIRMED: "ready_to_dispatch",
  EPIK_DEMO: "skip",
  "NOT CONFIRMED": "skip",
};

async function build(): Promise<OpsSeed> {
  const inventoryPath = arg("inventory");
  const installationPath = arg("installation");
  if (!inventoryPath) throw new Error("Pass --inventory <Inventory Tracker.xlsx>");
  const inventory = new ExcelJS.Workbook();
  await inventory.xlsx.readFile(inventoryPath);
  const sheet = (wb: ExcelJS.Workbook, name: string) => {
    const s = wb.getWorksheet(name);
    if (!s) throw new Error(`Missing tab “${name}”`);
    return s;
  };

  // Catalogue
  const products = new Map<string, Product>();
  for (const row of table(sheet(inventory, "SKU Codes"), ["generated sku", "product name"])) {
    const code = sku(row["generated sku"]);
    const name = str(row["product name"]);
    if (!code || !name) continue;
    const category = str(row["category (l1)"]);
    const gst = num(row["gst rate (%)"]);
    products.set(code, {
      sku: code,
      name,
      brand: str(row["brand"]),
      category,
      channel: null,
      listPriceMinor: num(row["bau (lp)"]) ? paise(row["bau (lp)"]) : null,
      gstRate: gst != null ? (gst > 1 ? gst / 100 : gst) : null,
      hsn: str(row["hsn code"]),
      eol: /eol|inactive/i.test(str(row["eol view"]) ?? ""),
      needsInstallation: /robo/i.test(category ?? "") || /robot vac|robo vac/i.test(name),
    });
  }
  const ensure = (code: string, name: string | null, brand: string | null = null) => {
    if (!products.has(code)) products.set(code, { sku: code, name: name ?? code, brand, category: null, channel: null, listPriceMinor: null, gstRate: null, hsn: null, eol: false, needsInstallation: /robot vac|robo vac/i.test(name ?? "") });
    return products.get(code)!;
  };

  // Stock on hand
  const stock: OpsSeed["stock"] = [];
  for (const row of table(sheet(inventory, "Current Stock"), ["sku code", "units"])) {
    const code = sku(row["sku code"]);
    const units = Math.round(num(row["units"]) ?? 0);
    if (!code) continue;
    const product = ensure(code, str(row["product name"]), str(row["brand"]));
    const channel = str(row["sor / cnc"]);
    if (channel) product.channel = /sor/i.test(channel) ? "SOR" : "CnC";
    if (units !== 0) stock.push({ sku: code, units, unitCostMinor: num(row["cogs / unit"]) ? paise(row["cogs / unit"]) : null });
  }

  // Open purchase orders
  const purchaseOrders: OpsSeed["purchaseOrders"] = [];
  for (const row of table(sheet(inventory, "In Transit"), ["po/pi id", "sku"])) {
    const code = sku(row["sku"]);
    const poNumber = str(row["po/pi id"]);
    if (!code || !poNumber) continue;
    ensure(code, str(row["product"]), str(row["brand"]));
    purchaseOrders.push({ poNumber, vendor: str(row["vendor"]), sku: code, productName: str(row["product"]), qtyOrdered: Math.round(num(row["qty ordered"]) ?? 0), qtyReceived: Math.round(num(row["qty received"]) ?? 0), eta: day(row["eta"]), createdAt: day(row["po date"]) ? atNoonIst(day(row["po date"])!) : null });
  }

  // Orders from the dispatch trackers (one order per Shopify id, several lines)
  const orders = new Map<string, SeedOrder>();
  for (const tab of ["Dispatch tracker", "Dispatch Tracker-September"]) {
    for (const row of table(sheet(inventory, tab), ["shopify order id", "sku code"])) {
      const status = str(row["delivery status"]) ?? "";
      const mapped = STAGE_FROM_DELIVERY[status];
      if (!mapped || mapped === "skip") continue;
      const shopify = str(row["shopify order id"]);
      const id = shopify ?? str(row["id"]);
      const invoice = day(row["invoice date"]);
      if (!id || !invoice) continue;
      const code = sku(row["sku code"]);
      if (code) ensure(code, str(row["product name"]));
      const offered = paise(row["offered price"]);
      const paid = paise(row["amount paid"]);
      const balance = paise(row["balance pending"]);
      const delivered = day(row["delivery date"]);
      const order = orders.get(id) ?? {
        key: id,
        shopifyOrderId: shopify?.startsWith("#") ? shopify : shopify ? `#${shopify}` : null,
        createdAt: atNoonIst(invoice),
        customerName: str(row["customer name"]) ?? "Unknown customer",
        phone: str(row["phonenumber"]),
        address: str(row["address"]),
        hub: hub(row["hub"]),
        poc: str(row["poc"]),
        stage: mapped,
        deliveredAt: mapped === "delivered" && delivered ? atNoonIst(delivered) : null,
        paidMinor: 0,
        codDueMinor: 0,
        declaredPaymentStatus: str(row["payment status"]),
        declaredPaymentMode: str(row["payment mode"]),
        holdReason: null,
        cancelReason: mapped === "cancelled" ? `Sheet status ${status}` : null,
        notes: str(row["remark"]),
        lines: [],
      };
      order.paidMinor += paid;
      order.codDueMinor += mapped === "delivered" ? 0 : balance;
      order.lines.push({
        sku: code,
        productName: str(row["product name"]) ?? code ?? "Unknown product",
        offeredPriceMinor: offered,
        serialNo: str(row["product serial #"]),
        status: mapped === "delivered" || mapped === "out_for_delivery" ? "dispatched" : mapped === "cancelled" ? "cancelled" : "reserved",
      });
      orders.set(id, order);
    }
  }

  // Booked but not yet delivered (lines still holding stock)
  for (const row of table(sheet(inventory, "Booked Orders"), ["order id", "sku"])) {
    const shopify = str(row["order id"]);
    const code = sku(row["sku"]);
    const logistic = str(row["logistic status"]) ?? "CONFIRMED";
    const delivery = str(row["delivery status"]) ?? "";
    if (!shopify || !code) continue;
    if (["EPIK_DELIVERED", "BRAND_DEL_CX", "EPIK_CANCELLED", "EPIK_RTV"].includes(logistic) || /^delivered/i.test(delivery)) continue;
    const left = day(row["left warehouse on"]);
    const stage: OrderStage = /fraud/i.test(delivery) ? "on_hold" : left ? "out_for_delivery" : "ready_to_dispatch";
    const product = ensure(code, null);
    const invoice = day(row["invoice date"]) ?? new Date().toISOString().slice(0, 10);
    const existing = orders.get(shopify);
    if (existing && existing.lines.some((l) => l.sku === code)) continue;
    const order: SeedOrder = existing ?? {
      key: shopify,
      shopifyOrderId: shopify,
      createdAt: atNoonIst(invoice),
      customerName: `Customer on ${shopify}`,
      phone: null,
      address: null,
      hub: null,
      poc: null,
      stage,
      deliveredAt: null,
      paidMinor: 0,
      codDueMinor: 0,
      declaredPaymentStatus: null,
      declaredPaymentMode: null,
      holdReason: stage === "on_hold" ? "Marked Fraud TXN in the sheet." : null,
      cancelReason: null,
      notes: `Imported from Booked Orders (${logistic} / ${delivery || "no delivery status"}). Customer details and offered price are in the sales sheet, which was not imported; list price shown.`,
      lines: [],
    };
    order.lines.push({ sku: code, productName: product.name, offeredPriceMinor: product.listPriceMinor ?? 0, serialNo: null, status: stage === "out_for_delivery" ? "dispatched" : "reserved" });
    orders.set(shopify, order);
  }

  // Installation tracker: fills customer details for booked orders and adds installation history
  const installations: OpsSeed["installations"] = [];
  if (installationPath) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(installationPath);
    const rows = table(sheet(wb, "Installation Tracker"), ["customer name", "installation status"]);
    for (const row of rows) {
      const shopify = str(row["order id"] ?? row["#1"] ?? null);
      if (!shopify || !/^#?PIK\d+/i.test(shopify)) continue;
      const id = shopify.startsWith("#") ? shopify : `#${shopify}`;
      const code = sku(row["sku code"]);
      const delivered = day(row["delivered date"]);
      let order = orders.get(id);
      if (!order && delivered) {
        const name = str(row["product name"]);
        if (code) ensure(code, name && !/^https?:/.test(name) ? name : null, str(row["brand"]));
        const product = code ? products.get(code) : null;
        order = {
          key: id, shopifyOrderId: id, createdAt: atNoonIst(delivered), customerName: str(row["customer name"]) ?? "Unknown customer",
          phone: str(row["phone number"]), address: str(row["address"]), hub: null, poc: str(row["sales poc"]), stage: "delivered",
          deliveredAt: atNoonIst(delivered), paidMinor: 0, codDueMinor: paise(row["balance pending"]), declaredPaymentStatus: str(row["payment status"]),
          declaredPaymentMode: null, holdReason: null, cancelReason: null, notes: "Imported from Installation Tracker; offered price not in that sheet, list price shown.",
          lines: [{ sku: code, productName: product?.name ?? name ?? "Robot vacuum", offeredPriceMinor: product?.listPriceMinor ?? 0, serialNo: null, status: "dispatched" }],
        };
        orders.set(id, order);
      } else if (order && order.customerName.startsWith("Customer on")) {
        order.customerName = str(row["customer name"]) ?? order.customerName;
        order.phone = str(row["phone number"]);
        order.address = str(row["address"]);
        order.poc = str(row["sales poc"]);
      }
      const status = str(row["installation status"]) ?? "";
      const due = day(row["tat deadline"]) ?? delivered;
      if (!due) continue;
      installations.push({
        shopifyOrderId: id,
        sku: code,
        status: /^installed/i.test(status) ? "done" : /not required/i.test(status) ? "not_required" : "pending",
        dueDate: due,
        doneAt: day(row["installation date"]) ? atNoonIst(day(row["installation date"])!) : /^installed/i.test(status) ? atNoonIst(due) : null,
        technician: str(row["installation poc"]) ?? str(row["to be installed by"]),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: [inventoryPath, installationPath].filter(Boolean).join(" + "),
    products: [...products.values()],
    stock,
    purchaseOrders,
    orders: [...orders.values()].filter((o) => o.lines.length),
    installations,
  };
}

async function push(seedPath: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const { SupabaseOpsStore } = await import("../src/lib/ops/supabase-store");
  const { loadSeed } = await import("../src/lib/ops/snapshot");
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyValue = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !keyValue) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for example: set -a; source .env.local; set +a).");
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as OpsSeed;
  const store = new SupabaseOpsStore(createClient(url, keyValue, { auth: { persistSession: false } }));
  const report = await loadSeed(store, seed, { onProgress: (m) => console.log(m) });
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  if (process.argv.includes("--push")) {
    await push(arg("seed") ?? "data/ops-seed.local.json");
    return;
  }
  const seed = await build();
  const out = arg("out") ?? "data/ops-seed.local.json";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(seed));
  const open = seed.orders.filter((o) => !["delivered", "cancelled"].includes(o.stage)).length;
  console.log(`Wrote ${out}: ${seed.products.length} products, ${seed.stock.length} stock rows (${seed.stock.reduce((s, r) => s + Math.max(0, r.units), 0)} units), ${seed.purchaseOrders.length} PO lines, ${seed.orders.length} orders (${open} open), ${seed.installations.length} installations.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
