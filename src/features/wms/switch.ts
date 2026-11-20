import { chooseDataSource, readEnv } from "@/lib/env";

/**
 * The warehouse screens are on in demo mode, and on the live site only with WMS=on. Off by default, so the live site
 * keeps taking stock from the team sheet until the cut-over day (after the 0006_wms.sql tables are added).
 */
export function wmsEnabled(source: Record<string, string | undefined> = process.env): boolean {
  if (chooseDataSource(readEnv(source)) === "demo") return true;
  return (source.WMS ?? "").trim().toLowerCase() === "on";
}
