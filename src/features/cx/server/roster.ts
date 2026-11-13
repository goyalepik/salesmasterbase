import { ROSTER } from "../domain/config";
import type { Agent } from "../domain/types";
import type { CxStore } from "./store";

// The live roster: the config file, with Admin's edits from Settings (cx:cfg:users) on top. An edit with the same id
// replaces the config entry; new ids are added. Nobody is ever deleted, only made inactive.

export type RosterEntry = Agent;

export async function loadRoster(store: CxStore): Promise<Agent[]> {
  const overrides = (await store.getConfig<Agent[]>("users").catch(() => null)) ?? [];
  const byId = new Map(ROSTER.map((a) => [a.id, a]));
  for (const o of overrides) byId.set(o.id, { ...byId.get(o.id), ...o });
  return [...byId.values()];
}
