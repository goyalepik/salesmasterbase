import "server-only";

import { cookies } from "next/headers";

// Three roles in the IMS, picked with the switch at the top (no separate login yet; the site's own sign-in applies).
// Viewer (founders, investors): sees everything, money included, changes nothing.
// Editor (ops): also uploads bills (stock in) and updates PO and delivery statuses.
// Admin: also sources, categories and data checks.

export type ImsRole = "viewer" | "editor" | "admin";
export const IMS_ROLES: ImsRole[] = ["viewer", "editor", "admin"];
export const IMS_ROLE_COOKIE = "epik_ims_role";

export async function imsRole(): Promise<ImsRole> {
  const v = (await cookies()).get(IMS_ROLE_COOKIE)?.value;
  return v === "admin" || v === "editor" ? v : "viewer";
}

export const canEdit = (r: ImsRole) => r === "editor" || r === "admin";
