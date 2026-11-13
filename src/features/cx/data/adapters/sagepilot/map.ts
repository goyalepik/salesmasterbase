import type { IncomingMessage } from "../../../domain/service";
import { stripHtml } from "../../../domain/text";
import type { Channel, MessageAuthor, SagepilotInfo } from "../../../domain/types";

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

// --- v5: authorship, clean text, Sagepilot fields -------------------------------------------------

export type CleanMessage = { spId: string; author: MessageAuthor; text: string; at: string };

/** Sagepilot roles: user = the customer; pilot = Aliya (AI); agent = a person; system; private = an internal note. */
export function authorOf(role: string | null | undefined): MessageAuthor {
  switch ((role ?? "").toLowerCase()) {
    case "user": return "customer";
    case "pilot": return "ai";
    case "agent": return "agent";
    case "private": return "note";
    default: return "system";
  }
}

/** Every message with its author and clean text (no HTML; for public comments, only the customer's own words). */
export function cleanMessages(raw: Array<Message & { id?: string }>): CleanMessage[] {
  return raw
    .map((m, i) => {
      const author = authorOf(m.role);
      const content = m.content ?? "";
      const text = (author === "customer" ? publicComment(content) ?? stripHtml(content) : stripHtml(content)).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return { spId: m.id ?? `${m.created_at}#${i}`, author, text, at: m.created_at };
    })
    .filter((m) => m.text || m.author === "customer")
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** "demo missed", "Demo Missed " and "DEMO MISSED" are one tag. */
export function normaliseTag(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.name === "string") out.push(o.name);
    else Object.values(o).forEach((v) => strings(v, out));
  }
  return out;
}

type ChatFields = {
  team_name?: string | null;
  agent_profile?: { name?: string | null } | null;
  chat_tags?: unknown[] | null;
  chat_custom_fields?: unknown[] | null;
  priority?: string | null;
  status?: string | null;
  sub_status?: string | null;
  chat_escalated_at?: string | null;
  user_csat_score?: number | null;
  inferred_csat_score?: number | null;
  created_at: string;
  last_message_created_at?: string | null;
  has_outbound_human_reply_after_last_user?: boolean | null;
};

/** Sagepilot's own view of a ticket, for the grey "In Sagepilot" line (read-only). */
export function sagepilotInfo(chat: ChatFields): SagepilotInfo {
  const tags = [...new Set(strings(chat.chat_tags ?? []).map(normaliseTag).filter(Boolean))];
  const custom = strings(chat.chat_custom_fields ?? []).join(" ").toLowerCase();
  return {
    team: chat.team_name ?? null,
    assignee: chat.agent_profile?.name ?? null,
    tags,
    priority: chat.priority ?? null,
    status: chat.status ?? null,
    subStatus: chat.sub_status ?? null,
    demoMissed: tags.includes("Demo Missed") || /demo missed/.test(custom),
    escalatedAt: chat.chat_escalated_at ?? null,
    csat: chat.user_csat_score ?? chat.inferred_csat_score ?? null,
    createdAt: chat.created_at,
    lastMessageAt: chat.last_message_created_at ?? null,
    humanReplyAfterLastUser: Boolean(chat.has_outbound_human_reply_after_last_user),
  };
}
