import { createHash } from "node:crypto";
import { isoDateInIst } from "@/lib/format";
import { log } from "@/lib/log";
import { orderInputFromSale } from "@/lib/ops/sale-input";
import {
  canAct,
  cancelOrder,
  clearForFulfilment,
  createOrder,
  decideLine,
  markDelivered,
  markProcurementOrdered,
  outForDelivery,
  receiveProcurement,
  recordPayment,
  setLineSku,
  setShopifyId,
  type Actor,
  type Result,
} from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import { STAGE_LABELS, STAGE_OWNER, type OrderDetail, type OrderLine, type OrderStage, type Role, type StockLevel } from "@/lib/ops/types";
import {
  DIRECT_KINDS,
  esc,
  inr,
  isOpsKind,
  legacyTextForOrder,
  lineLabel,
  OPS_MORE_ACTION,
  OPS_OPEN_ACTION,
  OPS_PREFIX,
  orderCard,
  productOptions,
  shortDate,
  type ActionValue,
  type OpsKind,
} from "@/lib/slack/ops-cards";
import {
  deliveredModal,
  dispatchModal,
  FIRST_INPUT,
  holdPoModal,
  mapSkuModal,
  parseSubmission,
  procOrderedModal,
  procReceivedModal,
  procureModal,
  reasonModal,
  shopifyModal,
  verifyPaymentModal,
  type ModalMeta,
  type ParsedSubmission,
} from "@/lib/slack/ops-modals";
import type { OpsSaleSubmission } from "@/lib/slack/sale-form";
import { slackPermalink } from "@/lib/slack/schema";
import type { SlackClient } from "@/lib/slack/slack-client";

// ── Wiring ───────────────────────────────────────────────────────────────────

export type TeamChannels = { revops?: string | null; inventory?: string | null; logistics?: string | null };

export type OpsDeps = {
  store: OpsStore;
  slack: SlackClient;
  appBaseUrl: string | null;
  teamChannels: TeamChannels;
  now?: () => Date;
};

/** Work to run after Slack has its 3-second acknowledgement (the route passes each to `after`). */
export type Task = () => Promise<void>;
/** `body` is the HTTP response body for Slack (null → empty 200, which also closes a modal). */
export type Handled = { body: unknown | null; later: Task[] };

export type SlackUser = { id?: string; username?: string; name?: string };

export type BlockActionsPayload = {
  type?: string;
  trigger_id?: string;
  user?: SlackUser;
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  actions?: Array<{ action_id?: string; block_id?: string; value?: string; action_ts?: string; selected_option?: { value?: string } | null }>;
};

export type ViewSubmissionPayload = {
  type?: string;
  user?: SlackUser;
  view?: { id?: string; callback_id?: string; private_metadata?: string; state?: { values?: unknown } };
};

export type BlockSuggestionPayload = { type?: string; action_id?: string; block_id?: string; value?: string };

/** Reads the team channels from the environment. Unset → that team gets no pings. */
export function teamChannelsFromEnv(env: Record<string, string | undefined>): TeamChannels {
  const pick = (key: string) => {
    const value = env[key]?.trim();
    return value && /^[CG][A-Z0-9]+$/.test(value) ? value : null;
  };
  return { revops: pick("SLACK_REVOPS_CHANNEL_ID"), inventory: pick("SLACK_INVENTORY_CHANNEL_ID"), logistics: pick("SLACK_LOGISTICS_CHANNEL_ID") };
}

export function appBaseUrlFromEnv(env: Record<string, string | undefined>): string | null {
  const value = env.APP_BASE_URL?.trim();
  return value && /^https?:\/\//.test(value) ? value.replace(/\/+$/, "") : null;
}

function parseJson<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

const now = (deps: OpsDeps) => (deps.now ? deps.now() : new Date());

/** The people table name when we know the person, else the Slack handle. */
export async function actorFor(store: OpsStore, user: SlackUser | undefined): Promise<Actor> {
  const id = user?.id ?? null;
  if (id) {
    const person = (await store.people()).find((p) => p.slackUserId === id);
    if (person?.name) return { name: person.name, slackUserId: id };
  }
  return { name: user?.name || user?.username || id || "Slack user", slackUserId: id };
}

// ── Product search (block_suggestion) ────────────────────────────────────────

