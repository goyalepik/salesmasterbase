import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { authMode, googleConfigured, LEVEL_COOKIE, readLevelPass, sessionSecret } from "@/features/cx/server/auth";
import { currentUser } from "@/features/cx/server/http";
import { loadRoster } from "@/features/cx/server/roster";
import { getCxStore } from "@/features/cx/server/store";
import { CxShell } from "@/features/cx/ui/shell";
import "@/features/cx/cx.css";

export const metadata: Metadata = { title: "EPIK Support · Pilot" };
export const dynamic = "force-dynamic";

const LEVEL_NAME = { l1: "L1 · CX lead", l2: "L2 · Department", l3: "L3 · CEO", admin: "Admin", viewer: "Viewer" } as const;

/**
 * EPIK Support pilot. Hidden unless NEXT_PUBLIC_CX_PILOT=true. Sign-in is a code for your level, then your name from
 * that level's roster; rights come from the level.
 */
export default async function CxLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") notFound();
  const store = getCxStore();
  const user = await currentUser(store).catch(() => null);
  let pick: { level: string; levelName: string; people: Array<{ id: string; name: string; department: string }> } | null = null;
  if (!user) {
    const level = readLevelPass((await cookies()).get(LEVEL_COOKIE)?.value, sessionSecret());
    if (level) {
      const roster = await loadRoster(store).catch(() => []);
      pick = { level, levelName: LEVEL_NAME[level], people: roster.filter((p) => p.role === level && p.active !== false).map((p) => ({ id: p.id, name: p.name, department: p.department ?? "" })) };
    }
  }
  const signIn = { mode: authMode(), google: authMode() === "google" && googleConfigured(), pick };
  return <CxShell user={user} signIn={signIn}>{children}</CxShell>;
}
