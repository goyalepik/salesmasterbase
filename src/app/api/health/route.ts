import { inspectHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { report } = await inspectHealth();
  return Response.json(report);
}
