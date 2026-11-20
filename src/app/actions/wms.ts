"use server";

import { refresh } from "next/cache";
import { getWms } from "@/features/wms";
import { addMaster, checkScan, createPo, setMasterActive, submitGrn, type GrnInput, type NewPoLine, type ScanCheck } from "@/features/wms/service";
import { MASTER_KINDS, type MasterKind } from "@/features/wms/domain/types";
import { isCondition } from "@/features/wms/domain/unit";
import type { ActionResult } from "@/lib/ops-ui/action-result";
import { currentActor } from "@/lib/ops-ui/actor";
import { formRupeesToMinor } from "@/lib/ops-ui/format";

import {
  checkDispatchScan,
  countScan,
  dispatchOrder,
  finishCount,
  openRma,
  rmaStep,
  sendToVendor,
  setUnitStatus,
  settleCount,
  shipmentBack,
  shipmentDelivered,
  shipmentFailed,
  startCount,
  type Carrier,
  type DispatchScan,
  type RmaStep,
} from "@/features/wms/flows";
import { createOpeningUnits } from "@/features/wms/insights";
import { RMA_TYPES, type RmaType } from "@/features/wms/domain/types";
import { UNIT_STATUSES, type Condition, type UnitStatus } from "@/features/wms/domain/unit";
import type { Result } from "@/lib/ops/service";

// Warehouse actions. Each one re-reads from the store and lets the WMS service apply the rules.

const OFF: ActionResult = { ok: false, message: "The warehouse screens aren't switched on." };

function text(form: FormData, key: string, max = 200): string {
  const value = form.get(key);
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

async function guard<T extends ActionResult>(work: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await work();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message: `Something went wrong. Nothing was changed. (${detail.slice(0, 160)})` };
  }
}

/** Checks one scan while the receipt is being built. Nothing is saved. */
export async function checkScanAction(input: { sku: string; serial: string; batch: string[] }): Promise<ScanCheck> {
  const ctx = await getWms();
  if (!ctx) return { ok: false, reason: OFF.message, kind: "format" };
  const batch = Array.isArray(input.batch) ? input.batch.filter((s): s is string => typeof s === "string").slice(0, 2000) : [];
  return checkScan(ctx, { sku: String(input.sku ?? "").slice(0, 60), serial: String(input.serial ?? "").slice(0, 120), batch });
}

export type GrnActionResult = ActionResult & { grn?: string };

/** Saves a goods receipt (the scan screen sends the whole receipt at once). */
export async function submitGrnAction(raw: GrnInput): Promise<GrnActionResult> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const items = Array.isArray(raw.items) ? raw.items.slice(0, 2000) : [];
    const input: GrnInput = {
      clientId: String(raw.clientId ?? ""),
      poNumber: String(raw.poNumber ?? "").slice(0, 60),
      invoiceNo: raw.invoiceNo ? String(raw.invoiceNo) : null,
      invoicePending: !!raw.invoicePending,
      notes: raw.notes ? String(raw.notes).slice(0, 300) : null,
      items: items.map((i) => ({
        sku: String(i.sku ?? "").slice(0, 60),
        serial: i.serial == null ? null : String(i.serial).slice(0, 120),
        serialSource: i.serialSource === "manual" || i.serialSource === "internal" ? i.serialSource : "scan",
        condition: isCondition(i.condition) ? i.condition : "good",
        remark: i.remark ? String(i.remark).slice(0, 200) : null,
        photo: typeof i.photo === "string" ? i.photo : null,
        altId: i.altId ? String(i.altId).slice(0, 60) : null,
      })),
      counts: (Array.isArray(raw.counts) ? raw.counts : []).slice(0, 100).map((c) => ({ sku: String(c.sku ?? "").slice(0, 60), qty: Number(c.qty) })),
    };
    const result = await submitGrn(ctx, input, await currentActor());
    if (!result.ok) return { ok: false, message: result.error };
    // No refresh here: the screen shows its own "saved" box (a refresh would swap the page away first).
    return { ok: true, message: result.message, grn: result.value.number };
  });
}

export type PoActionResult = ActionResult & { poNumber?: string };

