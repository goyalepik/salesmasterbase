import type { Metadata } from "next";
import { HomePage } from "@/features/home/home-page";
import { actorName } from "@/lib/ops-ui/actor";
import { loadWorkspace } from "@/lib/workspace";
import "@/features/home/home.css";

export const metadata: Metadata = { title: "EPIK" };

export default async function Home() {
  const [workspace, name] = await Promise.all([loadWorkspace(), actorName()]);
  return <HomePage name={name} mode={workspace.kind === "ready" ? workspace.mode : "blocked"} />;
}
