import { chooseDataSource, readEnv } from "@/lib/env";

/**
 * The warehouse screens are on, in demo and on the live site. WMS=off hides them again. On the live site they also
 * wait for the 0006_wms.sql tables (see `getWms`), so nothing breaks before that step.
 */
export function wmsEnabled(source: Record<string, string | undefined> = process.env): boolean {
  if (chooseDataSource(readEnv(source)) === "demo") return true;
  return (source.WMS ?? "").trim().toLowerCase() !== "off";
}
