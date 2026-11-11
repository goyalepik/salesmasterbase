"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { syncOrderToSlack } from "@/lib/slack/sync";
import type { OrderStage } from "@/lib/ops/types";
import { cookies } from "next/headers";
import { getOpsStore } from "@/lib/ops";
import {
  addNote,
  cancelOrder,
  clearForFulfilment,
  clearTestOrders,
  completeInstallation,
  correctStock,
  createPurchaseOrder,
  decideLine,
  markDelivered,
  markProcurementOrdered,
  outForDelivery,
  receiveProcurement,
  receivePurchaseOrder,
  receiveStock,
  recordPayment,
  savePerson,
  saveProduct,
  STOCK_IN_REASONS,
  type StockInReason,
  setLineSku,
  setShopifyId,
  type LineDecision,
} from "@/lib/ops/service";
import { HUBS, PAYMENT_KINDS, PAYMENT_MODES, ROLES, type PaymentKind, type Role } from "@/lib/ops/types";
import type { ActionResult } from "@/lib/ops-ui/action-result";
import { ACTOR_COOKIE, cleanActorName, currentActor } from "@/lib/ops-ui/actor";
import { formRupeesToMinor } from "@/lib/ops-ui/format";
import { shopifyConfigFromEnv, shopifyGraphql } from "@/lib/shopify/client";
import { pushOrderToShopify } from "@/lib/shopify/drafts";
import { practiceWebsiteOrder, refreshShopifyCatalog, syncShopify, syncShopifyPayment } from "@/lib/shopify/run";
import { readEnv } from "@/lib/env";
import { webSlackClient } from "@/lib/slack/slack-client";

// Every action re-reads the order from the store and lets the service apply the rules.
// The form only says which record and what change.