export async function createPoAction(form: FormData): Promise<PoActionResult> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const lines: NewPoLine[] = [];
    for (let i = 0; i < 20; i++) {
      const sku = text(form, `sku_${i}`, 60);
      if (!sku) continue;
      const qty = Number(text(form, `qty_${i}`, 6));
      if (!Number.isInteger(qty) || qty <= 0 || qty > 10_000) return { ok: false, message: `Enter the units for product ${i + 1}.` };
      const costRaw = text(form, `cost_${i}`, 20);
      const unitCostMinor = costRaw ? formRupeesToMinor(costRaw) : null;
      if (costRaw && unitCostMinor == null) return { ok: false, message: `The price for product ${i + 1} should be in rupees.` };
      const own = text(form, `own_${i}`, 4);
      lines.push({ sku, qty, unitCostMinor, ownership: own === "SOR" || own === "CnC" ? own : null });
    }
    const priority = text(form, "priority", 10);
    const result = await createPo(
      ctx,
      {
        poNumber: text(form, "poNumber", 40) || null,
        vendor: text(form, "vendor", 80),
        hub: text(form, "hub", 60),
        billedTo: text(form, "billedTo", 60) || null,
        paymentTerms: text(form, "paymentTerms", 60) || null,
        priority: priority === "high" || priority === "urgent" ? priority : "normal",
        eta: text(form, "eta", 10) || null,
        notes: text(form, "notes", 300) || null,
        lines,
      },
      await currentActor(),
    );
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    return { ok: true, message: result.message, poNumber: result.value.poNumber };
  });
}

export async function addMasterAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const kind = text(form, "kind", 30) as MasterKind;
    if (!MASTER_KINDS.includes(kind)) return { ok: false, message: "Choose a list." };
    const result = await addMaster(ctx, kind, text(form, "name", 80), await currentActor());
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    return { ok: true, message: result.message };
  });
}

export async function setMasterActiveAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const result = await setMasterActive(ctx, text(form, "id", 60), text(form, "active", 5) === "yes", await currentActor());
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    return { ok: true, message: result.message };
  });
}

// ── Phase 2 to 5 ─────────────────────────────────────────────────────────────

function carrierFrom(form: FormData): Carrier {
  return {
    carrier: text(form, "carrier", 4) === "3pl" ? "3pl" : "own",
    partner: text(form, "partner", 60) || null,
    driver: text(form, "driver", 60) || null,
    awb: text(form, "awb", 60) || null,
    trackingUrl: text(form, "trackingUrl", 300) || null,
    expectedDate: text(form, "expectedDate", 10) || null,
    note: text(form, "note", 300) || null,
  };
}

async function act<T>(work: (ctx: NonNullable<Awaited<ReturnType<typeof getWms>>>) => Promise<Result<T>>): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const result = await work(ctx);
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    return { ok: true, message: result.message };
  });
}

const money = (form: FormData, key: string) => {
  const raw = text(form, key, 20);
  return raw ? formRupeesToMinor(raw) : null;
};

export async function checkDispatchScanAction(input: { orderId: string; serial: string; already: Array<{ lineId: string; serial: string }> }): Promise<DispatchScan> {
  const ctx = await getWms();
  if (!ctx) return { ok: false, reason: OFF.message };
  const already = (Array.isArray(input.already) ? input.already : []).slice(0, 500).map((a) => ({ lineId: String(a.lineId ?? ""), serial: String(a.serial ?? "") }));
  return checkDispatchScan(ctx, String(input.orderId ?? "").slice(0, 40), String(input.serial ?? "").slice(0, 120), already);
}

export type DispatchActionInput = Carrier & { orderId: string; units: Array<{ lineId: string; serial: string }> };

export async function dispatchAction(raw: DispatchActionInput): Promise<ActionResult & { shipment?: string }> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const result = await dispatchOrder(
      ctx,
      {
        orderId: String(raw.orderId ?? "").slice(0, 40),
        units: (Array.isArray(raw.units) ? raw.units : []).slice(0, 200).map((u) => ({ lineId: String(u.lineId ?? ""), serial: String(u.serial ?? "").slice(0, 120) })),
        carrier: raw.carrier === "3pl" ? "3pl" : "own",
        partner: raw.partner ? String(raw.partner).slice(0, 60) : null,
        driver: raw.driver ? String(raw.driver).slice(0, 60) : null,
        awb: raw.awb ? String(raw.awb).slice(0, 60) : null,
        trackingUrl: raw.trackingUrl ? String(raw.trackingUrl).slice(0, 300) : null,
        expectedDate: raw.expectedDate ? String(raw.expectedDate).slice(0, 10) : null,
        note: raw.note ? String(raw.note).slice(0, 300) : null,
      },
      await currentActor(),
    );
    if (!result.ok) return { ok: false, message: result.error };
    // No refresh here: the screen shows its own "sent" box (a refresh would swap the page away first).
    return { ok: true, message: result.message, shipment: result.value.number };
  });
}

export async function shipmentAction(form: FormData): Promise<ActionResult> {
  const number = text(form, "number", 30);
  const step = text(form, "step", 12);
  return act(async (ctx) => {
    const actor = await currentActor();
    if (step === "delivered") return shipmentDelivered(ctx, number, { collectedMinor: money(form, "collected") ?? 0, mode: text(form, "mode", 20) || null }, actor);
    if (step === "failed") return shipmentFailed(ctx, number, text(form, "reason", 200), actor);
    return shipmentBack(ctx, number, actor);
  });
}

