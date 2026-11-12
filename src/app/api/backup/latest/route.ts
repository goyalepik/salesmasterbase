// Admin only: download the newest backup file.

import { NextResponse } from "next/server";
import { latestBackupLink } from "@/lib/backup";
import { isAdmin } from "@/lib/ops-ui/actor";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Only an admin can download backups." }, { status: 403 });
  const link = await latestBackupLink();
  if (!link) return NextResponse.json({ error: "No backup yet. Press Back up now in Settings." }, { status: 404 });
  return NextResponse.redirect(link.url, 302);
}
