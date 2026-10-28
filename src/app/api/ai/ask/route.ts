import { z } from "zod";
import { groundedAnswer } from "@/lib/ai/ground";
import { summariseFacts, AiUnavailable } from "@/lib/ai/openai";
import { factsForQuestion } from "@/lib/ai/queries";
import { allowAsk } from "@/lib/ai/rate-limit";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  question: z.string().trim().min(2).max(500),
});

export async function POST(request: Request) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") {
    return Response.json({ error: "The workspace is not ready for questions." }, { status: 503 });
  }
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
  if (!parsed.success) return Response.json({ error: "Enter a question of 2 to 500 characters." }, { status: 400 });

  const { facts } = await factsForQuestion({
    repo: workspace.repo,
    mode: workspace.mode,
    question: parsed.data.question,
    now: new Date(),
  });

  let modelText: string | null = null;
  let error: string | null = null;
  try {
    modelText = await summariseFacts(facts);
  } catch (caught) {
    error = caught instanceof AiUnavailable ? caught.message : "The model request failed.";
  }
  const answer = groundedAnswer(facts, modelText);
  return Response.json({
    available: !error,
    usedModel: answer.usedModel,
    text: answer.text,
    sources: facts.sources,
    counts: facts.counts,
    rangeLabel: facts.rangeLabel,
    error,
  });
}
