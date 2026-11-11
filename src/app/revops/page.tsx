import { Suspense } from "react";
import Link from "next/link";
import { checkShopifyAction, verifyPaymentAction } from "@/app/actions/ops";
import { BlockedState } from "@/components/blocked-state";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Kpi, inputClass } from "@/components/ops/bits";
import { SectionSkeleton } from "@/components/ops/overview";
import { EmptyState, PageHeader } from "@/components/ui";
import type { OpsStore } from "@/lib/ops/store";
import { PAYMENT_MODES } from "@/lib/ops/types";
import { shopifyPaymentHint } from "@/lib/ops/payment-status";
import { ShopifyHint } from "@/components/ops/order-actions";
import { age, ageHours, inr, requestNow } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { shopifyStatus, syncShopify } from "@/lib/shopify/run";
import { after } from "next/server";

export default async function RevOpsPage() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  // New website orders land here for the payment check. At most once every 5 minutes.
  after(() => syncShopify(ops.store));
  return (
    <section>
      <PageHeader title="RevOps" description="Orders waiting for a payment check. Match each one against the bank, then send it to inventory. Oldest first." />
      <Suspense fallback={null}>
        <ShopifyChecked store={ops.store} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton height={420} />}>
        <PaymentQueue store={ops.store} />
      </Suspense>
    </section>
  );
}

/** When website orders were last fetched from Shopify, so nobody wonders whether a new one is missing. */
async function ShopifyChecked({ store }: { store: OpsStore }) {
  if (!shopifyStatus().connected) return null;
  // Only a hint: if it cannot be read, the queue below still loads.
  const marks = await (async () => Promise.all([store.lastClaimAt("shopify-sync-ok:"), store.lastClaimAt("shopify-sync-error:")]))().catch(() => null);
  if (!marks) return null;
  const [ok, failed] = marks;
  const now = requestNow();
  const ago = (iso: string) => {
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    return minutes < 1 ? "just now" : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hours ago`;
  };
  const broken = !!failed && (!ok || failed > ok);
  const stale = !ok || now - Date.parse(ok) > 30 * 60_000;
  const text = broken
    ? `Website orders: the last Shopify check failed (${ago(failed!)}). Try again; if it keeps failing, Shopify access needs a look.`
    : ok
      ? `Website orders: Shopify checked ${ago(ok)}.${stale ? "" : " New ones land here on their own every few minutes."}`
      : "Website orders: not fetched from Shopify yet.";
  return (
    <div className={`-mt-2 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] ${broken ? "text-bad" : stale ? "text-warn" : "text-muted"}`}>
      <p>{text}</p>
      <ActionForm action={checkShopifyAction}><SubmitButton tone="quiet" small>Check Shopify now</SubmitButton></ActionForm>
    </div>
  );
}

async function PaymentQueue({ store }: { store: OpsStore }) {
  const { items, total } = await store.listOrders({ stage: "awaiting_payment", limit: 200 });
  const orders = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const now = requestNow();
  const stuck = orders.filter((o) => ageHours(o.createdAt, now) > 24).length;
  const offered = orders.reduce((sum, o) => sum + o.offeredTotalMinor, 0);
  return (
    <>
      <dl className="ops-grid-3">
        <Kpi label="Waiting for payment check" value={total} />
        <Kpi label="Waiting over 24 hours" value={stuck} tone={stuck ? "bad" : undefined} />
        <Kpi label="Offered price waiting" value={inr(offered)} note="Deal price, not money received." />
      </dl>
      {!orders.length ? (
        <EmptyState title="All payments checked" detail="New sales appear here as soon as they are posted." />
      ) : (
        <ul className="grid gap-2.5">
          {orders.map((order) => {
            const hours = ageHours(order.createdAt, now);
            const hint = shopifyPaymentHint(order);
            const mode = hint?.mode ?? ((PAYMENT_MODES as readonly string[]).includes(order.declaredPaymentMode ?? "") ? order.declaredPaymentMode! : "");
            const fromShopify = order.createdBy === "Shopify";
            return (
              <li key={order.id} className={`dashboard-panel ${hours > 24 ? "!border-[rgba(255,105,120,0.5)]" : ""}`}>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/orders/${encodeURIComponent(order.id)}`} className="text-[15px] font-semibold text-info">{order.id}</Link>
                      <span className="truncate text-[14px] text-ink">{order.customerName}</span>
                      <span className={`text-[12px] ${hours > 24 ? "text-bad" : "text-faint"}`}>{age(order.createdAt, now)} old</span>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-muted">{order.lines.map((l) => l.productName).join(", ")}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {[order.hub, order.poc].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-2 text-[13px]">
                      Offered <span className="font-semibold tabular-nums">{inr(order.offeredTotalMinor)}</span>
                      {order.paidMinor ? <> · paid <span className="tabular-nums text-good">{inr(order.paidMinor)}</span></> : null}
                    </p>
                    <p className={`mt-1 text-[12px] ${hint ? "text-info" : "text-warn"}`}>
                      {fromShopify ? "Shopify says" : "Sales says"}: {[order.declaredPaymentStatus?.replace(/^Shopify:\s*/, ""), order.declaredPaymentMode].filter(Boolean).join(" by ") || "nothing"}
                    </p>
                  </div>
                  <ActionForm action={verifyPaymentAction} className="grid content-start gap-2 sm:grid-cols-[1fr_1fr_1fr] sm:items-end">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="clear" value="on" />
                    <input type="hidden" name="kind" value={hint ? (hint.amountMinor >= order.offeredTotalMinor - order.paidMinor ? "full" : "advance") : /advance/i.test(order.declaredPaymentStatus ?? "") ? "advance" : "full"} />
                    <label className="block text-[12px] text-muted">
                      Amount (₹)
                      <input name="amount" required inputMode="decimal" placeholder="25000" defaultValue={hint ? String(hint.amountMinor / 100) : undefined} className={`mt-1 ${inputClass}`} />
                    </label>
                    <label className="block text-[12px] text-muted">
                      Mode
                      <select name="mode" required defaultValue={mode} className={`mt-1 ${inputClass}`}>
                        <option value="" disabled>Choose</option>
                        {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                    <label className="block text-[12px] text-muted">
                      UTR / reference
                      <input name="reference" maxLength={80} placeholder={hint ? "Finance or gateway ID" : "Optional"} className={`mt-1 ${inputClass}`} />
                    </label>
                    {hint ? <div className="sm:col-span-3"><ShopifyHint hint={hint} /></div> : null}
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                      <SubmitButton tone="good">Verify and send to inventory</SubmitButton>
                      <Link href={`/orders/${encodeURIComponent(order.id)}`} className="text-[13px] text-muted">More options</Link>
                    </div>
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
