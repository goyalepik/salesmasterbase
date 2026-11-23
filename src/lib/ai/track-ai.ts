import "server-only";

import { createHash } from "node:crypto";
import { readSetting, saveSetting } from "@/lib/app-setting";
import { saleModelFromEnv } from "@/lib/ai/sale-model";
import { TRACK_LABELS, type TrackOrder } from "@/lib/sheets/smb-orders";

// OpenAI on the CD tracking page, for two small jobs. Both are optional: without an AI key, or if the AI fails, the
// page works the same without them.
// 1. Names: the app's POC spellings (from the Slack form) that don't match any Sales Masterbase name are matched to
//    one, so a CD's orders never show under two names. Answers are saved, so each new spelling is asked once.
// 2. The line a CD reads to the customer, from the status and the action owner's latest remark.

const ALIASES = "poc_aliases";

/**
 * key → key for app spellings that are the same person as a Sales Masterbase name. `known` are the SMB's people
 * (pocKey form), `unknown` the app's spellings with no match. A saved "" means "asked, no match".
 */
export async function matchPocNames(known: Array<{ key: string; name: string }>, unknown: Array<{ key: string; name: string }>): Promise<Record<string, string>> {
  let saved: Record<string, string> = {};
  try {
    saved = (await readSetting<Record<string, string>>(ALIASES)) ?? {};
  } catch {
    return {};
  }
  const ask = unknown.filter((u) => !(u.key in saved)).slice(0, 40);
  const model = saleModelFromEnv();
  if (ask.length && known.length && model) {
    try {
      const answer = (await model({
        name: "match_names",
        system:
          "You match salespeople's names written two ways in a retail company. Each name in 'unmatched' may be the same person as one name in 'team', written differently (initial first or last, a role like 'CDE' added, a short form, a spelling slip). Match only when you are sure. Different initials, or two different first names, are different people. When unsure, answer an empty string.",
        user: JSON.stringify({ team: known.map((k) => k.name), unmatched: ask.map((a) => a.name) }),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["matches"],
          properties: {
            matches: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["unmatched", "team"], properties: { unmatched: { type: "string" }, team: { type: "string" } } },
            },
          },
        },
      })) as { matches?: Array<{ unmatched: string; team: string }> };
      const teamKey = new Map(known.map((k) => [k.name, k.key]));
      const next = { ...saved };
      for (const a of ask) {
        const hit = answer.matches?.find((m) => m.unmatched === a.name);
        next[a.key] = (hit && teamKey.get(hit.team)) || "";
      }
      await saveSetting(ALIASES, next);
      saved = next;
    } catch {
      // Leave them unmatched this time; the next visit asks again.
    }
  }
  return Object.fromEntries(Object.entries(saved).filter(([, v]) => v));
}

const lines = globalThis as { __epikTrackLines?: Map<string, { say: string; at: number }> };
const LINE_TTL = 6 * 60 * 60 * 1000;

/**
 * One or two short sentences a CD can say to the customer, from the status and the latest remark. Null when there is
 * no remark (the fixed line is enough) or no AI. It never adds a date the remark doesn't have.
 */
export async function customerLine(o: TrackOrder): Promise<string | null> {
  if (!o.update || o.status === "delivered" || o.status === "cancelled") return null;
  const model = saleModelFromEnv();
  if (!model) return null;
  const facts = { status: TRACK_LABELS[o.status], logisticStatus: o.logisticStatus, deliveryStatus: o.deliveryStatus, latestRemark: o.update, soldOn: o.date, dispatchedOn: o.dispatchedOn };
  const key = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  lines.__epikTrackLines ??= new Map();
  const cached = lines.__epikTrackLines.get(key);
  if (cached && Date.now() - cached.at < LINE_TTL) return cached.say;
  try {
    const answer = (await model({
      name: "customer_line",
      system:
        "A customer calls their sales executive asking where their order is. From the facts only, write what the executive can say, in 1 or 2 short, polite, plain English sentences (under 35 words). Give a date only if the facts state one. Never mention staff names, POs, vendors, 'oversold', margins or internal tags. If stock isn't available or the order may be cancelled, say the team is arranging it and will call with an update.",
      user: JSON.stringify(facts),
      schema: { type: "object", additionalProperties: false, required: ["say"], properties: { say: { type: "string" } } },
    })) as { say?: string };
    const say = answer.say?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
    if (say) lines.__epikTrackLines.set(key, { say, at: Date.now() });
    return say;
  } catch {
    return null;
  }
}
