import { KEYWORDS } from "./config";

// "Aliya confirmed…", "The agent said…": a sentence whose subject is the AI or an agent, followed by what it did.
const AGENT_SUBJECT = /^\s*(the\s+)?(agent|ai|assistant|bot|aliya|system)\s+(said|says|confirmed|replied|asked|informed|told|shared|provided|explained|offered|suggested|responded|has|had|will|is|was|sent|apologi[sz]ed|escalated|checked|assured|requested|advised)\b/i;
const EMOJI = /\p{Extended_Pictographic}/gu;
const SAD_EMOJI = /[😡😠🤬😤😞😢😭👎💔]/u;
const HAPPY_EMOJI = /[😀😃😄😊🙂😍👍🙏❤️🥰]/u;

/**
 * Keeps only what the customer said. Sagepilot summaries mix the customer's words with the AI's
 * ("Aliya confirmed the order…"); those agent sentences caused most false matches.
 */
export function customerText(raw: string): string {
  return raw
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !AGENT_SUBJECT.test(sentence))
    .join(" ")
    .trim();
}

/** WhatsApp and web messages can arrive with HTML (<br />, links): keep only the words. */
export function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** The ready-made text WhatsApp sends when someone taps a Facebook or Instagram ad. */
export const AD_CLICK = /\bhi!?\s*i['’]?d like to know more[.!]?/gi;

export type Normalised ={ text: string; emoji: "sad" | "happy" | null; caps: number; bangs: number };

/** Lowercase, no links or emoji, Hinglish and Bengali phrases mapped to plain English tokens. */
export function normalise(raw: string): Normalised {
  const letters = raw.replace(/[^A-Za-z]/g, "");
  const caps = letters.length >= 8 ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
  const bangs = (raw.match(/[!?]{2,}/g) ?? []).length;
  const emoji = SAD_EMOJI.test(raw) ? "sad" : HAPPY_EMOJI.test(raw) ? "happy" : null;
  let text = stripHtml(raw)
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(EMOJI, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  for (const rule of KEYWORDS.normalise) text = text.replace(new RegExp(`\\b(${rule.from})\\b`, "g"), ` ${rule.to} `);
  text = text.replace(/\s+/g, " ").trim();
  return { text, emoji, caps, bangs };
}
