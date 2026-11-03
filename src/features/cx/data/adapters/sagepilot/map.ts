import type { IncomingMessage } from "../../../domain/service";
import { stripHtml } from "../../../domain/text";
import type { Channel } from "../../../domain/types";

// Pure mapping from Sagepilot's shapes to ours. No network here, so it is easy to test.

type Chat = {
  id: string;
  code: string | null;
  status: string | null;
  created_at: string;
  closed_at: string | null;
  chat_escalated_at: string | null;
  first_agent_response_at: string | null;
  subject: string | null;
  summary: string | null;
  is_spam: boolean | null;
  user_csat_score: number | null;
  inferred_csat_score: number | null;
  customers: { name: string | null; email: string | null; phone: string | null; instagram_username: string | null } | null;
  channels: { kind: string | null } | null;
};
type Message = { role: string | null; content: string | null; type: string | null; created_at: string };

export type ImportedChat = {
  /** `at` is the ISO time the ticket was created in Sagepilot (JSON-safe). */
  msg: Omit<IncomingMessage, "at"> & { at: string };
  sagepilot: { id: string; code: string | null; status: string | null; closedAt: string | null; escalatedAt: string | null; firstResponseAt: string | null; firstReplyBy: "ai" | "agent" | null; csat: number | null };
};

export function channelOf(kind: string | null | undefined): Channel {
  const k = (kind ?? "").toLowerCase();
  if (k.includes("whatsapp")) return "whatsapp";
  if (k.includes("instagram")) return "instagram";
  if (k.includes("facebook") || k.includes("messenger")) return "facebook";
  if (k.includes("email") || k.includes("mail")) return "email";
  if (k.includes("sms")) return "sms";
  if (k.includes("voice") || k.includes("call") || k.includes("phone")) return "call";
  return "web_chat";
}

const COMMENT = /Customer Comment on the Post\s*([\s\S]*?)(?:Public Reply Sent to the Comment|$)/i;

/**
 * A Facebook/Instagram comment arrives with our own post caption and public reply around it.
 * Keep only the customer's comment, so our words are never classified as theirs.
 */
export function publicComment(content: string): string | null {
  const plain = stripHtml(content);
  if (!/Customer Comment on the Post/i.test(plain)) return null;
  return (plain.match(COMMENT)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** What the customer said: their first few messages; failing that, Sagepilot's subject or summary. */
export function customerWords(chat: Pick<Chat, "subject" | "summary">, messages: Message[]): string {
  const said = messages
    // Customer messages are role "user"; the type varies by channel ("message", "text" on WhatsApp, or a caption on an image).
    .filter((m) => (m.role ?? "").toLowerCase() === "user" && (m.content ?? "").trim())
    .slice(0, 4)
    .map((m) => publicComment(m.content ?? "") ?? (m.content ?? "").trim())
    .filter(Boolean);
  if (said.length) return said.join("\n").slice(0, 2000);
  return [chat.subject, chat.summary].filter(Boolean).join(". ").slice(0, 2000);
}

export function mapChat(chat: Chat, messages: Message[]): ImportedChat | null {
  if (chat.is_spam) return null;
  const text = customerWords(chat, messages);
  const c = chat.customers;
  const isPublic = messages.some((m) => (m.role ?? "").toLowerCase() === "user" && publicComment(m.content ?? "") !== null);
  // First response = the first reply by the AI (Sagepilot "pilot") or a person, after the customer wrote.
  const firstUser = messages.find((m) => (m.role ?? "").toLowerCase() === "user")?.created_at;
  const firstReply = messages.find((m) => ["pilot", "agent"].includes((m.role ?? "").toLowerCase()) && (m.content ?? "").trim() && (!firstUser || m.created_at >= firstUser));
  const replyTimes = [chat.first_agent_response_at, firstReply?.created_at].filter((t): t is string => !!t).sort();
  const firstReplyBy = firstReply && (!chat.first_agent_response_at || firstReply.created_at <= chat.first_agent_response_at) ? ((firstReply.role ?? "").toLowerCase() === "pilot" ? "ai" : "agent") : chat.first_agent_response_at ? "agent" : null;
  return {
    msg: {
      channel: channelOf(chat.channels?.kind),
      text,
      publicComment: isPublic || undefined,
      phone: c?.phone ?? undefined,
      name: c?.name ?? undefined,
      handle: c?.instagram_username ? `@${c.instagram_username.replace(/^@/, "")}` : c?.email ?? undefined,
      at: chat.created_at,
    },
    sagepilot: {
      id: chat.id,
      code: chat.code,
      status: chat.status,
      closedAt: chat.closed_at,
      escalatedAt: chat.chat_escalated_at,
      firstResponseAt: replyTimes[0] ?? null,
      firstReplyBy,
      csat: chat.user_csat_score ?? chat.inferred_csat_score ?? null,
    },
  };
}
