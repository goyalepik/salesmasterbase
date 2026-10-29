"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvent } from "@/components/live-provider";
import { EmptyState, PageHeader, Pager, ReviewText, StatusText, TextButton, fieldClassName } from "@/components/ui";
import { formatDateTime, formatInrFromMinor, senderLabel } from "@/lib/format";
import { publicSummary, readCompleteOrder } from "@/lib/orders";
import { mergeInboxRows } from "@/lib/live/merge";
import type { ChannelOption, InboxRow, MessageQuery, PageResult } from "@/lib/types";
import { PROCESSING_STATUSES, STATUS_LABELS } from "@/lib/types";

function groupInbox(items: InboxRow[]): Array<{ row: InboxRow; replies: InboxRow[] }> {
  const replies = new Set(items.filter((row) => row.threadTs && row.slackMessageTs && row.threadTs !== row.slackMessageTs && items.some((parent) => parent.slackMessageTs === row.threadTs)).map((row) => row.id));
  const groups = items.filter((row) => !replies.has(row.id)).map((row) => ({
    row,
    replies: items.filter((reply) => reply.threadTs && reply.threadTs === row.slackMessageTs && reply.id !== row.id),
  }));
  return groups.sort((a, b) => {
    const aTime = [a.row, ...a.replies].reduce((latest, row) => row.eventReceivedAt > latest ? row.eventReceivedAt : latest, "");
    const bTime = [b.row, ...b.replies].reduce((latest, row) => row.eventReceivedAt > latest ? row.eventReceivedAt : latest, "");
    return bTime.localeCompare(aTime);
  });
}

export function InboxScreen({
  result,
  query,
  channels,
  saved,
}: {
  result: PageResult<InboxRow>;
  query: MessageQuery;
  channels: ChannelOption[];
  saved: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(result.items);
  const [total, setTotal] = useState(result.total);
  const itemsRef = useRef(result.items);

  useLiveEvent((change) => {
    if (change.table === "slack_messages" && change.row) {
      const merged = mergeInboxRows(itemsRef.current, change.row, query);
      itemsRef.current = merged.items;
      setItems(merged.items);
      setTotal((count) => Math.max(0, count + merged.totalDelta));
      return;
    }
    router.refresh();
  });

  const ordersView = query.view !== "all";
  const preserve = {
    q: query.q,
    status: query.status === "all" ? "" : query.status,
    channel: query.channel,
    from: query.from,
    to: query.to,
    view: ordersView ? "" : "all",
  };

  return (
    <section>
      <PageHeader
        title={ordersView ? "Orders" : "All messages"}
        description={ordersView
          ? "A row is shown when it has a customer, a product, and an offered price. The same customer and product on the same day stays on one row."
          : "Every stored Slack line, including links, deleted notes, and half-written messages."}
        action={<Link href="/orders/new" className="text-[13px] text-info">New order</Link>}
      />
      {saved ? <p className="mb-3 text-[13px]">Order saved.</p> : null}
      <p className="mb-3 text-[13px]">
        {ordersView ? <Link href="/inbox?view=all" className="text-info">All messages</Link> : <Link href="/inbox" className="text-info">Complete orders</Link>}
      </p>
      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.7fr))_auto] sm:items-end" action="/inbox">
        {ordersView ? null : <input type="hidden" name="view" value="all" />}
        <label className="block text-[12px] text-muted">
          Search
          <input className={`mt-1 ${fieldClassName()}`} name="q" defaultValue={query.q} placeholder="Customer, order, sender, text" />
        </label>
        <label className="block text-[12px] text-muted">
          Status
          <select className={`mt-1 ${fieldClassName()}`} name="status" defaultValue={query.status}>
            <option value="all">Any</option>
            {PROCESSING_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="block text-[12px] text-muted">
          Channel
          <select className={`mt-1 ${fieldClassName()}`} name="channel" defaultValue={query.channel}>
            <option value="">Any</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name ?? channel.id}</option>)}
          </select>
        </label>
        <label className="block text-[12px] text-muted">
          From
          <input className={`mt-1 ${fieldClassName()}`} type="date" name="from" defaultValue={query.from} />
        </label>
        <label className="block text-[12px] text-muted">
          To
          <input className={`mt-1 ${fieldClassName()}`} type="date" name="to" defaultValue={query.to} />
        </label>
        <TextButton>Apply</TextButton>
      </form>
      {items.length === 0 ? (
        <EmptyState
          title={ordersView ? "No complete orders" : "No messages match"}
          detail={ordersView ? "Use New order. A Slack line without a customer, product, and offered price stays in All messages." : "Adjust the filters, or wait for the next Slack event."}
        />
      ) : ordersView ? (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Received</th>
                <th className="py-2 pr-3 font-medium">Salesperson</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 pr-3 font-medium">Offered price</th>
                <th className="py-2 pr-3 font-medium">Advance</th>
                <th className="py-2 font-medium">Thread</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const order = readCompleteOrder(row.text);
                const updates = row.threadUpdateCount ?? 0;
                return (
                  <tr key={row.id} className="border-t border-line align-top hover:bg-paper">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums"><Link href={`/inbox/${row.id}`}>{formatDateTime(row.eventReceivedAt)}</Link></td>
                    <td className="py-2 pr-3">{senderLabel(row.senderName, row.senderId)}</td>
                    <td className="py-2 pr-3">{order ? <Link href={`/customers?q=${encodeURIComponent(order.customerName)}`}>{order.customerName}</Link> : "—"}</td>
                    <td className="py-2 pr-3">{order?.product ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{order ? formatInrFromMinor(order.offeredPriceMinor) : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{order?.advanceMinor != null ? formatInrFromMinor(order.advanceMinor) : "—"}</td>
                    <td className="py-2 text-muted">{updates > 0 ? `${updates} update${updates === 1 ? "" : "s"}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Received</th>
                <th className="py-2 pr-3 font-medium">Channel</th>
                <th className="py-2 pr-3 font-medium">Sender</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Order</th>
                <th className="py-2 pr-3 font-medium">Summary</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              {groupInbox(items).map((group) => {
                const row = group.row;
                const updates = Math.max(row.threadUpdateCount ?? 0, group.replies.length);
                const reply = Boolean(row.threadTs && row.slackMessageTs && row.threadTs !== row.slackMessageTs);
                return (
                  <tr key={row.id} className="border-t border-line align-top hover:bg-paper">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">
                      <Link href={`/inbox/${row.id}`}>{formatDateTime(row.eventReceivedAt)}</Link>
                    </td>
                    <td className="py-2 pr-3">{row.channelName ?? row.channelId}</td>
                    <td className="py-2 pr-3" title={row.senderId ?? undefined}>{senderLabel(row.senderName, row.senderId)}</td>
                    <td className="py-2 pr-3">{row.customerName ? <Link href={`/customers?q=${encodeURIComponent(row.customerName)}`}>{row.customerName}</Link> : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.orderReference ?? "—"}</td>
                    <td className="max-w-[280px] py-2 pr-3">
                      <span className="block">{reply ? "Thread update · " : ""}{publicSummary(row.text) || row.preview}</span>
                      {updates > 0 ? <span className="text-[12px] text-muted">{updates} thread update{updates === 1 ? "" : "s"}</span> : null}
                    </td>
                    <td className="py-2 pr-3"><StatusText status={row.processingStatus} /></td>
                    <td className="py-2"><ReviewText review={row.review} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/inbox" page={query.page} pageSize={query.pageSize} total={total} preserve={preserve} />
    </section>
  );
}