function text(form: FormData, key: string, max = 200): string {
  const value = form.get(key);
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function id(form: FormData, key: string): string {
  const value = text(form, key, 80);
  return /^[\w.:#-]+$/.test(value) ? value : "";
}

function date(form: FormData, key: string): string | null {
  const value = text(form, key, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

type Outcome = { ok: true; message: string; value?: unknown } | { ok: false; error: string };

/** Finds which order a form is about, so the Slack card can be refreshed afterwards. */
async function orderOf(form: FormData | undefined): Promise<{ id: string; stage: OrderStage } | null> {
  if (!form) return null;
  const ops = await getOpsStore();
  if (!ops) return null;
  let orderId = id(form, "orderId");
  if (!orderId && id(form, "lineId")) orderId = (await ops.getLine(id(form, "lineId")))?.orderId ?? "";
  if (!orderId && id(form, "requestId")) orderId = (await ops.getProcurement(id(form, "requestId")))?.orderId ?? "";
  if (!orderId && id(form, "installationId")) return null;
  const order = orderId ? await ops.getOrder(orderId) : null;
  return order ? { id: order.id, stage: order.stage } : null;
}

async function run(work: () => Promise<Outcome>, form?: FormData): Promise<ActionResult> {
  try {
    const before = await orderOf(form);
    const result = await work();
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    const ops = await getOpsStore();
    if (ops) {
      const reserved = (result.value as { reserved?: unknown } | undefined)?.reserved;
      const targets: Array<[string, OrderStage | null]> = before ? [[before.id, before.stage]] : [];
      if (Array.isArray(reserved)) for (const orderId of reserved) if (typeof orderId === "string") targets.push([orderId, "awaiting_stock"]);
      if (targets.length) after(async () => { for (const [orderId, stage] of targets) await syncOrderToSlack(ops, orderId, stage); });
      // Payment status → Shopify for #PIK orders (switch SHOPIFY_PAYMENT_SYNC; does nothing otherwise).
      if (before) after(() => syncShopifyPayment(ops, before.id));
    }
    return { ok: true, message: result.message };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message: `Something went wrong. Nothing was changed. (${detail.slice(0, 160)})` };
  }
}

async function store() {
  const ops = await getOpsStore();
  if (!ops) throw new Error("The operations database is not configured.");
  return ops;
}

const fail = (error: string) => ({ ok: false as const, error });

// ── Acting as ────────────────────────────────────────────────────────────────

export async function setActorAction(form: FormData): Promise<ActionResult> {
  const name = cleanActorName(form.get("name"));
  const jar = await cookies();
  if (!name) {
    jar.delete(ACTOR_COOKIE);
    return { ok: true, message: "Acting as Dashboard." };
  }
  jar.set(ACTOR_COOKIE, encodeURIComponent(name), { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  return { ok: true, message: `Acting as ${name}.` };
}

// ── RevOps ───────────────────────────────────────────────────────────────────

export async function verifyPaymentAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const orderId = id(form, "orderId");
    const amountMinor = formRupeesToMinor(form.get("amount"));
    const mode = text(form, "mode", 20);
    const kind = text(form, "kind", 20) as PaymentKind;
    if (!orderId) return fail("Order not found.");
    if (!amountMinor) return fail("Enter the amount received in rupees, for example 25000.");
    if (!(PAYMENT_MODES as readonly string[]).includes(mode)) return fail("Choose the payment mode.");
    if (!PAYMENT_KINDS.includes(kind)) return fail("Choose what the payment is for.");
    const reference = text(form, "reference", 80) || null;
    const clear = form.get("clear") === "on";
    return recordPayment(await store(), orderId, { amountMinor, mode, kind, reference, clear }, await currentActor());
  }, form);
}

export async function clearWithoutPaymentAction(form: FormData): Promise<ActionResult> {
  return run(async () => clearForFulfilment(await store(), id(form, "orderId"), text(form, "reason", 300), await currentActor()), form);
}

// ── Inventory ────────────────────────────────────────────────────────────────

export async function decideLineAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const lineId = id(form, "lineId");
    if (!lineId) return fail("Product line not found.");
    const type = text(form, "decision", 20);
    let decision: LineDecision;
    switch (type) {
      case "reserve":
        decision = { type: "reserve" };
        break;
      case "brand_direct":
        decision = { type: "brand_direct" };
        break;
      case "hold_po": {
        const poId = id(form, "poId");
        if (!poId) return fail("Choose a purchase order.");
        decision = { type: "hold_po", poId };
        break;
      }
      case "procure": {
        const costRaw = text(form, "cost", 20);
        const costMinor = costRaw ? formRupeesToMinor(costRaw) : null;
        if (costRaw && costMinor == null) return fail("Cost should be a number in rupees.");
        decision = { type: "procure", vendor: text(form, "vendor", 80), costMinor, eta: date(form, "eta") };
        break;
      }
      case "reject":
        decision = { type: "reject", reason: text(form, "reason", 300) };
        break;
      default:
        return fail("Choose what to do with this product.");
    }
    return decideLine(await store(), lineId, decision, await currentActor());
  }, form);
}

export async function mapSkuAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const sku = text(form, "sku", 80);
    if (!sku) return fail("Pick a product from the list first.");
    return setLineSku(await store(), id(form, "lineId"), sku, await currentActor());
  }, form);
}

// ── Procurement ──────────────────────────────────────────────────────────────

export async function procurementOrderedAction(form: FormData): Promise<ActionResult> {
  return run(async () =>
    markProcurementOrdered(await store(), id(form, "requestId"), { poNumber: text(form, "poNumber", 40) || null, eta: date(form, "eta") }, await currentActor()),
    form,
  );
}

export async function procurementReceivedAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const costRaw = text(form, "cost", 20);
    const unitCostMinor = costRaw ? formRupeesToMinor(costRaw) : null;
    if (costRaw && unitCostMinor == null) return fail("Cost should be a number in rupees.");
    return receiveProcurement(await store(), id(form, "requestId"), { serialNo: text(form, "serial", 80) || null, unitCostMinor }, await currentActor());
  }, form);
}

export async function receivePoAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const qty = Number(text(form, "qty", 6));
    const serials = text(form, "serials", 2000)
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const costRaw = text(form, "cost", 20);
    const unitCostMinor = costRaw ? formRupeesToMinor(costRaw) : null;
    if (costRaw && unitCostMinor == null) return fail("Cost should be a number in rupees.");
    return receivePurchaseOrder(await store(), id(form, "poId"), { qty, serials, unitCostMinor }, await currentActor());
  }, form);
}

