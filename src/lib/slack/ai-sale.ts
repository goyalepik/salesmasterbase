// The AI sale reader in Slack. A salesperson posts a sale in their own words in the sales channel. The AI reads it;
// when everything the long form needs is there, the order is made at once (same card, Shopify, dashboard and SMB
// sheet as the form). When something is missing, the bot asks in the thread and reads the replies; a product that
// could be several items gets buttons. Pure apart from the deps (tests pass fakes).

import { isoDateInIst } from "@/lib/format";
import { log } from "@/lib/log";
import type { OrderDetail, Product } from "@/lib/ops/types";
import {
  AI_SALE_ASK,
  AI_SALE_DONE,
  AI_SALE_MORE,
  buildSale,
  conversationText,
  knownPoc,
  mightBeSale,
  pickMarker,
  picksFrom,
  readSaleConversation,
  resolveProducts,
  threadState,
  type AiSaleRead,
  type BuiltSale,
  type SaleModel,
  type ThreadMessage,
} from "@/lib/ai/sale-reader";
import { addNote } from "@/lib/ops/service";
import { actorFor, createOpsOrderFromSale, refreshCard, type OpsDeps } from "@/lib/slack/ops-actions";
import { formatSale, legacySaleFields, withCatalogue, type OpsSaleSubmission } from "@/lib/slack/sale-form";

export const AI_PICK_ACTION = "ai_sale_pick";
/** After this many questions in one thread, the bot hands over to the form. */
const MAX_ASKS = 4;

export type AiSaleDeps = {
  ops: OpsDeps;
  model: SaleModel;
  now: () => Date;
  /** The product list to match against (the Shopify catalogue). */
  catalogue: () => Promise<Product[]>;
  /** The full product list, searched when the catalogue has no match. */
  searchAll?: (q: string) => Promise<Product[]>;
  displayName: (slackUserId: string) => Promise<string | null>;
  /** After the order is made: Shopify, SMB sheet, Sales Records. */
  afterOrder: (order: OrderDetail, info: { sale: OpsSaleSubmission; text: string; ts: string; channel: string; posterId: string; posterName: string }) => Promise<void>;
};

export type AiSaleMessage = { channel: string; ts: string; threadTs: string | null; text: string; userId: string | null };
/** order: made. asked: waiting for the salesperson. not_sale: a top-level message that is not a new sale. ignored: nothing to do. */
export type AiSaleOutcome = "order" | "asked" | "not_sale" | "ignored";

