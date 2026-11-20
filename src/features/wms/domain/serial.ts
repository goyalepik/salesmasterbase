// Serial numbers as the warehouse scans them. Pure: no imports, so tests, server and the scan screen share it.
//
// A scanner or a typed serial can carry spaces, invisible characters (zero-width, BOM, control codes) and mixed case.
// The normalised form is what we compare and keep unique; the raw form is what we show. Serials are always text, so
// leading zeros survive.

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;

/** Trimmed, upper-case, with every space and invisible character removed. "" when nothing is left. */
export function normalizeSerial(raw: string): string {
  return raw.replace(INVISIBLE, "").replace(/\s+/g, "").toUpperCase();
}

/** What we keep as "the serial as scanned": invisible characters and outer spaces removed, case kept. */
export function cleanSerial(raw: string): string {
  return raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** Letters, digits and - / . _ : #, 3 to 60 characters once normalised. */
export function serialProblem(raw: string): string | null {
  const s = normalizeSerial(raw);
  if (!s) return "The scan was empty. Scan again.";
  if (s.length < 3) return "That's too short for a serial number. Scan again.";
  if (s.length > 60) return "That's too long for a serial number. Did two barcodes scan together?";
  if (!/^[A-Z0-9\-/._:#]+$/.test(s)) return "That has characters a serial number doesn't use. Scan again or type it.";
  return null;
}

/** Our own serial for a unit that came without a barcode: EPK-U-000123. */
export function internalSerial(n: number): string {
  return `EPK-U-${String(n).padStart(6, "0")}`;
}

export function isInternalSerial(serial: string): boolean {
  return /^EPK-U-\d{6}$/.test(normalizeSerial(serial));
}
