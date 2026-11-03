import { POLICY, QUEUE, scenario } from "./config";
import type { Classification, CustomerFlag, Label, Level, Priority, Routing } from "./types";

const UP: Record<Priority, Priority> = { P0: "P0", P1: "P0", P2: "P1", P3: "P2" };
const LABEL_UP: Record<Label, Label> = { Low: "Medium", Medium: "High", High: "High", VIP: "VIP" };
/** Order intent: always a person, never closed by the AI (the PIK4905 lesson). */
const ORDER_INTENT = new Set(["D1", "D6", "D7", "B12", "C8"]);

export type RoutingContext = {
  customerFlags?: CustomerFlag[];
  /** Contacts from this customer in the last 7 days, including this one. */
  contactCount?: number;
  /** Contacts about this same issue (same scenario or order), including this one. */
  sameIssueCount?: number;
  /** Missed calls from this number, including this one. */
  missedCalls?: number;
};

export function labelFor(priority: Priority, tone: "neg" | "neu" | "pos", contactCount: number): Label {
  let label: Label = priority === "P0" ? "High" : priority === "P1" ? (contactCount >= 2 ? "High" : "Medium") : priority === "P2" ? "Medium" : "Low";
  if (tone === "neg") label = LABEL_UP[label];
  return label;
}

/** Priority, label, level and queue for a classified ticket, with the reasons written out. */
export function route(c: Classification, ctx: RoutingContext = {}): Routing {
  const s = scenario(c.scenarioId);
  const explanation: string[] = [`${s.id} starts at ${s.priority}.`];
  const warnings: string[] = [];
  const flags: Routing["flags"] = [];
  let priority = c.basePriority;

  const missed = ctx.missedCalls ?? 0;
  if (s.id === "K1" && missed >= POLICY.missedCalls.bumpToP0) {
    priority = "P0";
    flags.push("must_be_human");
    explanation.push(`${missed} missed calls from this number: P0, a person must call back.`);
  } else if (s.id === "K1" && missed >= POLICY.missedCalls.bumpToP1 && priority !== "P0") {
    priority = "P1";
    explanation.push(`${missed} missed calls from this number: at least P1.`);
  }
  if ((ctx.sameIssueCount ?? 1) >= 3 && priority !== "P0") {
    priority = UP[priority];
    explanation.push(`Third contact about the same issue: moved up to ${priority}.`);
  }

  const contactCount = ctx.contactCount ?? 1;
  let label = labelFor(priority, c.sentiment.tone, contactCount);
  if (c.sentiment.tone === "neg") explanation.push("Customer sounds upset: label moved up one step.");
  const vip = ctx.customerFlags?.includes("vip") ?? false;
  if (vip) {
    label = "VIP";
    flags.push("vip");
    explanation.push("VIP customer: SLA targets are halved.");
  }

  // Policy guard: never confirm cash on delivery outside the COD zone.
  const asksCod = s.id === "D7" || c.secondaryScenarioIds.includes("D7") || c.entities.paymentMethod === "cod";
  if (asksCod && c.entities.pincode && c.entities.pincodeValid && c.entities.codEligible === false) {
    flags.push("cod_not_eligible");
    warnings.push(`Pincode ${c.entities.pincode} is outside the COD zone. Prepaid/EMI only. Do not confirm COD.`);
  } else if (asksCod && c.entities.pincode && c.entities.pincodeValid === false) {
    warnings.push(`Pincode ${c.entities.pincode} is not a valid 6-digit pincode. Check it before confirming COD.`);
  } else if (asksCod && !c.entities.pincode) {
    warnings.push("Customer wants COD. Ask for the pincode before confirming.");
  }

  let queueId = s.queue;
  let level: Level;
  const orderIntent = ORDER_INTENT.has(s.id) || c.secondaryScenarioIds.some((id) => ORDER_INTENT.has(id)) || !!c.fromAd;
  if (c.needsReview) {
    queueId = "others";
    level = "L1";
    explanation.push("Needs a person to check the classification: Others queue, L1.");
  } else if (c.forcedLevel === "L3") {
    level = "L3";
    explanation.push("Safety or legal threat: straight to L3 (CEO).");
  } else if (s.l0 && s.type === "informative" && (priority === "P2" || priority === "P3") && !orderIntent && !flags.includes("must_be_human")) {
    level = "L0";
    explanation.push("Simple information request: the AI can answer (L0).");
  } else {
    level = "L1";
    if (c.fromAd && (s.bucket === "C" || s.bucket === "X")) queueId = "sales";
    explanation.push(c.fromAd ? "Ad lead: a person from Sales follows up (L1)." : orderIntent ? "Order intent: a person must handle it (L1)." : "Needs action: L1 reviews and assigns.");
  }
  if (!QUEUE.has(queueId)) queueId = "others";

  return { priority, label, level, queueId, autoResolvable: level === "L0", flags, warnings, explanation };
}