export async function openRmaAction(form: FormData): Promise<ActionResult & { href?: string }> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const type = text(form, "type", 20) as RmaType;
    const r = await openRma(ctx, { serial: text(form, "serial", 120), type: RMA_TYPES.includes(type) ? type : "replacement", reason: text(form, "reason", 60), description: text(form, "description", 500) || null, brandTicket: text(form, "brandTicket", 60) || null }, await currentActor());
    if (!r.ok) return { ok: false, message: r.error };
    refresh();
    return { ok: true, message: r.message, href: `/wms/returns/${r.value.number}` };
  });
}

export async function rmaStepAction(form: FormData): Promise<ActionResult> {
  const number = text(form, "number", 30);
  const step = text(form, "step", 12);
  const note = text(form, "note", 300) || null;
  let s: RmaStep;
  if (step === "approve" || step === "reject" || step === "close") s = { step, note };
  else if (step === "pickup") s = { step, partner: text(form, "partner", 60) || null, awb: text(form, "awb", 60) || null, trackingUrl: text(form, "trackingUrl", 300) || null };
  else if (step === "receive") s = { step, serial: text(form, "serial", 120), condition: text(form, "condition", 20) as Condition, note, override: text(form, "override", 3) === "yes" };
  else if (step === "dispose") s = { step, to: text(form, "to", 30) as UnitStatus, note };
  else if (step === "replace") s = { step, serial: text(form, "serial", 120), ...carrierFrom(form) };
  else s = { step: "money", refundMinor: money(form, "refund"), shippingCostMinor: money(form, "shipping"), repairCostMinor: money(form, "repair"), recoveredMinor: money(form, "recovered") };
  return act(async (ctx) => rmaStep(ctx, number, s, await currentActor()));
}

export async function sendToVendorAction(form: FormData): Promise<ActionResult> {
  const serials = form.getAll("serial").filter((v): v is string => typeof v === "string").slice(0, 200);
  return act(async (ctx) => sendToVendor(ctx, { serials, vendor: text(form, "vendor", 80), creditNoteMinor: money(form, "creditNote"), ...carrierFrom(form) }, await currentActor()));
}

export async function setUnitStatusAction(form: FormData): Promise<ActionResult> {
  const to = text(form, "to", 30) as UnitStatus;
  if (!(UNIT_STATUSES as readonly string[]).includes(to)) return { ok: false, message: "Choose a status." };
  return act(async (ctx) => setUnitStatus(ctx, text(form, "unitId", 60), { to, note: text(form, "note", 200) || null, hub: text(form, "hub", 60) || null }, await currentActor()));
}

export async function startCountAction(form: FormData): Promise<ActionResult & { href?: string }> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const r = await startCount(ctx, text(form, "hub", 60), await currentActor());
    if (!r.ok) return { ok: false, message: r.error };
    return { ok: true, message: r.message, href: `/wms/counts/${r.value.number}` };
  });
}

export async function countScanAction(number: string, serial: string): Promise<{ ok: boolean; message: string; known?: boolean; total?: number }> {
  const ctx = await getWms();
  if (!ctx) return OFF;
  const r = await countScan(ctx, String(number).slice(0, 30), String(serial).slice(0, 120), await currentActor());
  return r.ok ? { ok: true, message: r.message, known: r.value.known, total: r.value.total } : { ok: false, message: r.error };
}

export async function countFinishAction(form: FormData): Promise<ActionResult> {
  const number = text(form, "number", 30);
  if (text(form, "step", 10) === "finish") return act(async (ctx) => finishCount(ctx, number, await currentActor()));
  return act(async (ctx) => settleCount(ctx, number, { moveHere: form.get("moveHere") === "yes", markLost: form.get("markLost") === "yes", note: text(form, "note", 200) || null }, await currentActor()));
}

export async function openingUnitsAction(): Promise<ActionResult> {
  return act(async (ctx) => createOpeningUnits(ctx, await currentActor()));
}

export async function setMasterNoteAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getWms();
    if (!ctx) return OFF;
    const { canAct } = await import("@/lib/ops/service");
    if (!(await canAct(ctx.ops, await currentActor(), "procurement"))) return { ok: false, message: "Only procurement or admin can change the lists." };
    const note = text(form, "note", 300);
    if (note && !/^https:\/\/\S+\{awb\}\S*$/.test(note)) return { ok: false, message: "Paste the tracking link with {awb} where the AWB goes, like https://…/track?awb={awb}" };
    await ctx.wms.setMasterNote(text(form, "id", 60), note || null);
    refresh();
    return { ok: true, message: note ? "Tracking link saved." : "Tracking link removed." };
  });
}
