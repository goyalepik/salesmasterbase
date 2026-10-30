import { after, NextResponse } from "next/server";
import { syncOrderToSlack } from "@/lib/slack/sync";
import { readEnv } from "@/lib/env";
import { getOpsStore } from "@/lib/ops";
import { orderInputFromSale, normalisePhone, rupeesToMinor } from "@/lib/ops/sale-input";
import { createOrder } from "@/lib/ops/service";
import type { NewOrderLineInput } from "@/lib/ops/types";
import { currentActor } from "@/lib/ops-ui/actor";
import { processStoredMessage } from "@/lib/process-message";
import { isSameOrigin } from "@/lib/same-origin";
import { formatDeskOrder, readOrderFields } from "@/lib/slack/sale-form";
import { slackPermalink } from "@/lib/slack/schema";
import { STUCK_PROCESSING_MS } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorCode(errors: Record<string, string>): string {
  return Object.keys(errors)[0] ?? "customer";
}

function value(form: FormData, key: string, max = 120): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Products 2 and 3 from the desk form, in paise. Returns the field to complain about when one is half filled. */
function extraLines(form: FormData): { ok: true; lines: NewOrderLineInput[] } | { ok: false; field: string } {
  const lines: NewOrderLineInput[] = [];
  for (const n of [2, 3]) {
    const name = value(form, `product_${n}`);
    const offered = value(form, `offered_price_${n}`, 20);
    const list = value(form, `list_price_${n}`, 20);
    if (!name && !offered && !list) continue;
    const offeredMinor = rupeesToMinor(offered);
    if (name.length < 2 || !offeredMinor) return { ok: false, field: `product_${n}` };
    lines.push({ sku: value(form, `sku_${n}`, 80) || null, productName: name, listPriceMinor: rupeesToMinor(list), offeredPriceMinor: offeredMinor });
  }
  return { ok: true, lines };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const back = new URL("/orders/new", request.url);
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return NextResponse.redirect(back, 303);
  const form = await request.formData();
  const read = readOrderFields({
    customer: String(form.get("customer") ?? ""),
    product: String(form.get("product") ?? ""),
    email: String(form.get("email") ?? ""),
    shippingAddress: String(form.get("shipping_address") ?? ""),
    pincode: String(form.get("pincode") ?? ""),
    billingAddress: String(form.get("billing_address") ?? ""),
    hub: String(form.get("hub") ?? ""),
    cxType: String(form.get("cx_type") ?? ""),
    poc: String(form.get("poc") ?? ""),
    saleSource: String(form.get("sale_source") ?? ""),
    saleType: String(form.get("sale_type") ?? ""),
    listPrice: String(form.get("list_price") ?? ""),
    offeredPrice: String(form.get("offered_price") ?? ""),
    paymentStatus: String(form.get("payment_status") ?? ""),
    paymentMode: String(form.get("payment_mode") ?? ""),
    gst: String(form.get("gst") ?? ""),
    notes: String(form.get("notes") ?? ""),
    accessories: String(form.get("accessories") ?? ""),
    extendedWarranty: String(form.get("extended_warranty") ?? ""),
    installation: String(form.get("installation") ?? ""),
  });
  if (!read.ok) {
    back.searchParams.set("error", errorCode(read.errors));
    return NextResponse.redirect(back, 303);
  }
  const phone = normalisePhone(value(form, "phone", 20));
  if (!phone) {
    back.searchParams.set("error", "phone");
    return NextResponse.redirect(back, 303);
  }
  const extra = extraLines(form);
  if (!extra.ok) {
    back.searchParams.set("error", extra.field);
    return NextResponse.redirect(back, 303);
  }
  const ops = await getOpsStore();
  if (!ops) {
    back.searchParams.set("error", "save");
    return NextResponse.redirect(back, 303);
  }

  // Legacy Slack text: the old inbox and the sales channel still read this. Extra products go in as plain lines. The phone stays out of Slack.
  const extraText = extra.lines.map((line, i) => `Product ${i + 2} - ${line.productName} - Offered price ${line.offeredPriceMinor / 100}`);
  const text = formatDeskOrder(read.fields).replace(/^(Product - .*)$/m, (first) => [first, ...extraText].join("\n"));
  const env = readEnv();
  const channels = await workspace.repo.channels();
  const channelId = (workspace.mode === "live" ? env.slackChannelId : null) || channels[0]?.id || "CLOCAL";
  const channelName = channels.find((channel) => channel.id === channelId)?.name ?? (channelId === env.slackChannelId ? env.slackChannelName : null);
  let messageTs = `desk.${Date.now()}`;
  if (workspace.mode === "live" && env.slackBotToken && env.slackChannelId) {
    try {
      const posted = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.slackBotToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: env.slackChannelId, text }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await posted.json()) as { ok?: boolean; ts?: string };
      if (body.ok && body.ts) messageTs = body.ts;
    } catch {
      messageTs = `desk.${Date.now()}`;
    }
  }

  const inserted = await workspace.repo.insertInbound({
    slackTeamId: null,
    slackChannelId: channelId,
    slackChannelName: channelName,
    slackMessageTs: messageTs,
    slackEventId: null,
    senderId: null,
    senderName: read.fields.poc,
    text,
    threadTs: messageTs,
    permalink: messageTs.startsWith("desk.") ? null : slackPermalink(channelId, messageTs),
    subtype: null,
    botId: null,
    eventReceivedAt: new Date().toISOString(),
    sourceMetadata: { source: "epik_sale_form" },
  });
  if (!inserted.ok) {
    back.searchParams.set("error", "save");
    return NextResponse.redirect(back, 303);
  }
  if (!inserted.duplicate) {
    await workspace.repo.reclaimStuck(STUCK_PROCESSING_MS);
    await processStoredMessage(workspace.repo, inserted.message.id, { monitoredChannelId: channelId });
  }

  const actor = await currentActor();
  const posted = !messageTs.startsWith("desk.");
  const input = orderInputFromSale(read.fields, {
    source: "desk",
    phone,
    sku: value(form, "sku", 80) || null,
    extraLines: extra.lines,
    // Linking the Slack message lets the Slack handler recognise this order instead of creating a second one.
    slackChannelId: posted ? channelId : null,
    slackMessageTs: posted ? messageTs : null,
    createdBy: actor.name,
  });
  const created = await createOrder(ops, input, actor);
  if (!created.ok) {
    back.searchParams.set("error", "order");
    back.searchParams.set("detail", created.error);
    return NextResponse.redirect(back, 303);
  }
  // Turn the posted sale into the live order card and tell RevOps.
  if (posted) after(() => syncOrderToSlack(ops, created.value.id, null));
  return NextResponse.redirect(new URL(`/orders/${encodeURIComponent(created.value.id)}`, request.url), 303);
}
