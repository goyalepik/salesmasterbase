import "server-only";

import { cookies } from "next/headers";
import type { Actor } from "@/lib/ops/service";

export const ACTOR_COOKIE = "epik_actor";
export const DEFAULT_ACTOR = "Dashboard";

/** Letters, digits, spaces and a little punctuation. Max 40 characters. Empty means "use the default". */
export function cleanActorName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return text.replace(/[^\p{L}\p{N} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function actorName(): Promise<string> {
  const value = (await cookies()).get(ACTOR_COOKIE)?.value;
  return cleanActorName(value ? decodeURIComponent(value) : "") || DEFAULT_ACTOR;
}

/** The person pressing buttons on the dashboard. Slack role checks do not apply here. */
export async function currentActor(): Promise<Actor> {
  return { name: await actorName(), slackUserId: null };
}
