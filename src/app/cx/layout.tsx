import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CxShell } from "@/features/cx/ui/shell";
import "@/features/cx/cx.css";

export const metadata: Metadata = { title: "EPIK Support · Pilot" };

/** EPIK Support pilot. Hidden unless NEXT_PUBLIC_CX_PILOT=true. */
export default function CxLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") notFound();
  return <CxShell>{children}</CxShell>;
}
