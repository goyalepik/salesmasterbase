import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { loadInsights } from "@/features/insights/server/load";
import { InsightsApp } from "@/features/insights/ui/insights-app";
import "@/features/insights/insights.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });

export const metadata: Metadata = { title: "Customer Insights · EPIK" };
export const dynamic = "force-dynamic";

// Localhost reads the report from data/; the live site reads the copy in Supabase Storage.
export default async function InsightsPage() {
  const { report, notes, problem } = await loadInsights();
  return (
    <div className={`${serif.variable} ${sans.variable}`}>
      <InsightsApp report={report} notes={notes} problem={problem} />
    </div>
  );
}
