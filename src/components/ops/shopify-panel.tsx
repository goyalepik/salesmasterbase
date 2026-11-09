import { ExternalLink } from "lucide-react";
import { checkShopifyAction, createShopifyDraftAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import type { OrderDetail } from "@/lib/ops/types";
import { inr } from "@/lib/ops-ui/format";
import { adminUrl, type SlackSalesMode } from "@/lib/shopify/client";
import { draftFromHistory, draftInputFor } from "@/lib/shopify/drafts";

/** The order's Shopify side: linked #PIK, the draft waiting to be completed, or a preview of the draft. */
export function ShopifyPanel({ order, connected, slackSales, domain }: { order: OrderDetail; connected: boolean; slackSales: SlackSalesMode; domain: string | null }) {
  const asOrder = slackSales === "order";
  const draft = draftFromHistory(order);
  const lastDraftAt = [...order.events].reverse().find((e) => e.type === "shopify_draft")?.createdAt ?? "";
  const error = [...order.events].reverse().find((e) => e.type === "shopify_error" && e.createdAt > lastDraftAt);

  if (order.shopifyOrderId) {
    return <p className="text-[13px] text-muted">Linked to Shopify <b className="text-ink">{order.shopifyOrderId}</b>.</p>;
  }
  if (order.stage === "cancelled") return <p className="text-[13px] text-muted">Cancelled, so no Shopify order is needed.</p>;

  // The preview never calls Shopify: products are matched to the catalogue by SKU when the draft is really made.
  const preview = draftInputFor(order, new Map(), asOrder ? "order" : "draft");
  const input = preview.input;
  const address = input.shippingAddress as { address1?: string; zip?: string } | undefined;

  return (
    <div className="grid gap-3 text-[13px]">
      {draft ? (
        <div className="grid gap-2">
          <p className="text-ink">Draft <b>{draft.name}</b> is waiting in Shopify. Your team checks it and clicks <b>Complete</b>; the #PIK number then links here by itself.</p>
          <div className="flex flex-wrap gap-2">
            {domain && draft.numericId ? (
              <a href={adminUrl(domain, `draft_orders/${draft.numericId}`)} target="_blank" rel="noreferrer" className="btn-quiet inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13px]">
                Open in Shopify <ExternalLink size={13} />
              </a>
            ) : null}
            <ActionForm action={checkShopifyAction}><SubmitButton tone="quiet" small>Check now</SubmitButton></ActionForm>
          </div>
        </div>
      ) : connected ? (
        <div className="grid gap-2">
          <p className="text-muted">
            {asOrder
              ? "Not in Shopify yet. Sales posted in Slack become Shopify orders (payment pending) by themselves; send this one by hand:"
              : slackSales === "draft"
                ? "No draft yet. Sales posted in Slack get one automatically; make this one by hand:"
                : "Automatic Shopify orders are off. Send this one by hand:"}
          </p>
          <ActionForm action={createShopifyDraftAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <SubmitButton tone="quiet" small>{asOrder ? "Create Shopify order" : "Create Shopify draft"}</SubmitButton>
          </ActionForm>
        </div>
      ) : (
        <p className="text-muted">Shopify isn&apos;t connected yet.</p>
      )}

      {error ? <p className="text-bad">{error.summary.replace(/^Shopify draft not created: /, "Last try failed: ")}</p> : null}

      {!draft ? (
        <details className="rounded-[12px] border border-[rgba(255,255,255,0.1)] px-3 py-2">
          <summary className="cursor-pointer text-muted">What Shopify will receive</summary>
          <dl className="mt-2 grid gap-1.5">
            <div><dt className="text-faint text-[11px]">Customer</dt><dd>{order.customerName}{input.phone ? ` · ${String(input.phone)}` : ""}{input.email ? ` · ${String(input.email)}` : ""}</dd></div>
            <div><dt className="text-faint text-[11px]">Ship to</dt><dd>{address ? [address.address1, address.zip].filter(Boolean).join(", ") : "No address"}</dd></div>
            <div>
              <dt className="text-faint text-[11px]">Products at the deal price</dt>
              <dd>{preview.lines.map((l) => <span key={l.title} className="block">{l.qty} × {l.title} · {inr(l.dealMinor)}</span>)}</dd>
            </div>
            <div><dt className="text-faint text-[11px]">Tags</dt><dd>{(input.tags as string[]).join(", ")}</dd></div>
            <div><dt className="text-faint text-[11px]">Note</dt><dd className="text-muted">{String(input.note)}</dd></div>
          </dl>
          <p className="mt-2 text-[12px] text-faint">Products are matched to your Shopify catalogue by SKU, with a discount down to the deal price.{asOrder ? " The order is created with payment pending; it is never marked paid here." : ""}</p>
          {preview.warnings.filter((w) => !/goes in as a custom item/.test(w) || /no SKU yet/.test(w)).map((w) => <p key={w} className="mt-1 text-[12px] text-warn">{w}</p>)}
        </details>
      ) : null}
    </div>
  );
}
