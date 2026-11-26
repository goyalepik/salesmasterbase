import "server-only";

import { cookies } from "next/headers";

// Two roles in the IMS, picked with the switch at the top (no separate login for now; the site's own sign-in still
// applies). Viewer: stock, incoming and the chat, without costs or values. Admin: everything, plus Sources.

export type ImsRole = "viewer" | "admin";
export const IMS_ROLE_COOKIE = "epik_ims_role";

export async function imsRole(): Promise<ImsRole> {
  const v = (await cookies()).get(IMS_ROLE_COOKIE)?.value;
  return v === "admin" ? "admin" : "viewer";
}
