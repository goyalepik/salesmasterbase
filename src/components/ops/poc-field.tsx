"use client";

import { useState } from "react";
import { fieldClassName } from "@/components/ui";
import { POC_CHOICES, POC_OTHER } from "@/lib/ops/pocs";

/** Pick the POC from the team list; "Other" opens a box to type the name. */
export function PocField() {
  const [picked, setPicked] = useState("");
  return (
    <>
      <label className="block text-[12px] text-muted">
        POC
        <select className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="poc" required value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="" disabled>Choose</option>
          {POC_CHOICES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      {picked === POC_OTHER ? (
        <label className="block text-[12px] text-muted">
          POC name
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="poc_other" required minLength={2} maxLength={80} placeholder="Type the name" autoFocus />
        </label>
      ) : null}
    </>
  );
}