export async function productSuggestions(store: OpsStore, query: string): Promise<{ options: ReturnType<typeof productOptions> }> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
  const products = await store.searchProducts(q, 100);
  return { options: productOptions(products) };
}

// ── Card refresh, thread notes and team pings ────────────────────────────────

const DECIDING_LINE: OrderLine["status"][] = ["pending", "rejected", "awaiting_po"];

export async function stockForOrder(store: OpsStore, order: OrderDetail): Promise<Record<string, StockLevel | null>> {
  const skus = [...new Set(order.lines.filter((l) => l.sku && DECIDING_LINE.includes(l.status)).map((l) => l.sku!))];
  const levels = await Promise.all(skus.map((sku) => store.stockFor(sku)));
  return Object.fromEntries(skus.map((sku, i) => [sku, levels[i]]));
}

/** Renders the current card into the order's Slack message. Returns the fresh order. */
export async function refreshCard(deps: OpsDeps, orderId: string): Promise<OrderDetail | null> {
  const order = await deps.store.getOrder(orderId);
  if (!order || !order.slackChannelId || !order.slackMessageTs) return order;
  const card = orderCard(order, { stock: await stockForOrder(deps.store, order), appBaseUrl: deps.appBaseUrl });
  // Keep the legacy sale text as the message text: the old dashboard and backfill parse it.
  const text = legacyTextForOrder(order) ?? card.text;
  const updated = await deps.slack.update({ channel: order.slackChannelId, ts: order.slackMessageTs, text, blocks: card.blocks });
  if (!updated.ok) log("error", "slack_card_update_failed", { orderId, error: updated.error ?? "unknown" });
  return order;
}

function teamChannelFor(deps: OpsDeps, role: Role | null): string | null {
  if (role === "revops") return deps.teamChannels.revops ?? null;
  if (role === "inventory" || role === "procurement") return deps.teamChannels.inventory ?? null;
  if (role === "logistics") return deps.teamChannels.logistics ?? null;
  return null;
}

/** Tells the owning team when an order arrives at their stage. Silent when the channel is not set. */
export async function pingTeam(deps: OpsDeps, order: OrderDetail, previous: OrderStage | null): Promise<void> {
  if (order.stage === previous) return;
  const channel = teamChannelFor(deps, STAGE_OWNER[order.stage]);
  if (!channel || !order.slackChannelId || !order.slackMessageTs) return;
  const link = await deps.slack.getPermalink({ channel: order.slackChannelId, message_ts: order.slackMessageTs });
  const permalink = link.ok && link.permalink ? link.permalink : slackPermalink(order.slackChannelId, order.slackMessageTs);
  const posted = await deps.slack.postMessage({ channel, text: `${order.id} needs you: <${permalink}|open card> · ${STAGE_LABELS[order.stage]}` });
  if (!posted.ok) log("error", "slack_team_ping_failed", { orderId: order.id, error: posted.error ?? "unknown" });
}

async function afterChange(deps: OpsDeps, before: OrderDetail, summary: string): Promise<void> {
  const order = await refreshCard(deps, before.id);
  if (!order || !order.slackChannelId || !order.slackMessageTs) return;
  const posted = await deps.slack.postMessage({ channel: order.slackChannelId, thread_ts: order.slackMessageTs, text: summary });
  if (!posted.ok) log("error", "slack_thread_note_failed", { orderId: order.id, error: posted.error ?? "unknown" });
  await pingTeam(deps, order, before.stage);
}

// ── New sale ─────────────────────────────────────────────────────────────────

/** Creates the operations order for a sale already posted at channel/ts, then turns the message into the card. */
export async function createOpsOrderFromSale(
  deps: OpsDeps,
  input: { sale: OpsSaleSubmission; channel: string; ts: string; user: SlackUser },
): Promise<OrderDetail | null> {
  const [first, ...rest] = input.sale.products;
  const order = orderInputFromSale(input.sale.fields, {
    source: "slack",
    phone: input.sale.phone,
    sku: first?.sku ?? null,
    extraLines: rest.map((p) => ({ sku: p.sku, productName: p.name, listPriceMinor: null, offeredPriceMinor: p.offeredMinor })),
    slackChannelId: input.channel,
    slackMessageTs: input.ts,
    createdBy: input.user.id ?? null,
  });
  const actor = await actorFor(deps.store, input.user);
  const created = await createOrder(deps.store, order, actor);
  if (!created.ok) {
    log("error", "ops_order_create_failed", { error: created.error, channel: input.channel, ts: input.ts });
    if (input.user.id) {
      await deps.slack.postEphemeral({ channel: input.channel, user: input.user.id, text: `The sale was posted, but the order card could not be made: ${created.error}` });
    }
    return null;
  }
  const fresh = await refreshCard(deps, created.value.id);
  if (fresh) await pingTeam(deps, fresh, null);
  return fresh;
}

