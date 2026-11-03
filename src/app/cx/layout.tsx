import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AGENTS } from "@/features/cx/domain/config";
import { devSignInAllowed, googleConfigured } from "@/features/cx/server/auth";
import { currentUser } from "@/features/cx/server/http";
import { CxShell } from "@/features/cx/ui/shell";
import "@/features/cx/cx.css";

export const metadata: Metadata = { title: "EPIK Support · Pilot" };
export const dynamic = "force-dynamic";

const ROLE_NOTE = { l1: "L1", l2: "L2", l3: "L3", admin: "Admin", viewer: "Viewer" } as const;

/** EPIK Support pilot. Hidden unless NEXT_PUBLIC_CX_PILOT=true. Each person signs in; the role comes from config. */
export default async function CxLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") notFound();
  const user = await currentUser();
  const dev = devSignInAllowed();
  const signIn = {
    google: googleConfigured(),
    dev,
    devPeople: dev ? [...AGENTS.map((a) => ({ id: a.id, name: a.name, note: ROLE_NOTE[a.role] })), { id: "admin", name: "Admin", note: "Admin" }, { id: "viewer", name: "Viewer", note: "Viewer" }] : [],
  };
  return <CxShell user={user} signIn={signIn}>{children}</CxShell>;
}
