"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { approvePaymentAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { APPROVAL_CHOICES, APPROVAL_LABELS, type ApprovalChoice } from "@/lib/ops/delivery-status";

const MODES = ["Cash", "UPI", "Card", "NEFT", "Snapmint", "Bajaj", "Other"] as const;

const DONE_EVENT = "epik-payment-approved";
type ApprovalDone = { choice: ApprovalChoice; label: string; customer: string };

/** The "Sent to logistics" box after an approval. Put it once on the page. */
export function ApprovalDoneHost() {
  const [done, setDone] = useState<ApprovalDone | null>(null);
  useEffect(() => {
    const onDone = (e: Event) => setDone((e as CustomEvent<ApprovalDone>).detail);
    window.addEventListener(DONE_EVENT, onDone);
    return () => window.removeEventListener(DONE_EVENT, onDone);
  }, []);
  useEffect(() => {
    if (!done) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDone(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done]);
  if (!done) return null;
  const cancelled = done.choice === "cancel";
  return (
    <div className="approve-layer" role="presentation" onClick={(e) => e.target === e.currentTarget && setDone(null)}>
      <div className="approve-box" role="dialog" aria-modal="true" aria-label={cancelled ? "Sale cancelled" : "Sent to logistics"}>
        <div className="approve-done">
          <CheckCircle2 size={44} className={cancelled ? "text-muted" : "text-good"} aria-hidden="true" />
          <h2>{cancelled ? "Sale cancelled" : "Sent to logistics"}</h2>
          <p>{cancelled ? `${done.label} is cancelled. Logistics won't see it.` : `${done.label} for ${done.customer} is now in logistics' To do. They'll check stock and set the status.`}</p>
          <button type="button" className="approve-submit" onClick={() => setDone(null)}>Done</button>
        </div>
      </div>
    </div>
  );
}

export type ApprovalOrder = {
  id: string;
  label: string;
  customer: string;
  totalMinor: number;
  paidMinor: number;
  declaredStatus: string | null;
  declaredMode: string | null;
};

const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** What the CDE declared, as the box's starting point: the choice, amount, mode and UTR. */
function guess(order: ApprovalOrder): { choice: ApprovalChoice; amount: string; mode: string; reference: string } {
  const status = (order.declaredStatus ?? "").toLowerCase();
  const modeText = order.declaredMode ?? "";
  const mode = MODES.find((m) => new RegExp(`\\b${m}\\b`, "i").test(modeText)) ?? "";
  const reference = /\b(?:utr|ref(?:erence)?|txn)\b[\s:#.-]*([A-Za-z0-9-]{4,40})/i.exec(modeText)?.[1] ?? "";
  const received = /₹\s?([\d,]+(?:\.\d+)?)\s*(?:received|paid)/i.exec(order.declaredStatus ?? "")?.[1]?.replace(/,/g, "") ?? "";
  const due = Math.max(0, order.totalMinor - order.paidMinor) / 100;
  if (/^partial/.test(status)) return { choice: "partial", amount: received, mode, reference };
  if (/^full paid|shopify: paid/.test(status)) return { choice: "full", amount: String(due), mode, reference };
  return { choice: "without", amount: "", mode, reference };
}

/**
 * Sales' "Approve payment" button. A small box: full paid, partial paid, without payment (with a note) or cancel.
 * On success it says the order went to logistics, then the list refreshes.
 */
export function PaymentApproval({ order }: { order: ApprovalOrder }) {
  const router = useRouter();
  const start = guess(order);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ApprovalChoice>(start.choice);
  const due = Math.max(0, order.totalMinor - order.paidMinor);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  // The row changes once approved (this button goes away), so the "Sent to logistics" box lives in ApprovalDoneHost.
  const finished = () => {
    window.dispatchEvent(new CustomEvent<ApprovalDone>(DONE_EVENT, { detail: { choice, label: order.label, customer: order.customer } }));
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button type="button" className="approve-btn" onClick={() => { setChoice(start.choice); setOpen(true); }}>
        Approve payment
      </button>
      {open ? (
        <div className="approve-layer" role="presentation" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="approve-box" role="dialog" aria-modal="true" aria-labelledby={`approve-${order.id}`}>
            <button type="button" className="approve-close" aria-label="Close" onClick={close}><X size={18} /></button>
              <ActionForm action={approvePaymentAction} resetOnSuccess={false} onSuccess={finished}>
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="choice" value={choice} />
                <p className="approve-kicker">{order.label} · {rupees(order.totalMinor)}</p>
                <h2 id={`approve-${order.id}`} className="approve-title">{order.customer}</h2>
                <p className="approve-declared">CDE said: {[order.declaredStatus, order.declaredMode].filter(Boolean).join(" · ") || "nothing about payment"}</p>

                <div className="approve-choices" role="radiogroup" aria-label="Payment">
                  {APPROVAL_CHOICES.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={choice === c} className={`approve-choice is-${c}`} onClick={() => setChoice(c)}>
                      {APPROVAL_LABELS[c]}
                    </button>
                  ))}
                </div>

                {choice === "full" || choice === "partial" ? (
                  <div className="approve-fields">
                    <label>
                      <span>{choice === "full" ? "Amount received (₹)" : "Received so far (₹)"}</span>
                      <input key={choice} name="amount" inputMode="decimal" required defaultValue={choice === "full" ? String(due / 100) : start.choice === "partial" ? start.amount : ""} placeholder={choice === "full" ? String(due / 100) : "20000"} />
                    </label>
                    <label>
                      <span>Paid by</span>
                      <select name="mode" required defaultValue={start.mode}>
                        <option value="" disabled>Choose</option>
                        {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                    <label className="is-wide">
                      <span>UTR / transaction ID (optional)</span>
                      <input name="reference" defaultValue={start.reference} maxLength={40} placeholder="431298765432" />
                    </label>
                  </div>
                ) : null}

                <label className="approve-note">
                  <span>{choice === "without" ? "Why without payment?" : choice === "cancel" ? "Why is it cancelled?" : "Note (optional)"}</span>
                  <textarea
                    key={choice}
                    name="note"
                    rows={2}
                    maxLength={300}
                    required={choice === "without" || choice === "cancel"}
                    placeholder={choice === "without" ? "e.g. Payment link sent, cash on delivery, approved finance" : choice === "cancel" ? "e.g. Customer changed mind" : "Anything logistics should know"}
                  />
                </label>

                <SubmitButton tone={choice === "cancel" ? "danger" : "primary"} className="approve-submit">
                  {choice === "cancel" ? "Cancel the sale" : "Approve and send to logistics"}
                </SubmitButton>
              </ActionForm>
          </div>
        </div>
      ) : null}
    </>
  );
}
