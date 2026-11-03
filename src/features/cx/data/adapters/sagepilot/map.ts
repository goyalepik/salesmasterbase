import type { IncomingMessage } from "../../../domain/service";
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
  sagepilot: { id: string; code: string | null; status: string | null; closedAt: string | null; escalatedAt: string | null; firstResponseAt: string | null; csat: number | null };
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

/** What the customer said: their first few messages; failing that, Sagepilot's subject or summary. */
export function customerWords(chat: Pick<Chat, "subject" | "summary">, messages: Message[]): string {
  const said = messages
    .filter((m) => (m.role ?? "").toLowerCase() === "user" && (m.type ?? "message") === "message" && (m.content ?? "").trim())
    .slice(0, 4)
    .map((m) => (m.content ?? "").trim());
  if (said.length) return said.join("\n").slice(0, 2000);
  return [chat.subject, chat.summary].filter(Boolean).join(". ").slice(0, 2000);
}

export function mapChat(chat: Chat, messages: Message[]): ImportedChat | null {
  if (chat.is_spam) return null;
  const text = customerWords(chat, messages);
  const c = chat.customers;
  return {
    msg: {
      channel: channelOf(chat.channels?.kind),
      text,
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
      firstResponseAt: chat.first_agent_response_at,
      csat: chat.user_csat_score ?? chat.inferred_csat_score ?? null,
    },
  };
}