// ── Stock in ─────────────────────────────────────────────────────────────────

function serialList(form: FormData, key: string): string[] {
  return text(form, key, 4000)
    .split(/[,\s]+/)
    .map((s) => s.trim().slice(0, 80))
    .filter(Boolean);
}

function optionalRupees(form: FormData, key: string): { ok: true; value: number | null } | { ok: false } {
  const raw = text(form, key, 20);
  if (!raw) return { ok: true, value: null };
  const value = formRupeesToMinor(raw);
  return value == null ? { ok: false } : { ok: true, value };
}

export async function saveProductAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const price = optionalRupees(form, "listPrice");
    if (!price.ok) return fail("List price should be a number in rupees.");
    return saveProduct(
      await store(),
      { sku: text(form, "sku", 60), name: text(form, "name", 160), brand: text(form, "brand", 60) || null, category: text(form, "category", 60) || null, listPriceMinor: price.value, needsInstallation: form.get("needsInstallation") === "on" },
      await currentActor(),
    );
  });
}

export async function createPoAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const lines: Array<{ sku: string; qty: number }> = [];
    for (let i = 0; i < 10; i += 1) {
      const sku = text(form, `sku_${i}`, 60);
      const qtyRaw = text(form, `qty_${i}`, 6);
      if (!sku && !qtyRaw) continue;
      if (!sku) return fail(`Pick product ${i + 1} from the list.`);
      lines.push({ sku, qty: Number(qtyRaw) });
    }
    return createPurchaseOrder(await store(), { poNumber: text(form, "poNumber", 40), vendor: text(form, "vendor", 80), eta: date(form, "eta"), lines }, await currentActor());
  });
}

export async function receiveStockAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const sku = text(form, "sku", 60);
    if (!sku) return fail("Pick the product from the list.");
    const reason = text(form, "reason", 20) as StockInReason;
    if (!STOCK_IN_REASONS.includes(reason)) return fail("Choose why the stock came in.");
    const cost = optionalRupees(form, "cost");
    if (!cost.ok) return fail("Cost should be a number in rupees.");
    return receiveStock(await store(), { sku, qty: Number(text(form, "qty", 6)), reason, note: text(form, "note", 200), serials: serialList(form, "serials"), unitCostMinor: cost.value }, await currentActor());
  });
}

type BillSaveLine = { sku: string; qty: number; unitCostMinor: number | null; serials: string[]; poId: string | null };

/** Saves the lines of a bill the AI read, after the person checked them. Each line goes through the normal stock rules. */
export async function importBillAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    let payload: { vendor?: unknown; invoiceNo?: unknown; lines?: unknown };
    try {
      payload = JSON.parse(text(form, "payload", 100_000));
    } catch {
      return fail("The bill could not be saved. Read it again.");
    }
    const lines = (Array.isArray(payload.lines) ? payload.lines : []).slice(0, 40) as BillSaveLine[];
    if (!lines.length) return fail("Nothing to add. Tick at least one line.");
    const where = [typeof payload.vendor === "string" ? payload.vendor.slice(0, 80) : "", typeof payload.invoiceNo === "string" ? `bill ${payload.invoiceNo.slice(0, 40)}` : ""].filter(Boolean).join(", ");
    const ops = await store();
    const actor = await currentActor();
    const done: string[] = [];
    const failed: string[] = [];
    const reserved: string[] = [];
    for (const [index, line] of lines.entries()) {
      const qty = Number(line.qty);
      const serials = (Array.isArray(line.serials) ? line.serials : []).map((s) => String(s).trim().slice(0, 80)).filter(Boolean);
      const cost = typeof line.unitCostMinor === "number" && line.unitCostMinor > 0 ? Math.round(line.unitCostMinor) : null;
      const result = line.poId
        ? await receivePurchaseOrder(ops, String(line.poId), { qty, serials, unitCostMinor: cost }, actor)
        : await receiveStock(ops, { sku: String(line.sku ?? ""), qty, reason: "purchase", note: where, serials, unitCostMinor: cost }, actor);
      if (result.ok) {
        done.push(String(line.sku));
        const value = result.value as { reserved?: string[] } | null | undefined;
        if (value && Array.isArray(value.reserved)) reserved.push(...value.reserved);
      } else {
        failed.push(`line ${index + 1}: ${result.error}`);
      }
    }
    if (!done.length) return fail(`Nothing was added. ${failed.join(" ")}`);
    const units = lines.filter((_, i) => !failed.some((f) => f.startsWith(`line ${i + 1}:`))).reduce((sum, l) => sum + Number(l.qty), 0);
    const message = `${units} ${units === 1 ? "unit" : "units"} added from the bill${reserved.length ? `, ${reserved.length} waiting ${reserved.length === 1 ? "order" : "orders"} reserved` : ""}.${failed.length ? ` Not added: ${failed.join(" ")}` : ""}`;
    return { ok: true, message, value: { reserved } };
  });
}