// ── Buttons (block_actions) ──────────────────────────────────────────────────

const ROLES_FOR: Record<OpsKind, { roles: Role[]; refusal: string } | null> = {
  verify: { roles: ["revops"], refusal: "Only RevOps can verify payments." },
  clear: { roles: ["revops"], refusal: "Only RevOps can clear an order." },
  reserve: { roles: ["inventory"], refusal: "Only the inventory team can decide stock." },
  brand_direct: { roles: ["inventory"], refusal: "Only the inventory team can decide stock." },
  procure: { roles: ["inventory"], refusal: "Only the inventory team can decide stock." },
  hold_po: { roles: ["inventory"], refusal: "Only the inventory team can decide stock." },
  reject: { roles: ["inventory"], refusal: "Only the inventory team can decide stock." },
  map_sku: { roles: ["inventory"], refusal: "Only the inventory team can map SKUs." },
  proc_ordered: { roles: ["procurement"], refusal: "Only procurement can update this." },
  proc_received: { roles: ["inventory", "procurement"], refusal: "Only inventory or procurement can receive goods." },
  dispatch: { roles: ["logistics"], refusal: "Only logistics can dispatch." },
  delivered: { roles: ["logistics"], refusal: "Only logistics can mark delivered." },
  cancel: { roles: ["revops", "sales"], refusal: "Only sales or RevOps can cancel." },
  shopify: null,
};

export async function permissionProblem(store: OpsStore, actor: Actor, kind: OpsKind): Promise<string | null> {
  const rule = ROLES_FOR[kind];
  if (!rule) return null;
  for (const role of rule.roles) if (await canAct(store, actor, role)) return null;
  return rule.refusal;
}

const LINE_KINDS: OpsKind[] = ["reserve", "brand_direct", "procure", "hold_po", "reject", "map_sku", "proc_ordered", "proc_received"];
const STAGE_FOR: Partial<Record<OpsKind, OrderStage[]>> = {
  verify: ["awaiting_payment"],
  clear: ["awaiting_payment"],
  dispatch: ["ready_to_dispatch"],
  delivered: ["out_for_delivery"],
  reserve: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  brand_direct: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  procure: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  hold_po: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  reject: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  map_sku: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  proc_ordered: ["awaiting_inventory", "awaiting_stock", "on_hold"],
  proc_received: ["awaiting_inventory", "awaiting_stock", "on_hold"],
};
const STALE = "This card was out of date, so it has been refreshed. Check it and tap again.";

type ModalBuild = { ok: true; view: unknown } | { ok: false; error: string; stale?: boolean };

async function buildModal(deps: OpsDeps, kind: OpsKind, value: ActionValue): Promise<ModalBuild> {
  const order = await deps.store.getOrder(value.o);
  if (!order) return { ok: false, error: "Order not found." };
  const stages = STAGE_FOR[kind];
  if (stages && !stages.includes(order.stage)) return { ok: false, error: STALE, stale: true };
  const line = value.l ? order.lines.find((l) => l.id === value.l) : undefined;
  if (LINE_KINDS.includes(kind) && !line) return { ok: false, error: "That product is no longer on the order.", stale: true };
  switch (kind) {
    case "verify":
      return { ok: true, view: verifyPaymentModal(order) };
    case "clear":
    case "cancel":
      return { ok: true, view: reasonModal(kind, order) };
    case "reject":
      return { ok: true, view: reasonModal("reject", order, line) };
    case "procure":
      return { ok: true, view: procureModal(order, line!) };
    case "hold_po": {
      if (!line!.sku) return { ok: false, error: "Map this product to a SKU first." };
      const pos = (await deps.store.listPurchaseOrders({ status: "open", sku: line!.sku })).filter((po) => po.qtyOrdered > po.qtyReceived);
      if (!pos.length) return { ok: false, error: `There are no open purchase orders for ${line!.sku}.` };
      return { ok: true, view: holdPoModal(order, line!, pos) };
    }
    case "map_sku":
      return { ok: true, view: mapSkuModal(order, line!) };
    case "proc_ordered":
    case "proc_received": {
      const request = order.procurement.find((p) => p.id === line!.procurementId);
      if (!request || (request.status !== "requested" && request.status !== "ordered")) return { ok: false, error: STALE, stale: true };
      return { ok: true, view: kind === "proc_ordered" ? procOrderedModal(order, line!, request) : procReceivedModal(order, line!) };
    }
    case "dispatch":
      return { ok: true, view: dispatchModal(order, isoDateInIst(now(deps))) };
    case "delivered":
      return { ok: true, view: deliveredModal(order) };
    case "shopify":
      return { ok: true, view: shopifyModal(order) };
    case "reserve":
    case "brand_direct":
      return { ok: false, error: "This step has no form." };
  }
}

