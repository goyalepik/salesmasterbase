import { POLICY } from "./config";
import type { Entities } from "./types";

const BRANDS = ["dreame", "ecovacs", "narwal", "roborock", "ilife", "eufy", "nutricook", "google pixel", "pixel", "ray-ban", "meta", "apple", "iphone", "samsung", "epson", "philips", "dyson", "lg", "sony", "xiaomi", "agaro", "delonghi", "kent", "eureka forbes", "hp", "canon", "oneplus"];
const CITIES = ["bangalore", "bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad", "pune", "gurgaon", "noida", "mysore", "mysuru"];

function inRanges(pin: number, zone: { ranges: number[][]; extra: number[] }): boolean {
  return zone.ranges.some(([a, b]) => pin >= a && pin <= b) || zone.extra.includes(pin);
}

/** A valid Indian PIN code is 6 digits and does not start with 0. */
export function pincodeInfo(pin: string): { valid: boolean; inBangalore: boolean; codEligible: boolean } {
  const valid = /^[1-9]\d{5}$/.test(pin);
  const n = Number(pin);
  return { valid, inBangalore: valid && inRanges(n, POLICY.bangalore), codEligible: valid && inRanges(n, POLICY.cod) };
}

/** Order numbers, pincode, phone, amount, brand, city, date and payment method from the customer's text. */
export function extractEntities(text: string): Entities {
  const lower = text.toLowerCase();
  const orderRefs = [...new Set([...text.matchAll(/#?\bPIK[-\s]?(\d{3,6})\b/gi)].map((m) => `PIK${m[1]}`))];
  // A 6-digit pincode, ideally after "pin"/"pincode"; 5-digit numbers after "pin" are kept so they can be shown as invalid.
  const pinNear = lower.match(/\b(?:pin(?:\s*code)?|pincode|zip)\s*[:\-]?\s*(\d{5,6})\b/);
  const pinBare = lower.match(/(?<![\d+])\b([1-9]\d{5})\b(?!\d)/);
  const pincode = pinNear?.[1] ?? pinBare?.[1];
  const phoneMatch = text.match(/(?:\+?91[\s-]?)?\b([6-9]\d{9})\b/);
  const amount = lower.match(/(?:₹|rs\.?|inr|rupees?)\s*([\d,]+(?:\.\d+)?)\s*(k|lakh|lac)?|\b([\d,]+(?:\.\d+)?)\s*(k|lakh|lac)?\s*(?:rupees|rs)\b/);
  let amountRupees: number | undefined;
  if (amount) {
    const base = Number((amount[1] ?? amount[3] ?? "").replace(/,/g, ""));
    const unit = amount[2] ?? amount[4];
    amountRupees = Number.isFinite(base) ? base * (unit === "k" ? 1000 : unit === "lakh" || unit === "lac" ? 100000 : 1) : undefined;
  }
  const date = lower.match(/\b(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)\b/)?.[1];
  const paymentMethod = /\b(cod|cash on delivery|pay on delivery)\b/.test(lower) ? "cod" : /\bemi\b/.test(lower) ? "emi" : /\b(prepaid|upi|card|online payment|paid online)\b/.test(lower) ? "prepaid" : undefined;
  const info = pincode ? pincodeInfo(pincode) : null;
  return {
    orderRefs,
    pincode,
    pincodeValid: info?.valid,
    inBangalore: info?.inBangalore,
    codEligible: info?.codEligible,
    phone: phoneMatch ? `+91${phoneMatch[1]}` : undefined,
    amountRupees,
    brands: BRANDS.filter((b) => new RegExp(`\\b${b}\\b`).test(lower)),
    city: CITIES.find((c) => new RegExp(`\\b${c}\\b`).test(lower)),
    date,
    paymentMethod,
  };
}
