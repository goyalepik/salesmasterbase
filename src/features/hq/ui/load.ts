import "server-only";

import { firstParam } from "@/lib/query";
import { loadHq } from "../sources";

export type SP = Promise<Record<string, string | string[] | undefined>>;
export async function loadPage(sp?: SP) {
  const q = (await sp) ?? {};
  const r = firstParam(q.r) ?? "mtd";
  return { data: await loadHq(r), r, q };
}
