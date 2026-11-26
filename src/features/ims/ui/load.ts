import "server-only";

import { firstParam } from "@/lib/query";
import { imsRole, type ImsRole } from "../role";
import { loadIms, type ImsData } from "../sources";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** What every IMS page needs: the data for the chosen period, the role, and the period's code for the picker. */
export async function loadPage(searchParams?: SearchParams): Promise<{ data: ImsData | null; role: ImsRole; r: string; q: Record<string, string | string[] | undefined> }> {
  const q = (await searchParams) ?? {};
  const r = firstParam(q.r) ?? "30d";
  const [data, role] = await Promise.all([loadIms({ range: r }), imsRole()]);
  return { data, role, r, q };
}