export async function correctStockAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const sku = text(form, "sku", 60);
    if (!sku) return fail("Pick the product from the list.");
    const direction = text(form, "direction", 10) === "remove" ? -1 : 1;
    const qty = Number(text(form, "qty", 6));
    return correctStock(await store(), { sku, delta: direction * qty, reason: text(form, "reason", 200) }, await currentActor());
  });
}

// ── Logistics ────────────────────────────────────────────────────────────────

export async function outForDeliveryAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const serials: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("serial_") && typeof value === "string" && value.trim()) serials[key.slice(7)] = value.trim().slice(0, 80);
    }
    return outForDelivery(await store(), id(form, "orderId"), { driver: text(form, "driver", 60), serials, expectedDate: date(form, "expectedDate") }, await currentActor());
  }, form);
}

export async function deliveredAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const raw = text(form, "collected", 20);
    const collectedMinor = raw ? formRupeesToMinor(raw) : 0;
    if (collectedMinor == null) return fail("Collected amount should be a number in rupees. Use 0 if nothing was collected.");
    const mode = text(form, "mode", 20);
    if (collectedMinor > 0 && !(PAYMENT_MODES as readonly string[]).includes(mode)) return fail("Choose how the money was collected.");
    return markDelivered(await store(), id(form, "orderId"), { collectedMinor, mode: collectedMinor > 0 ? mode : null }, await currentActor());
  }, form);
}

export async function completeInstallationAction(form: FormData): Promise<ActionResult> {
  return run(async () =>
    completeInstallation(
      await store(),
      id(form, "installationId"),
      { technician: text(form, "technician", 60), note: text(form, "note", 300) || null, notRequired: form.get("notRequired") === "on" },
      await currentActor(),
    ),
    form,
  );
}

// ── Any stage ────────────────────────────────────────────────────────────────

export async function cancelOrderAction(form: FormData): Promise<ActionResult> {
  return run(async () => cancelOrder(await store(), id(form, "orderId"), text(form, "reason", 300), await currentActor()), form);
}

export async function shopifyAction(form: FormData): Promise<ActionResult> {
  return run(async () => setShopifyId(await store(), id(form, "orderId"), text(form, "shopifyId", 20), await currentActor()), form);
}

/** Makes this order's Shopify draft by hand (when auto drafts are off, or a first try failed). */
export async function createShopifyDraftAction(form: FormData): Promise<ActionResult> {
  const cfg = shopifyConfigFromEnv();
  if (!cfg) return { ok: false, message: "Shopify isn't connected yet. Add SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET first." };
  // Same kind as Slack sales: a real order with payment pending when that is switched on, otherwise a draft.
  const mode = cfg.slackSales === "order" ? "order" : "draft";
  return run(async () => {
    const outcome = await pushOrderToShopify(await store(), shopifyGraphql(cfg), id(form, "orderId"), mode, await currentActor());
    if (!outcome.ok) return fail(outcome.message);
    return { ok: true, message: outcome.orderName ? outcome.message : `${outcome.message} Complete it in Shopify, Orders, Drafts.` };
  }, form);
}

