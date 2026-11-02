import type { Metadata } from "next";
import { TrackerApp } from "@/features/tracker/ui/tracker-app";
import "@/features/tracker/tracker.css";

export const metadata: Metadata = { title: "Team Tracker · EPIK" };

export default function TrackerPage() {
  return <TrackerApp />;
}
