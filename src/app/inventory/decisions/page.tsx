import { redirect } from "next/navigation";

// The queue moved to the Inventory home. Old links (Slack, bookmarks) still land in the right place.
export default async function DecisionsMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const show = (await searchParams).show;
  redirect(typeof show === "string" && show ? `/inventory?show=${encodeURIComponent(show)}` : "/inventory");
}
