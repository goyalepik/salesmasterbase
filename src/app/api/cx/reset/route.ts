import { buildSyntheticSeed } from "@/features/cx/data/seed/synthetic";
import { handle, json } from "@/features/cx/server/http";

export const dynamic = "force-dynamic";

/** Admin: start again with the sample week (only where sample data is allowed) or with nothing. */
export async function POST(request: Request) {
  return handle(async ({ store }) => {
    const { to } = (await request.json().catch(() => ({}))) as { to?: string };
    if (to === "sample") {
      if (process.env.CX_ALLOW_SAMPLE !== "true" && process.env.NODE_ENV === "production") return json({ error: "Sample data is switched off here." }, 403);
      return json({ version: await store.replaceAll(await buildSyntheticSeed(new Date()), { source: "sample" }) });
    }
    if (to === "empty") return json({ version: await store.replaceAll({ tickets: [], events: [], customers: [], interactions: [], orders: [], demos: [], calls: [] }, { source: "empty" }) });
    return json({ error: "Reset to what?" }, 400);
  }, { roles: ["admin"] });
}