function readAction(action: NonNullable<BlockActionsPayload["actions"]>[number]): { kind: OpsKind; value: ActionValue } | null {
  const id = action.action_id ?? "";
  if (!id.startsWith(OPS_PREFIX) || id === OPS_OPEN_ACTION) return null;
  if (id === OPS_MORE_ACTION) {
    const picked = parseJson<{ k?: string; o?: string }>(action.selected_option?.value);
    if (!picked?.k || !picked.o || !isOpsKind(picked.k)) return null;
    return { kind: picked.k, value: { o: picked.o } };
  }
  const kind = id.slice(OPS_PREFIX.length);
  const value = parseJson<ActionValue>(action.value);
  if (!isOpsKind(kind) || !value || typeof value.o !== "string") return null;
  return { kind, value: { o: value.o, ...(typeof value.l === "string" ? { l: value.l } : {}) } };
}

/** True when the payload holds at least one operations button. */
export function hasOpsAction(payload: BlockActionsPayload): boolean {
  return (payload.actions ?? []).some((a) => (a.action_id ?? "").startsWith(OPS_PREFIX));
}

/**
 * Buttons on the order card. Forms open now (the trigger_id expires in 3 seconds);
 * direct changes, refusals and card refreshes are returned in `later`.
 */
export async function handleOpsBlockActions(deps: OpsDeps, payload: BlockActionsPayload): Promise<Handled> {
  const later: Task[] = [];
  const userId = payload.user?.id ?? null;
  const channel = payload.channel?.id ?? payload.container?.channel_id ?? null;
  const tell = (text: string) =>
    later.push(async () => {
      if (channel && userId) await deps.slack.postEphemeral({ channel, user: userId, text });
    });

  for (const action of payload.actions ?? []) {
    const read = readAction(action);
    if (!read) continue;
    const { kind, value } = read;
    const actor = await actorFor(deps.store, payload.user);

    if (DIRECT_KINDS.includes(kind)) {
      const key = `${action.action_ts ?? ""}:${action.action_id ?? ""}:${action.value ?? ""}`;
      if (!(await deps.store.claimAction(key))) continue;
      later.push(() => runDirect(deps, kind, value, actor, tell));
      continue;
    }

    const refusal = await permissionProblem(deps.store, actor, kind);
    if (refusal) {
      tell(refusal);
      continue;
    }
    const built = await buildModal(deps, kind, value);
    if (!built.ok) {
      tell(built.error);
      if (built.stale) later.push(async () => void (await refreshCard(deps, value.o)));
      continue;
    }
    if (!payload.trigger_id) continue;
    const opened = await deps.slack.viewsOpen({ trigger_id: payload.trigger_id, view: built.view });
    if (!opened.ok) {
      log("error", "slack_modal_open_failed", { kind, error: opened.error ?? "unknown" });
      tell("The form could not open. Tap the button again.");
    }
  }
  return { body: null, later };
}

async function runDirect(deps: OpsDeps, kind: OpsKind, value: ActionValue, actor: Actor, tell: (text: string) => void): Promise<void> {
  const before = await deps.store.getOrder(value.o);
  const line = before?.lines.find((l) => l.id === value.l);
  if (!before || !line) {
    tell("That product is no longer on the order.");
    return;
  }
  const result = await decideLine(deps.store, line.id, { type: kind === "reserve" ? "reserve" : "brand_direct" }, actor);
  if (!result.ok) {
    tell(result.error);
    await refreshCard(deps, before.id);
    return;
  }
  const what = kind === "reserve" ? `reserved ${esc(lineLabel(line))} from stock` : `marked ${esc(lineLabel(line))} as shipped by the brand directly`;
  await afterChange(deps, before, `${esc(actor.name)} ${what}.${stageNote(before, result.value)}`);
}