const say = (value: string) => value.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** What the AI understood so far, one line, so the salesperson can spot a misread. */
function understood(read: AiSaleRead): string {
  const products = read.products.map((p) => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}${p.offeredPrice ? ` ${rupees(Math.round(p.offeredPrice * 100))}` : ""}`).join(", ");
  return [read.customer, read.phone, products, read.hub, read.poc && `POC ${read.poc}`, read.paymentStatus].filter(Boolean).join(" · ");
}

function askMessage(built: Extract<BuiltSale, { ok: false }>, read: AiSaleRead, channel: string, root: string): { text: string; blocks: unknown[] } {
  const lines = built.gaps.map((g) => `• ${g.question}`);
  const head = lines.length
    ? `*I read this as a new sale. To make the order I still need:*\n${lines.join("\n")}\nReply here in one message, in your own words.`
    : "*I read this as a new sale. One more thing:*";
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: head } }];
  for (const { index, slot } of built.choose) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Which product is “${say(slot.name)}”?*` } });
    const button = (label: string, sku: string | null, i: number) => ({
      type: "button",
      action_id: `${AI_PICK_ACTION}:${index}:${i}`,
      text: { type: "plain_text", text: label.slice(0, 75), emoji: true },
      value: JSON.stringify({ c: channel, t: root, n: index, s: sku, l: (sku ? label : slot.name).slice(0, 150) }),
    });
    blocks.push({ type: "actions", elements: [...slot.choices.map((p, i) => button(p.name, p.sku, i)), button("None of these", null, 9)] });
  }
  const seen = understood(read);
  if (seen) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `So far: ${say(seen)}` }] });
  if (built.later.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Also useful if you have them: ${built.later.map((g) => g.question.split(":")[0]).join(", ")}` }] });
  const fallback = [lines.length ? `To make the order I still need: ${built.gaps.map((g) => g.question).join("; ")}.` : "Pick the product.", AI_SALE_ASK].join(" ");
  return { text: fallback, blocks };
}

async function thread(deps: AiSaleDeps, channel: string, root: string): Promise<ThreadMessage[] | null> {
  const replies = await deps.ops.slack.replies?.({ channel, ts: root });
  return replies?.ok && replies.messages?.length ? replies.messages : null;
}

async function note(deps: AiSaleDeps, channel: string, root: string, text: string): Promise<void> {
  const posted = await deps.ops.slack.postMessage({ channel, thread_ts: root, text });
  if (!posted.ok) log("error", "ai_sale_note_failed", { error: posted.error ?? "unknown" });
}

/** Reads one channel message (a new post, or a reply in a thread the bot is asking in) and acts on it. */
export async function handleAiSaleMessage(deps: AiSaleDeps, message: AiSaleMessage): Promise<AiSaleOutcome> {
  const { channel } = message;
  const root = message.threadTs && message.threadTs !== message.ts ? message.threadTs : message.ts;
  const isReply = root !== message.ts;

  let messages: ThreadMessage[];
  if (isReply) {
    const found = await thread(deps, channel, root);
    if (!found || found[0]?.bot_id) return "ignored";
    const state = threadState(found);
    if (state.done) return state.wantsMore && state.orderId ? addDetails(deps, message, state.orderId) : "ignored";
    if (!state.asked) return "ignored";
    messages = found;
  } else {
    if (!mightBeSale(message.text)) return "not_sale";
    messages = [{ ts: message.ts, user: message.userId ?? undefined, text: message.text }];
  }

  const posterId = messages[0]?.user ?? message.userId ?? "";
  const names = new Map<string, string>();
  for (const id of new Set(messages.flatMap((m) => (m.user && !m.bot_id ? [m.user] : [])))) {
    const name = await deps.displayName(id).catch(() => null);
    if (name) names.set(id, name);
  }
  const posterName = names.get(posterId) ?? "Salesperson";

  const read = await readSaleConversation(conversationText(messages, names), deps.model, isoDateInIst(deps.now()));
  if (!read.isNewSale) return isReply ? "ignored" : "not_sale";

  const slots = await resolveProducts(read, await deps.catalogue(), picksFrom(messages), deps.model, deps.searchAll);
  const built = buildSale(read, slots, { salespersonId: posterId, fallbackPoc: knownPoc(names.get(posterId) ?? null) });

  if (!built.ok) {
    if (threadState(messages).asked >= MAX_ASKS) {
      await note(deps, channel, root, `I still can't make this sale from the messages. Please use the New sale button instead. ${AI_SALE_DONE}`);
      return "asked";
    }
    const ask = askMessage(built, read, channel, root);
    const posted = await deps.ops.slack.postMessage({ channel, thread_ts: root, text: ask.text, blocks: ask.blocks });
    if (!posted.ok) log("error", "ai_sale_ask_failed", { error: posted.error ?? "unknown" });
    return "asked";
  }

  // One order per thread, even if Slack retries or two replies arrive together.
  if (!(await deps.ops.store.claimAction(`ai-sale:${channel}:${root}`))) return "ignored";
  const store = deps.ops.store;
  const sale = await withCatalogue(built.sale, async (sku) => {
    const product = await store.getProduct(sku);
    return product ? { name: product.name, listPriceMinor: product.listPriceMinor } : null;
  });
  // The same channel text and card as the long form, so the old dashboard and every report read it the same way.
  const text = formatSale(legacySaleFields(sale));
  const posted = await deps.ops.slack.postMessage({ channel, text });
  if (!posted.ok || !posted.ts) {
    log("error", "ai_sale_post_failed", { error: posted.error ?? "unknown" });
    await note(deps, channel, root, `I read the sale but Slack did not accept the order card (${posted.error ?? "error"}). Please use the New sale button. ${AI_SALE_DONE}`);
    return "asked";
  }
  const order = await createOpsOrderFromSale(deps.ops, { sale, channel, ts: posted.ts, user: { id: posterId, name: posterName } });
  if (!order) {
    await note(deps, channel, root, `I read the sale but the order could not be made. Please use the New sale button. ${AI_SALE_DONE}`);
    return "asked";
  }
  try {
    await deps.afterOrder(order, { sale, text, ts: posted.ts, channel, posterId, posterName });
  } catch (error) {
    log("error", "ai_sale_after_order_failed", { orderId: order.id, message: error instanceof Error ? error.message : "unknown" });
  }
  const link = await deps.ops.slack.getPermalink({ channel, message_ts: posted.ts });
  const card = link.ok && link.permalink ? `<${link.permalink}|order card>` : "order card";
  const lines = sale.products.map((p) => `${p.name} ${rupees(p.offeredMinor)}${p.sku ? "" : " (not in the product list: inventory will map it)"}`);
  const summary = [sale.fields.customer, lines.join(", "), sale.fields.hub, sale.fields.poc && `POC ${sale.fields.poc}`, sale.fields.paymentStatus].filter(Boolean).map(say).join(" · ");
  const more = built.later.length
    ? `\nIf you can, reply here with: ${built.later.map((g) => g.question.split(":")[0]).join(", ")}. I'll add it to the order.`
    : "";
  await note(deps, channel, root, `Done: *${order.id}* made from this message. Open the ${card}.\n${summary}${more}\nWrong? Cancel it on the card and post again. ${AI_SALE_DONE}${more ? ` ${AI_SALE_MORE}` : ""}`);
  return "order";
}

