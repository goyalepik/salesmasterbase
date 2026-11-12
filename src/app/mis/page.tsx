import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Inter, Instrument_Serif } from "next/font/google";
import { loadMis } from "@/features/mis/server/load";
import { MisApp } from "@/features/mis/ui/mis-app";
import { isAdmin } from "@/lib/ops-ui/actor";
import "@/features/mis/mis.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });

export const metadata: Metadata = { title: "MIS · EPIK" };
export const dynamic = "force-dynamic";

// The monthly investor MIS. Admins only (the main access code): it holds margins, costs and EBITDA.
export default async function MisPage() {
  if (!(await isAdmin())) redirect("/");
  const { report, problem } = await loadMis();
  return (
    <div className={`${serif.variable} ${sans.variable}`}>
      <MisApp report={report} problem={problem} />
    </div>
  );
}