// ── Forms (view_submission) ──────────────────────────────────────────────────

function stageNote(before: OrderDetail, after: OrderDetail): string {
  return after.stage !== before.stage ? ` Now: ${STAGE_LABELS[after.stage]}.` : "";
}

function stateHash(values: unknown): string {
  return createHash("sha1").update(JSON.stringify(values ?? null)).digest("hex").slice(0, 16);
}

/** True when the view_submission is one of the operations forms. */
export function isOpsView(payload: ViewSubmissionPayload): boolean {
  return (payload.view?.callback_id ?? "").startsWith(OPS_PREFIX);
}

type Applied = { result: Result; summary: (after: OrderDetail) => string };

async function apply(deps: OpsDeps, parsed: ParsedSubmission, before: OrderDetail, line: OrderLine | undefined, actor: Actor): Promise<Applied | { error: string }> {
  const { store } = deps;
  const who = esc(actor.name);
  const needLine = () => (line ? null : { error: "That product is no longer on the order." });
  switch (parsed.kind) {
    case "verify": {
      const result = await recordPayment(store, before.id, { amountMinor: parsed.amountMinor, mode: parsed.mode, kind: parsed.payKind, reference: parsed.reference, clear: parsed.clear }, actor);
      const label = parsed.mode === "UPI" || parsed.mode === "NEFT" ? "UTR" : "ref";
      const ref = parsed.reference ? ` (${label} ${esc(parsed.reference)})` : "";
      return {
        result,
        summary: (after) => `${who} verified ${inr(parsed.amountMinor)} ${parsed.mode}${ref}.${after.stage !== before.stage ? " Sent to inventory." : ""}${after.codDueMinor > 0 ? ` Balance ${inr(after.codDueMinor)}.` : ""}`,
      };
    }
    case "clear":
      return { result: await clearForFulfilment(store, before.id, parsed.reason, actor), summary: () => `${who} cleared the order without payment: ${esc(parsed.reason)}. Sent to inventory.` };
    case "cancel":
      return { result: await cancelOrder(store, before.id, parsed.reason, actor), summary: () => `${who} cancelled the order: ${esc(parsed.reason)}.` };
    case "reject": {
      const missing = needLine();
      if (missing) return missing;
      return { result: await decideLine(store, line!.id, { type: "reject", reason: parsed.reason }, actor), summary: (after) => `${who} rejected ${esc(lineLabel(line!))}: ${esc(parsed.reason)}.${stageNote(before, after)}` };
    }
    case "procure": {
      const missing = needLine();
      if (missing) return missing;
      const d = parsed.decision;
      return {
        result: await decideLine(store, line!.id, d, actor),
        summary: (after) => `${who} asked to procure ${esc(lineLabel(line!))} from ${esc(d.vendor)}${d.costMinor ? ` at ${inr(d.costMinor)}` : ""}${d.eta ? `, ETA ${shortDate(d.eta)}` : ""}.${stageNote(before, after)}`,
      };
    }
    case "hold_po": {
      const missing = needLine();
      if (missing) return missing;
      const po = await store.getPurchaseOrder(parsed.poId);
      return {
        result: await decideLine(store, line!.id, { type: "hold_po", poId: parsed.poId }, actor),
        summary: (after) => `${who} held ${esc(lineLabel(line!))} on ${esc(po?.poNumber ?? "a PO")}${po?.eta ? `, ETA ${shortDate(po.eta)}` : ""}.${stageNote(before, after)}`,
      };
    }
    case "map_sku": {
      const missing = needLine();
      if (missing) return missing;
      return { result: await setLineSku(store, line!.id, parsed.sku, actor), summary: () => `${who} mapped “${esc(line!.productName)}” to ${esc(parsed.sku)}.` };
    }
    case "proc_ordered":
    case "proc_received": {
      const missing = needLine();
      if (missing) return missing;
      if (!line!.procurementId) return { error: "This product is not being procured." };
      if (parsed.kind === "proc_ordered") {
        return {
          result: await markProcurementOrdered(store, line!.procurementId, { poNumber: parsed.poNumber, eta: parsed.eta }, actor),
          summary: () => `${who} marked ${esc(lineLabel(line!))} ordered${parsed.poNumber ? ` on ${esc(parsed.poNumber)}` : ""}${parsed.eta ? `, ETA ${shortDate(parsed.eta)}` : ""}.`,
        };
      }
      return {
        result: await receiveProcurement(store, line!.procurementId, { serialNo: parsed.serialNo, unitCostMinor: null }, actor),
        summary: (after) => `${who} received ${esc(lineLabel(line!))}${parsed.serialNo ? ` (serial ${esc(parsed.serialNo)})` : ""}.${stageNote(before, after)}`,
      };
    }
    case "dispatch":
      return {
        result: await outForDelivery(store, before.id, { driver: parsed.driver, serials: parsed.serials, expectedDate: parsed.expectedDate }, actor),
        summary: (after) => `${who} sent the order out for delivery with ${esc(parsed.driver)}${parsed.expectedDate ? `, expected ${shortDate(parsed.expectedDate)}` : ""}.${after.codDueMinor ? ` Collect ${inr(after.codDueMinor)}.` : ""}`,
      };
    case "delivered":
      return {
        result: await markDelivered(store, before.id, { collectedMinor: parsed.collectedMinor, mode: parsed.mode }, actor, now(deps)),
        summary: (after) => `${who} marked the order delivered${parsed.collectedMinor ? ` and collected ${inr(parsed.collectedMinor)} ${parsed.mode}` : ""}.${after.installations.some((i) => i.status === "pending") ? " Installation is due." : ""}`,
      };
    case "shopify":
      return { result: await setShopifyId(store, before.id, parsed.shopify, actor), summary: (after) => `${who} linked Shopify ${esc(after.shopifyOrderId ?? parsed.shopify)}.` };
  }
}