/** A reply after the order was made, when the bot asked for a few more details: saved in the order's notes. */
async function addDetails(deps: AiSaleDeps, message: AiSaleMessage, orderId: string): Promise<AiSaleOutcome> {
  const body = message.text.replace(/\s+/g, " ").trim();
  if (!body || !message.userId) return "ignored";
  const name = (await deps.displayName(message.userId).catch(() => null)) ?? undefined;
  const actor = await actorFor(deps.ops.store, { id: message.userId, name });
  const added = await addNote(deps.ops.store, orderId, `From the Slack thread: ${body}`, actor);
  if (!added.ok) return "ignored";
  await refreshCard(deps.ops, orderId);
  const root = message.threadTs ?? message.ts;
  await deps.ops.slack.postMessage({ channel: message.channel, thread_ts: root, text: `Added to ${orderId}'s notes.`, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `✓ Added to ${orderId}'s notes.` }] }] });
  return "ignored";
}

export type AiPickValue = { c: string; t: string; n: number; s: string | null; l: string };

export function readPickValue(raw: string | undefined): AiPickValue | null {
  try {
    const value = JSON.parse(raw ?? "") as Partial<AiPickValue>;
    if (typeof value.c !== "string" || typeof value.t !== "string" || !Number.isInteger(value.n) || typeof value.l !== "string") return null;
    if (value.s !== null && typeof value.s !== "string") return null;
    return { c: value.c, t: value.t, n: value.n!, s: value.s ?? null, l: value.l };
  } catch {
    return null;
  }
}

/**
 * A product button in the bot's question: note the pick in the thread (the reader reads it back), take the buttons
 * off the question, and read the thread again.
 */
export async function handleAiSalePick(
  deps: AiSaleDeps,
  input: { value: AiPickValue; userId: string; question?: { ts: string; text: string; blocks: unknown[] } },
): Promise<AiSaleOutcome> {
  const { c: channel, t: root, n, s: sku, l: label } = input.value;
  if (input.question) {
    const blocks = input.question.blocks.filter((b) => (b as { type?: string }).type !== "actions" && !/Which product is/.test(JSON.stringify(b)));
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Product ${n}: ${say(label)} (picked by <@${input.userId}>)` }] });
    await deps.ops.slack.update({ channel, ts: input.question.ts, text: input.question.text, blocks });
  }
  const pickText = `Product ${n}: ${label}${sku ? ` · SKU ${sku}` : " (not in the list)"} ${pickMarker(n, sku)}`;
  const posted = await deps.ops.slack.postMessage({ channel, thread_ts: root, text: pickText, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `✓ ${say(pickText.replace(/\(epik-ai-sale:[^)]*\)/, "").trim())}` }] }] });
  if (!posted.ok || !posted.ts) return "ignored";
  return handleAiSaleMessage(deps, { channel, ts: posted.ts, threadTs: root, text: "", userId: input.userId });
}
