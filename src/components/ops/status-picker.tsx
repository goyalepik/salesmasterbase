"use client";

import { useRef, useState } from "react";
import { deliveryStatusAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { DELIVERY_CODES, PICKABLE_STATUSES, statusOptionLabel, type DeliveryStatus } from "@/lib/ops/delivery-status";

/**
 * The inventory team's status control. Picking a status saves at once (and syncs to the SMB sheet, the Slack card and
 * the salespeople's page). Cancelled asks for a reason first. Expected date, driver and a note are one tap away.
 */
export function StatusPicker({
  orderId,
  status,
  expectedDate,
  driver,
  label,
}: {
  orderId: string;
  status: DeliveryStatus;
  expectedDate: string | null;
  driver: string | null;
  label: string;
}) {
  const [picked, setPicked] = useState<DeliveryStatus>(status);
  const [more, setMore] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const cancelling = picked === "cancelled" && status !== "cancelled";
  const options = PICKABLE_STATUSES.includes(status) ? PICKABLE_STATUSES : [status, ...PICKABLE_STATUSES];

  return (
    <ActionForm action={deliveryStatusAction} resetOnSuccess={false} className="status-picker">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="status-picker-row" ref={(el) => void (formRef.current = el?.closest("form") ?? null)}>
        <select
          name="status"
          value={picked}
          aria-label={`Status of ${label}`}
          className={`status-select is-${picked}`}
          onChange={(e) => {
            const next = e.target.value as DeliveryStatus;
            setPicked(next);
            // Everything but Cancelled saves straight away.
            if (next !== "cancelled" && next !== status) window.setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
        >
          {options.map((s) => (
            <option key={s} value={s}>{statusOptionLabel(s)}</option>
          ))}
        </select>
        {!cancelling ? (
          <button type="button" className="status-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "Close" : "Date, driver, note"}
          </button>
        ) : null}
      </div>
      {cancelling ? (
        <div className="status-picker-extra">
          <input name="note" required maxLength={300} placeholder="Why is it cancelled?" className="field h-10 min-w-0 flex-1 px-3 text-[13px] outline-none" aria-label="Reason for cancelling" autoFocus />
          <SubmitButton small tone="danger" className="h-10">Cancel order</SubmitButton>
          <button type="button" className="status-more" onClick={() => setPicked(status)}>Keep</button>
        </div>
      ) : more ? (
        <div className="status-picker-extra">
          <input name="expected" type="date" defaultValue={expectedDate ?? ""} className="field h-10 px-3 text-[13px] outline-none" aria-label="Expected delivery" />
          <input name="driver" defaultValue={driver ?? ""} maxLength={60} placeholder="Driver" className="field h-10 w-[130px] px-3 text-[13px] outline-none" aria-label="Driver" />
          <input name="note" maxLength={300} placeholder="Note" className="field h-10 min-w-0 flex-1 px-3 text-[13px] outline-none" aria-label="Note" />
          <SubmitButton small className="h-10">Save</SubmitButton>
        </div>
      ) : null}
      <noscript><SubmitButton small>Save {DELIVERY_CODES[picked]}</SubmitButton></noscript>
    </ActionForm>
  );
}
