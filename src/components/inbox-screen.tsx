"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvent } from "@/components/live-provider";
import { EmptyState, PageHeader, Pager, ReviewText, StatusText, TextButton, fieldClassName } from "@/components/ui";
import { formatDateTime, senderLabel } from "@/lib/format";
import { mergeInboxRows } from "@/lib/live/merge";
import type { ChannelOption, InboxRow, MessageQuery, PageResult } from "@/lib/types";
import { PROCESSING_STATUSES, STATUS_LABELS } from "@/lib/types";

export function InboxScreen({
  result,
  query,
  channels,
}: {
  result: PageResult<InboxRow>;
  query: MessageQuery;
  channels: ChannelOption[];
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

  const preserve = {
    q: query.q,
    status: query.status === "all" ? "" : query.status,
    channel: query.channel,
    from: query.from,
    to: query.to,
  };

  return (
    <section>
      <PageHeader
        title="Slack inbox"
        description="Original channel messages, with the fields a rules parser could read. Search does not leave this workspace."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.7fr))_auto] sm:items-end" action="/inbox">
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
        <EmptyState title="No messages match" detail="Adjust the filters, or wait for the next Slack event once live ingestion is configured." />
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
              {items.map((row) => (
                <tr key={row.id} className="border-t border-line align-top hover:bg-paper">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">
                    <Link href={`/inbox/${row.id}`}>{formatDateTime(row.eventReceivedAt)}</Link>
                  </td>
                  <td className="py-2 pr-3">{row.channelName ?? row.channelId}</td>
                  <td className="py-2 pr-3">{senderLabel(row.senderName, row.senderId)}</td>
                  <td className="py-2 pr-3">{row.customerName ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.orderReference ?? "—"}</td>
                  <td className="max-w-[280px] py-2 pr-3">{row.preview}</td>
                  <td className="py-2 pr-3"><StatusText status={row.processingStatus} /></td>
                  <td className="py-2"><ReviewText review={row.review} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/inbox" page={query.page} pageSize={query.pageSize} total={total} preserve={preserve} />
    </section>
  );
}
