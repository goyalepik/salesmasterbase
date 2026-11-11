// The SalesMasterbase Home tab in Slack: the New sale buttons, and the CDE's own sales and open orders.

import { istDayBounds } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import { isTestName } from "@/lib/ops/test-mode";
import { PAYMENT_STATE_LABELS, paymentState } from "@/lib/ops/payment-status";
import { OPEN_STAGES, STAGE_LABELS, type OrderSummary } from "@/lib/ops/types";
import { inr } from "@/lib/slack/ops-cards";
import { saleHomeView } from "@/lib/slack/sale-form";
import { slackPermalink } from "@/lib/slack/schema";

const DAY = 24 * 60 * 60 * 1000;
const OPEN_SHOWN = 10;

export type HomeSales = {
  /** Today and the 4 days before (IST), not counting cancelled or test orders. */
  recent: { orders: number; offeredMinor: number };
  open: Array<{ id: string; product: string; offeredMinor: number; stage: string; link: string | null; test: boolean }>;
  moreOpen: number;
};

/** The sales a Slack user posted. Pure apart from the reads. */
export async function homeSales(store: OpsStore, slackUserId: string, now = new Date()): Promise<HomeSales> {
  const from = istDayBounds(new Date(now.getTime() - 4 * DAY)).start.toISOString();
  const [recent, open] = await Promise.all([
    store.listOrders({ createdBy: slackUserId, stage: "all", from, limit: 200 }),
    store.listOrders({ createdBy: slackUserId, stage: "open", limit: 50 }),
  ]);
  const counted = recent.items.filter((o) => o.stage !== "cancelled" && !isTestName(o.customerName));
  const row = (o: OrderSummary) => ({
    id: o.id,
    product: o.lines[0]?.productName ?? "Order",
    offeredMinor: o.offeredTotalMinor,
    stage: o.stage === "awaiting_payment" ? STAGE_LABELS[o.stage] : `${STAGE_LABELS[o.stage]} · ${PAYMENT_STATE_LABELS[paymentState(o)]}`,
    link: o.slackChannelId && o.slackMessageTs ? slackPermalink(o.slackChannelId, o.slackMessageTs) : null,
    test: isTestName(o.customerName),
  });
  const openOrders = open.items.filter((o) => OPEN_STAGES.includes(o.stage));
  return {
    recent: { orders: counted.length, offeredMinor: counted.reduce((sum, o) => sum + o.offeredTotalMinor, 0) },
    open: openOrders.slice(0, OPEN_SHOWN).map(row),
    moreOpen: Math.max(0, openOrders.length - OPEN_SHOWN),
  };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Home tab: buttons first, then "Your sales". Without sales data, just the buttons. */
export function homeView(sales: HomeSales | null) {
  const base = saleHomeView();
  if (!sales) return base;
  const blocks: unknown[] = [...base.blocks];
  blocks.push(
    { type: "header", text: { type: "plain_text", text: "Your sales" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Last 5 days*\n${sales.recent.orders} order${sales.recent.orders === 1 ? "" : "s"}` },
        { type: "mrkdwn", text: `*Offered*\n${inr(sales.recent.offeredMinor)}` },
      ],
    },
  );
  if (!sales.open.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "No open orders. Sales you post show here with their step." }] });
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Open orders*" } });
    for (const o of sales.open) {
      const name = `${o.test ? "TEST · " : ""}${o.id}`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `${o.link ? `<${o.link}|*${name}*>` : `*${name}*`} · ${esc(clip(o.product, 70))} · ${inr(o.offeredMinor)}\n_${o.stage}_` },
      });
    }
    if (sales.moreOpen) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `+${sales.moreOpen} more open orders on the dashboard.` }] });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Updates each time you open this tab. Only sales you posted from Slack show here." }] });
  return { ...base, blocks };
}
