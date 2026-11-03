import { createHmac } from "node:crypto";
import type { CxSnapshot } from "../data/adapters/mock/memory-repo";
import type { Customer } from "../domain/types";

// What leaves the server for the browser. Phone numbers never travel in full here, for any role:
// the customer key becomes an opaque reference, and numbers inside messages are masked.
// L1 and Admin can ask for one full number from the opened ticket (see /api/cx/customer).

const PHONE_IN_TEXT = /(?:\+?91[\s-]?)?(?<![\d])([6-9]\d{4})[\s-]?(\d{5})(?!\d)/g;

export function maskDigits(ten: string): string {
  return `+91 ${ten.slice(0, 2)}•••• ${ten.slice(6)}`;
}

/** "+91 98765 43210" in free text becomes "+91 98•••• 3210". */
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, (_m, a: string, b: string) => maskDigits(`${a}${b}`));
}

/** A stable, non-reversible stand-in for a phone-number key. */
export function customerRef(uid: string, secret: string): string {
  if (!uid.startsWith("+91")) return uid;
  return `c_${createHmac("sha256", secret).update(uid).digest("base64url").slice(0, 16)}`;
}

function scrub<T>(value: T): T {
  if (typeof value === "string") return maskPhonesInText(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) as T;
  return value;
}

/** The snapshot as the browser may see it. Same shape, so the UI code stays the same. */
export function redactSnapshot(s: CxSnapshot, secret: string): CxSnapshot {
  const ref = (uid: string) => customerRef(uid, secret);
  const customers: Customer[] = s.customers.map((c) => ({
    ...scrub(c),
    uid: ref(c.uid),
    display: c.uid.startsWith("+91") ? maskDigits(c.uid.slice(3)) : c.uid.startsWith("unidentified") ? "Unidentified" : c.uid,
  }));
  return {
    tickets: s.tickets.map((t) => ({ ...scrub(t), customerUid: ref(t.customerUid), entities: { ...scrub(t.entities), phone: t.entities.phone ? maskDigits(t.entities.phone.slice(3)) : undefined } })),
    events: s.events.map((e) => scrub(e)),
    customers,
    interactions: s.interactions.map((i) => ({ ...scrub(i), customerUid: ref(i.customerUid) })),
    orders: s.orders.map((o) => ({ ...o, customerUid: ref(o.customerUid) })),
    demos: s.demos.map((d) => ({ ...d, customerUid: ref(d.customerUid) })),
    calls: s.calls.map((c) => ({ ...c, customerUid: ref(c.customerUid) })),
  };
}

/** Finds the real customer key behind a reference (for the one full number L1/Admin may see). */
export function resolveRef(s: CxSnapshot, refValue: string, secret: string): string | null {
  return s.customers.find((c) => customerRef(c.uid, secret) === refValue)?.uid ?? null;
}
