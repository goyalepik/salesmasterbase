import { BlockedState } from "@/components/blocked-state";
import { InboxScreen } from "@/components/inbox-screen";
import { publicSummary } from "@/lib/orders";
import { messageQuery } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const query = messageQuery(await searchParams);
  const [listed, channels] = await Promise.all([
    workspace.repo.listMessages(query),
    workspace.repo.channels(),
  ]);
  const result = {
    ...listed,
    items: listed.items.map((row) => {
      const summary = publicSummary(row.text) || row.preview;
      return { ...row, text: summary, preview: summary };
    }),
  };
  const viewKey = `${query.page}|${query.q}|${query.status}|${query.channel}|${query.from}|${query.to}|${result.total}|${result.items.map((item) => `${item.id}:${item.processingStatus}:${item.review}`).join(",")}`;
  return <InboxScreen key={viewKey} result={result} query={query} channels={channels} />;
}
