import "server-only";

import OpenAI from "openai";

export type BillLine = {
  description: string;
  /** Brand and model only, for the catalogue search (e.g. "Dreame L10s Ultra"). */
  model: string;
  qty: number;
  unitCost: number | null;
  serials: string[];
};

export type ParsedBill = { vendor: string | null; invoiceNo: string | null; invoiceDate: string | null; lines: BillLine[] };

export const BILL_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const BILL_MAX_BYTES = 4 * 1024 * 1024;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "invoiceNo", "invoiceDate", "lines"],
  properties: {
    vendor: { type: ["string", "null"], description: "Seller / supplier name on the bill." },
    invoiceNo: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"], description: "YYYY-MM-DD if readable." },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "model", "qty", "unitCost", "serials"],
        properties: {
          description: { type: "string", description: "Product line exactly as written on the bill." },
          model: { type: "string", description: "Brand and model only, short, no colour codes or HSN, e.g. 'Dreame L10s Ultra' or 'iPhone 15 128GB Black'." },
          qty: { type: "integer", minimum: 1 },
          unitCost: { type: ["number", "null"], description: "Price per unit in rupees before discount, including tax if the bill shows a tax-inclusive rate; null if not shown." },
          serials: { type: "array", items: { type: "string" }, description: "Serial / IMEI numbers listed for this line, if any." },
        },
      },
    },
  },
} as const;

const PROMPT = `You read purchase bills and tax invoices for EPIK, a consumer electronics retailer in India.
Return every product line that adds stock: robot vacuums, phones, TVs, appliances, accessories.
Skip freight, delivery, installation charges, discounts, round-off and tax summary rows.
Keep serial or IMEI numbers with the line they belong to. If a number is unclear, leave it out rather than guess.`;

/** Reads a bill photo or PDF into product lines with OpenAI. Throws with a plain message when it cannot. */
export async function parseBill(file: { bytes: Buffer; mime: string; name: string }, config: { apiKey: string; model: string; client?: OpenAI }): Promise<ParsedBill> {
  const client = config.client ?? new OpenAI({ apiKey: config.apiKey, timeout: 45_000, maxRetries: 1 });
  const data = `data:${file.mime};base64,${file.bytes.toString("base64")}`;
  const part =
    file.mime === "application/pdf"
      ? ({ type: "file", file: { filename: file.name || "bill.pdf", file_data: data } } as const)
      : ({ type: "image_url", image_url: { url: data, detail: "high" } } as const);
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: [{ type: "text", text: "Read this bill." }, part] },
    ],
    response_format: { type: "json_schema", json_schema: { name: "bill", strict: true, schema: SCHEMA as unknown as Record<string, unknown> } },
    max_completion_tokens: 3000,
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("The AI could not read this bill. Try a clearer photo.");
  const parsed = JSON.parse(text) as ParsedBill;
  return {
    vendor: parsed.vendor?.trim() || null,
    invoiceNo: parsed.invoiceNo?.trim() || null,
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoiceDate ?? "") ? parsed.invoiceDate : null,
    lines: (parsed.lines ?? [])
      .filter((line) => line.description?.trim() && Number.isInteger(line.qty) && line.qty > 0)
      .slice(0, 40)
      .map((line) => ({
        description: line.description.trim().slice(0, 200),
        model: (line.model || line.description).trim().slice(0, 80),
        qty: Math.min(line.qty, 1000),
        unitCost: typeof line.unitCost === "number" && line.unitCost > 0 ? line.unitCost : null,
        serials: [...new Set((line.serials ?? []).map((s) => s.trim()).filter((s) => /^[A-Za-z0-9\-/]{4,40}$/.test(s)))].slice(0, line.qty),
      })),
  };
}
