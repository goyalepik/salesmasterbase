import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import { allowAsk } from "@/lib/ai/rate-limit";
import { agentConfig, toolContext } from "@/lib/ai/runtime";
import { isSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().trim().min(2).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(40)
    .optional(),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request refused." }, { status: 403 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowAsk(forwarded)) {
    return Response.json({ error: "Too many questions. Wait a minute and retry." }, { status: 429 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "The question could not be read." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Enter a question of 2 to 2,000 characters." }, { status: 400 });

  const ctx = await toolContext();
  if (!ctx) return Response.json({ error: "The operations data is not configured, so the assistant cannot answer." }, { status: 503 });

  const result = await runAgent({ question: parsed.data.question, history: parsed.data.history, ctx, config: agentConfig() });
  return Response.json(result);
}
