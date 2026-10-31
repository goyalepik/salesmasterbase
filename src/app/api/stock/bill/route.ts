import { NextResponse, type NextRequest } from "next/server";
import { BILL_MAX_BYTES, BILL_TYPES, parseBill } from "@/lib/ai/bill";
import { readEnv } from "@/lib/env";
import { getOpsStore } from "@/lib/ops";
import { matchBill } from "@/lib/ops-ui/bill-match";
import { log } from "@/lib/log";

export const maxDuration = 60;

/** Upload a bill photo or PDF; get back its product lines matched to SKUs, for review. Nothing is saved here. */
export async function POST(request: NextRequest) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Bill reading needs the OpenAI key (OPENAI_API_KEY) in Vercel." }, { status: 503 });
  const store = await getOpsStore();
  if (!store) return NextResponse.json({ error: "Stock is not available." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a bill photo or PDF." }, { status: 400 });
  if (!(BILL_TYPES as readonly string[]).includes(file.type)) return NextResponse.json({ error: "Use a photo (JPG, PNG) or a PDF." }, { status: 400 });
  if (file.size > BILL_MAX_BYTES) return NextResponse.json({ error: "The file is over 4 MB. Take a smaller photo or compress the PDF." }, { status: 400 });

  try {
    const bill = await parseBill({ bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, name: file.name }, { apiKey: key, model: readEnv().openaiModel });
    if (!bill.lines.length) return NextResponse.json({ error: "No products found on this bill. Try a clearer photo of the item rows." }, { status: 422 });
    const lines = await matchBill(store, bill.lines, bill.vendor);
    return NextResponse.json({ vendor: bill.vendor, invoiceNo: bill.invoiceNo, invoiceDate: bill.invoiceDate, lines }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    log("error", "bill_parse_failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "The AI could not read this bill. Try again, or a clearer photo." }, { status: 502 });
  }
}
