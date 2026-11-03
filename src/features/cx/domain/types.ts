// EPIK Support (CX pilot) domain types. Field names are stable so a later Supabase mapping is one-to-one.

export type Channel = "call" | "missed_call" | "whatsapp" | "sms" | "email" | "instagram" | "facebook" | "web_chat";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Label = "Low" | "Medium" | "High" | "VIP";
export type Level = "L0" | "L1" | "L2" | "L3";
export type TicketType = "informative" | "actionable";
export type Status = "new" | "open" | "in_progress" | "on_hold" | "pending_customer" | "resolved" | "closed" | "reopened";
export type HoldReason = "brand" | "customer" | "internal";
export type LeadOutcome = "picked" | "not_picked" | "pending";
export type Role = "l1" | "l2" | "l3" | "admin" | "viewer";

export type CustomerLabel = "new" | "happy" | "average" | "unhappy";
export type CustomerFlag = "vip" | "repeat_complainer" | "unpaid_order" | "missed_demo" | "outside_cod_zone" | "unidentified";

export type Customer = {
  /** E.164 phone, or `unidentified:<channel>:<handle>`. */
  uid: string;
  name?: string;
  handles: Array<{ channel: Channel; handle: string }>;
  firstSeenAt: string;
  flags: CustomerFlag[];
  /** Latest satisfaction score, 1–5, when known. */
  csat?: number;
  /** Set by the server for the browser: the masked phone, e.g. "+91 98•••• 4417". */
  display?: string;
};

export type Interaction = {
  id: string;
  channel: Channel;
  direction: "inbound" | "outbound";
  customerUid: string;
  text?: string;
  durationSec?: number;
  outcome?: "connected" | "not_connected" | "voicemail";
  at: string;
  source: "sagepilot" | "telephony" | "manual" | "seed";
};

export type Entities = {
  orderRefs: string[];
  pincode?: string;
  pincodeValid?: boolean;
  inBangalore?: boolean;
  codEligible?: boolean;
  phone?: string;
  amountRupees?: number;
  brands: string[];
  city?: string;
  date?: string;
  paymentMethod?: "cod" | "prepaid" | "emi";
};

export type Sentiment = { tone: "neg" | "neu" | "pos"; score: number; signals: string[] };

export type Classification = {
  bucket: string;
  scenarioId: string;
  secondaryScenarioIds: string[];
  type: TicketType;
  basePriority: Priority;
  confidence: number;
  /** Why: matched rules and keywords, in plain words. */
  explanation: string[];
  hardRule: string | null;
  forcedLevel: Level | null;
  entities: Entities;
  sentiment: Sentiment;
  needsReview: boolean;
  /** Came from a Facebook/Instagram ad: a sales lead, never closed by the AI. */
  fromAd?: boolean;
};

export type Routing = {
  priority: Priority;
  label: Label;
  level: Level;
  queueId: string;
  autoResolvable: boolean;
  flags: Array<"cod_not_eligible" | "must_be_human" | "vip">;
  warnings: string[];
  explanation: string[];
};

export type Ticket = {
  id: string;
  customerUid: string;
  channel: Channel;
  createdAt: string;
  subject: string;
  body: string;
  bucket: string;
  scenarioId: string;
  secondaryScenarioIds: string[];
  type: TicketType;
  priority: Priority;
  label: Label;
  level: Level;
  queueId: string;
  ownerId?: string;
  status: Status;
  holdReason?: HoldReason;
  orderRef?: string;
  entities: Entities;
  confidence: number;
  explanation: string[];
  warnings: string[];
  sentiment: Sentiment;
  contactCount: number;
  leadOutcome?: LeadOutcome;
  slaFirstResponseDueAt: string;
  slaResolutionDueAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  reopenCount: number;
  parentTicketId?: string;
  closeReason?: string;
  /** The same ticket in another system (read-only), e.g. Sagepilot. */
  external?: { system: "sagepilot"; id: string; code: string | null };
};

export type EventKind =
  | "created" | "classified" | "priority_changed" | "level_changed" | "assigned" | "ownership_taken"
  | "work_started" | "work_stopped" | "hold_started" | "hold_ended" | "customer_replied" | "agent_replied"
  | "note_added" | "outbound_call_logged" | "sla_at_risk" | "sla_breached" | "resolved" | "closed"
  | "reopened" | "lead_outcome_set" | "override";

/** Append-only. Every metric is computed from these. */
export type TicketEvent = {
  id: string;
  ticketId: string;
  at: string;
  /** "ai", "system" or a user id. */
  actorId: string;
  kind: EventKind;
  payload: Record<string, unknown>;
};

export type Queue = { id: string; name: string; level: Level; ownerId: string; backupId: string; scenarioIds: string[] };
export type Agent = { id: string; name: string; role: Role; queueIds: string[] };

export type Order = { ref: string; customerUid: string; at: string; product: string; amountRupees: number; payment: "cod" | "prepaid" | "emi"; status: "placed" | "paid" | "delivered" | "cancelled" | "unpaid" };
export type Demo = { id: string; customerUid: string; at: string; product: string; status: "booked" | "completed" | "missed" | "cancelled" };
export type CallRecord = { id: string; customerUid: string; at: string; direction: "inbound" | "outbound"; outcome: "connected" | "missed" | "not_connected"; durationSec: number };
