import { buildSyntheticSeed } from "@/features/cx/data/seed/synthetic";
import { handle, json } from "@/features/cx/server/http";
import { sharedMemoryKv } from "@/features/cx/server/kv";
import { dropIndex } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Admin, local or test store only: start again with the sample week or with nothing. The shared store (Vercel KV)
 * is never wiped from here: deleting stored events is not allowed.
 */
export async function POST(request: Request) {
  return handle(async ({ store }) => {
    if (store.kind !== "mock") return json({ error: "The shared store is never wiped. Use showcase data instead." }, 403);
    const { to } = (await request.json().catch(() => ({}))) as { to?: string };
    if (to === "sample" && process.env.CX_ALLOW_SAMPLE !== "true" && process.env.NODE_ENV === "production") return json({ error: "Sample data is switched off here." }, 403);
    if (to !== "sample" && to !== "empty") return json({ error: "Reset to what?" }, 400);
    sharedMemoryKv().clear();
    dropIndex();
    if (to === "sample") {
      const seed = await buildSyntheticSeed(new Date());
      await store.commit({ tickets: seed.tickets, events: seed.events, customers: seed.customers, interactions: seed.interactions, calls: seed.calls });
      await store.setMeta({ source: "sample" });
    } else await store.setMeta({ source: "empty" });
    return json({ version: await store.version() });
  }, { can: "settings" });
}
