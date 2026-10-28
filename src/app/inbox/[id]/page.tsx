import { notFound } from "next/navigation";
import { BlockedState } from "@/components/blocked-state";
import { MessageDetailScreen } from "@/components/message-detail";
import { RefreshOnChange } from "@/components/live-provider";
import { loadWorkspace } from "@/lib/workspace";

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const { id } = await params;
  const detail = await workspace.repo.getMessage(id);
  if (!detail) notFound();
  const parentTs = detail.threadTs && detail.threadTs !== detail.slackMessageTs ? detail.threadTs : detail.slackMessageTs;
  const [replies, parent] = await Promise.all([
    workspace.repo.listThreadReplies(detail.slackChannelId, parentTs),
    detail.threadTs && detail.threadTs !== detail.slackMessageTs
      ? workspace.repo.findBySlackTs(detail.slackChannelId, detail.threadTs)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <RefreshOnChange />
      <MessageDetailScreen detail={detail} replies={replies.filter((row) => row.id !== detail.id)} parentId={parent?.id ?? null} />
    </>
  );
}
