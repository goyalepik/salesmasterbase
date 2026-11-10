// Test mode: a sale whose customer name starts with "TEST" is a practice run. It makes no Shopify order, stays out of
// Sales Records and every number, carries a TEST label, and Settings → Clear test orders removes it.

/** True for "TEST", "Test Bhavya", "test-2". Not for "Testarossa". */
export function isTestName(name: string | null | undefined): boolean {
  return /^\s*test(\b|[\s\-_:])/i.test(name ?? "");
}

/** The legacy sale text posted in Slack ("Name - TEST Bhavya …"). */
export function isTestSaleText(text: string): boolean {
  const name = /^\s*(?:\*\s*)?name\s*[-:]\s*(.+)$/im.exec(text)?.[1];
  return isTestName(name);
}

/** Discounts bigger than this show a flag on the card and the order page. */
export const DISCOUNT_FLAG_SHARE = 0.15;

/** How far the offered price is below the Shopify list price, over the products that have one. Null when not flagged. */
export function discountFlag(lines: Array<{ listPriceMinor: number | null; offeredPriceMinor: number; qty: number }>): { share: number; listMinor: number; offeredMinor: number } | null {
  let listMinor = 0;
  let offeredMinor = 0;
  for (const line of lines) {
    if (!line.listPriceMinor || line.listPriceMinor <= 0) continue;
    listMinor += line.listPriceMinor * line.qty;
    offeredMinor += line.offeredPriceMinor * line.qty;
  }
  if (!listMinor || offeredMinor >= listMinor) return null;
  const share = (listMinor - offeredMinor) / listMinor;
  return share > DISCOUNT_FLAG_SHARE ? { share, listMinor, offeredMinor } : null;
}

/** The UTR or reference inside the CDE's payment line ("UPI, UTR 431298765432"). */
export function declaredUtr(mode: string | null | undefined): string | null {
  const match = /\b(?:utr|ref(?:erence)?|txn)\b[\s:#.-]*([A-Za-z0-9]{6,40})/i.exec(mode ?? "");
  return match?.[1] ?? null;
}
