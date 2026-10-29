import { BlockedState } from "@/components/blocked-state";
import { InboxScreen } from "@/components/inbox-screen";
import { publicSummary, readCompleteOrder } from "@/lib/orders";
import { firstParam, messageQuery } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  const query = messageQuery(params);
  const saved = firstParam(params.saved) === "1";
  const [listed, channels] = await Promise.all([
    workspace.repo.listMessages(query),
    workspace.repo.channels(),
  ]);
  const result = {
    ...listed,
    items: listed.items.map((row) => {
      const order = readCompleteOrder(row.text);
      const summary = order
        ? [
            `Name - ${order.customerName}`,
            `Product - ${order.product}`,
            `Offered price - ${order.offeredPriceMinor / 100}`,
            order.customerType ? `CX type - ${order.customerType}` : "",
            order.hub ? `Hub - ${order.hub}` : "",
            order.poc ? `POC - ${order.poc}` : "",
            order.paymentStatus ? `Payment status - ${order.paymentStatus}` : "",
            order.accessories ? `Accessories - ${order.accessories}` : "",
            order.extendedWarranty ? `Extended warranty - ${order.extendedWarranty}` : "",
            order.installation ? `Installation - ${order.installation}` : "",
          ].filter(Boolean).join("\n")
        : publicSummary(row.text) || row.preview;
      return { ...row, text: summary, preview: publicSummary(row.text) || row.preview };
    }),
  };
  const viewKey = `${query.page}|${query.q}|${query.status}|${query.channel}|${query.from}|${query.to}|${result.total}|${result.items.map((item) => `${item.id}:${item.processingStatus}:${item.review}`).join(",")}`;
  return <InboxScreen key={viewKey} result={result} query={query} channels={channels} saved={saved} />;
}