/** Form error shown when the operations store cannot be reached. */
export function opsUnavailable(payload: ViewSubmissionPayload): unknown {
  const kind = (payload.view?.callback_id ?? "").slice(OPS_PREFIX.length);
  const block = isOpsKind(kind) && !DIRECT_KINDS.includes(kind) ? FIRST_INPUT[kind as keyof typeof FIRST_INPUT] : "reason";
  return { response_action: "errors", errors: { [block]: "The order system is not reachable right now. Try again in a minute." } };
}

/**
 * Form submissions. Input problems and service refusals go back to the form as errors;
 * on success the form closes and the card, thread note and team ping follow in `later`.
 */
export async function handleOpsViewSubmission(deps: OpsDeps, payload: ViewSubmissionPayload): Promise<Handled> {
  const view = payload.view;
  const kind = (view?.callback_id ?? "").slice(OPS_PREFIX.length);
  if (!view || !isOpsKind(kind) || DIRECT_KINDS.includes(kind)) return { body: null, later: [] };
  const firstBlock = FIRST_INPUT[kind as keyof typeof FIRST_INPUT];
  const fail = (error: string): Handled => ({ body: { response_action: "errors", errors: { [firstBlock]: error.slice(0, 250) } }, later: [] });

  const meta = parseJson<ModalMeta>(view.private_metadata);
  if (!meta || typeof meta.o !== "string") return fail("This form lost its order. Close it and tap the button again.");
  const values = view.state?.values;
  const parsed = parseSubmission(kind, values);
  if (!parsed.ok) return { body: { response_action: "errors", errors: parsed.errors }, later: [] };

  // Same form with the same answers twice (double tap, Slack retry) → act once.
  const key = `view:${view.id ?? "?"}:${stateHash(values)}`;
  if (!(await deps.store.claimAction(key))) return fail("This was already submitted. Close the form and check the card.");

  const before = await deps.store.getOrder(meta.o);
  if (!before) return fail("Order not found.");
  const line = meta.l ? before.lines.find((l) => l.id === meta.l) : undefined;
  const actor = await actorFor(deps.store, payload.user);
  const applied = await apply(deps, parsed.value, before, line, actor);
  if ("error" in applied) {
    await deps.store.releaseAction(key);
    return fail(applied.error);
  }
  if (!applied.result.ok) {
    // Refused: let the same answers be submitted again once the problem is fixed.
    await deps.store.releaseAction(key);
    return fail(applied.result.error);
  }
  const after = applied.result.value;
  const summary = applied.summary(after);
  return { body: null, later: [() => afterChange(deps, before, summary)] };
}
