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
  completeInstallation,
  decideLine,
  markDelivered,
  markProcurementOrdered,
  outForDelivery,
  receiveProcurement,
  receivePurchaseOrder,
  recordPayment,
  savePerson,
  setLineSku,
  setShopifyId,
  type LineDecision,
} from "@/lib/ops/service";
import { HUBS, PAYMENT_KINDS, PAYMENT_MODES, ROLES, type PaymentKind, type Role } from "@/lib/ops/types";
import type { ActionResult } from "@/lib/ops-ui/action-result";
import { ACTOR_COOKIE, cleanActorName, currentActor } from "@/lib/ops-ui/actor";
import { formRupeesToMinor } from "@/lib/ops-ui/format";

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
