import { sessionSecret } from "@/features/cx/server/auth";
import { handle, json } from "@/features/cx/server/http";
import { resolveRef } from "@/features/cx/server/redact";
import { loadWorkspace } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";

/** One customer's full phone number, for L1 and Admin in the opened ticket. Never in lists, never logged. */
export async function GET(request: Request) {
  return handle(async ({ store }) => {
    const ref = new URL(request.url).searchParams.get("ref") ?? "";
    const { snapshot } = await loadWorkspace(store);
    const uid = resolveRef(snapshot, ref, sessionSecret() ?? "");
    if (!uid?.startsWith("+91")) return json({ error: "No phone number for this customer." }, 404);
    const d = uid.slice(3);
    return json({ phone: `+91 ${d.slice(0, 5)} ${d.slice(5)}` });
  }, { roles: ["l1", "admin"] });
}
