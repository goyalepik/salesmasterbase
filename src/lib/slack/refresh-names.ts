import type { OpsRepository } from "@/lib/repository";
import { slackDisplayName, slackProfilesAvailable } from "@/lib/slack/profiles";

export type NameRefresh = {
  status: "updated" | "missing_scope" | "no_token" | "none";
  updated: number;
};

export async function refreshSenderNames(repo: OpsRepository, token: string | null): Promise<NameRefresh> {
  if (!token) return { status: "no_token", updated: 0 };
  const available = await slackProfilesAvailable(token);
  if (!available) return { status: "missing_scope", updated: 0 };
  const ids = await repo.listUnnamedSenderIds();
  let updated = 0;
  for (const id of ids) {
    const name = await slackDisplayName(token, id);
    if (!name) continue;
    await repo.rememberSender(id, name);
    updated += 1;
  }
  return { status: updated > 0 ? "updated" : "none", updated };
}