/** Checks Shopify now: new website orders, and #PIK numbers of completed drafts. */
export async function checkShopifyAction(): Promise<ActionResult> {
  return run(async () => {
    const ops = await store();
    const result = await syncShopify(ops, true);
    if (!result.ran) return fail("Shopify isn't connected yet.");
    // The product list for the Slack form takes ~10 seconds: refresh it after the answer.
    after(() => refreshShopifyCatalog(ops, true));
    if (result.error) return fail(`Couldn't reach Shopify: ${result.error}`);
    const parts = [
      result.created.length ? `${result.created.length} new website order${result.created.length === 1 ? "" : "s"} added` : "",
      result.linked.length ? `${result.linked.length} #PIK number${result.linked.length === 1 ? "" : "s"} linked` : "",
      result.cancelled ? `${result.cancelled} cancelled on Shopify, so cancelled here` : "",
      result.flagged.length ? `${result.flagged.length} cancelled on Shopify after dispatch (see the order notes)` : "",
      result.paymentUpdated ? `${result.paymentUpdated} payment status${result.paymentUpdated === 1 ? "" : "es"} updated from Shopify` : "",
      result.matched ? `${result.matched} credited to the CDE who posted the website sale` : "",
    ].filter(Boolean);
    return { ok: true, message: parts.length ? `Shopify checked: ${parts.join(", ")}.` : "Shopify checked. Nothing new." };
  });
}

// ── Test mode ────────────────────────────────────────────────────────────────

/** Settings → Clear test orders: removes TEST orders and website forms, and their cards in Slack. */
export async function clearTestOrdersAction(): Promise<ActionResult> {
  return run(async () => {
    const result = await clearTestOrders(await store(), await currentActor());
    if (!result.ok) return result;
    const env = readEnv();
    const token = env.mode.ok && env.mode.mode === "live" ? env.slackBotToken : null;
    if (token && result.value.orders.length) {
      after(async () => {
        const slack = webSlackClient(token);
        for (const order of result.value.orders) {
          if (order.slackChannelId && order.slackMessageTs) await slack.deleteMessage?.({ channel: order.slackChannelId, ts: order.slackMessageTs });
        }
      });
    }
    return result;
  });
}

/** Settings → Practice website order: a pretend website order for this phone, to show the CDE credit without Shopify. */
export async function practiceWebsiteOrderAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const priceMinor = formRupeesToMinor(text(form, "price", 20)) ?? 0;
    const result = await practiceWebsiteOrder(await store(), { phone: text(form, "phone", 20), sku: text(form, "sku", 80) || null, productName: text(form, "product", 200), priceMinor });
    if (!result.ok) return fail(result.error);
    return {
      ok: true,
      message: result.creditedTo
        ? `Practice website order ${result.practiceName} is ${result.orderId}. Credited to ${result.creditedTo}; the note is in their Slack thread.`
        : `Practice website order ${result.practiceName} is ${result.orderId}. No website form for this phone yet: post one in Slack and it is credited straight away.`,
    };
  });
}

export async function noteAction(form: FormData): Promise<ActionResult> {
  return run(async () => addNote(await store(), id(form, "orderId"), text(form, "note", 500), await currentActor()), form);
}

// ── Team roles ───────────────────────────────────────────────────────────────

export async function savePersonAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const slackUserId = text(form, "slackUserId", 20).toUpperCase();
    const name = text(form, "name", 60);
    const roles = form.getAll("roles").filter((r): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r));
    const hubRaw = text(form, "hub", 30);
    const hub = (HUBS as readonly string[]).includes(hubRaw) ? hubRaw : null;
    if (!/^[UW][A-Z0-9]{6,}$/.test(slackUserId)) return fail("Slack user ID looks like U04ABCDEF. Find it in Slack: profile → ⋮ → Copy member ID.");
    if (name.length < 2) return fail("Enter the person's name.");
    await savePerson(await store(), { slackUserId, name, roles, hub });
    return { ok: true, message: roles.length ? `Saved ${name}: ${roles.join(", ")}.` : `Saved ${name} with no roles. They cannot press Slack buttons.` };
  });
}
