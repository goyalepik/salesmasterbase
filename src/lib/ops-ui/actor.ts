import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { readEnv } from "@/lib/env";
import { getOpsStore } from "@/lib/ops";
import type { Actor } from "@/lib/ops/service";
import type { Person } from "@/lib/ops/types";
import { PERSON_COOKIE, personFromCookie, spacesFor } from "@/lib/team-login";
import type { SpaceId } from "@/lib/spaces";

export const ACTOR_COOKIE = "epik_actor";
export const DEFAULT_ACTOR = "Dashboard";

/** Letters, digits, spaces and a little punctuation. Max 40 characters. Empty means "use the default". */
export function cleanActorName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return text.replace(/[^\p{L}\p{N} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export type Session =
  /** Signed in with the main code (or demo mode): everything, named by the "Acting as" label. */
  | { kind: "admin"; person: null; name: string; spaces: SpaceId[] }
  /** Signed in with a personal code: their name, their areas, their buttons. */
  | { kind: "person"; person: Person; name: string; spaces: SpaceId[] }
  /** A personal sign-in for someone no longer on the Team roles list. */
  | { kind: "removed"; person: null; name: string; spaces: SpaceId[] };

const ALL: SpaceId[] = ["command", "sales", "payments", "inventory", "delivery"];

/** Who is using the dashboard right now. Read once per request. */
export const currentSession = cache(async (): Promise<Session> => {
  const jar = await cookies();
  const label = jar.get(ACTOR_COOKIE)?.value;
  const name = cleanActorName(label ? decodeURIComponent(label) : "") || DEFAULT_ACTOR;
  const id = personFromCookie(readEnv().dashboardAccessCode ?? undefined, jar.get(PERSON_COOKIE)?.value);
  if (!id) return { kind: "admin", person: null, name, spaces: ALL };
  const store = await getOpsStore();
  const person = store ? (await store.people().catch(() => [])).find((p) => p.slackUserId === id) ?? null : null;
  if (!person || !person.roles.length) return { kind: "removed", person: null, name: "Signed out", spaces: [] };
  return { kind: "person", person, name: person.name, spaces: spacesFor(person.roles) };
});

export async function actorName(): Promise<string> {
  return (await currentSession()).name;
}

/**
 * The person pressing buttons on the dashboard. A personal sign-in carries their Slack ID, so the service checks
 * their roles exactly as it does for Slack buttons. The main code (admin) can press everything.
 */
export async function currentActor(): Promise<Actor> {
  const session = await currentSession();
  if (session.kind === "person") return { name: session.person.name, slackUserId: session.person.slackUserId };
  if (session.kind === "removed") return { name: "Removed user", slackUserId: "REMOVED" };
  return { name: session.name, slackUserId: null };
}

/** Admin pages (Settings): the main code, or a person with the Admin role. */
export async function isAdmin(): Promise<boolean> {
  const session = await currentSession();
  return session.kind === "admin" || (session.kind === "person" && session.person.roles.includes("admin"));
}
