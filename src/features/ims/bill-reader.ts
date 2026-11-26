import "server-only";

import { readEnv } from "@/lib/env";

// Reads a bill (photo or PDF) with OpenAI: vendor, invoice number and date, billed-to entity, PO, and one line per
// product with quantity, unit cost incl. GST and any serial numbers printed. The editor checks every field before saving.

export type BillDraft = {
  vendor: string;
  invoice: string;
  invoiceDate: string | null;
  billedTo: string | null;
  po: string | null;
  lines: Array<{ description: string; qty: number; unitCost: number; serials: string[] }>;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "invoice", "invoice_date", "billed_to", "po", "lines"],
  properties: {
    vendor: { type: "string", description: "The seller's company name as printed." },
    invoice: { type: "string", description: "Invoice / bill number." },
    invoice_date: { type: ["string", "null"], description: "Invoice date as YYYY-MM-DD." },
    billed_to: { type: ["string", "null"], description: "The buyer company the bill is addressed to." },
    po: { type: ["string", "null"], description: "Purchase order number if printed (e.g. PO-EPIK-26-27-0107)." },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "qty", "unit_cost", "serials"],
        properties: {
          description: { type: "string", description: "Product description as printed, including model numbers." },
          qty: { type: "number" },
          unit_cost: { type: "number", description: "Cost of one unit in rupees INCLUDING GST (taxable value + tax, divided by qty)." },
          serials: { type: "array", items: { type: "string" }, description: "Serial / IMEI numbers printed for this line, if any." },
        },
      },
    },
  },
};

export async function readBill(name: string, type: string, data: Buffer): Promise<{ ok: true; draft: BillDraft } | { ok: false; message: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, message: "Reading bills needs an OpenAI key on the server (OPENAI_API_KEY). You can still fill the form by hand." };
  const b64 = data.toString("base64");
  const file = type === "application/pdf"
    ? { type: "file", file: { filename: name || "bill.pdf", file_data: `data:application/pdf;base64,${b64}` } }
    : { type: "image_url", image_url: { url: `data:${type};base64,${b64}`, detail: "high" } };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: readEnv().openaiModel,
      messages: [
        { role: "system", content: "You read Indian GST purchase invoices for EPIK, a consumer-durables retailer. Return exactly what is printed; never invent serials or numbers. Skip freight, discount and round-off rows." },
        { role: "user", content: [{ type: "text", text: "Read this bill." }, file] },
      ],
      response_format: { type: "json_schema", json_schema: { name: "bill", strict: true, schema: SCHEMA } },
      max_completion_tokens: 3000,
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, message: `Couldn't read the bill${res ? ` (OpenAI ${res.status})` : ""}. Fill the form by hand or try a clearer photo.` };
  try {
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const j = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as { vendor: string; invoice: string; invoice_date: string | null; billed_to: string | null; po: string | null; lines: Array<{ description: string; qty: number; unit_cost: number; serials: string[] }> };
    return {
      ok: true,
      draft: {
        vendor: j.vendor?.trim() ?? "",
        invoice: j.invoice?.trim() ?? "",
        invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(j.invoice_date ?? "") ? j.invoice_date : null,
        billedTo: j.billed_to?.trim() || null,
        po: j.po?.trim() || null,
        lines: (j.lines ?? []).filter((l) => l.description && l.qty > 0).map((l) => ({ description: l.description.trim(), qty: Math.round(l.qty), unitCost: Math.round(l.unit_cost * 100) / 100, serials: (l.serials ?? []).map((s) => s.trim()).filter(Boolean) })),
      },
    };
  } catch {
    return { ok: false, message: "The bill came back unreadable. Fill the form by hand or try a clearer photo." };
  }
}
