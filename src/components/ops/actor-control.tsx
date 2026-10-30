"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { setActorAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";

/** "Acting as" name for the history log. Kept in a cookie on this browser. */
export function ActorControl({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12px] text-muted hover:text-ink" onClick={() => setEditing(true)} title="Change who is acting">
        <UserRound size={13} className="shrink-0" />
        <span className="hidden sm:inline">Acting as</span>
        <span className="max-w-[110px] truncate text-ink">{name}</span>
      </button>
    );
  }
  return (
    <ActionForm
      action={async (form) => {
        const result = await setActorAction(form);
        if (result.ok) setEditing(false);
        return result;
      }}
      className="flex min-w-0 items-center gap-1.5"
      resetOnSuccess={false}
    >
      <label className="sr-only" htmlFor="actor-name">Your name</label>
      <input id="actor-name" name="name" defaultValue={name === "Dashboard" ? "" : name} placeholder="Your name" maxLength={40} autoFocus className="field h-8 w-[130px] px-2.5 text-[12px] outline-none" />
      <SubmitButton small className="!h-8 !px-2.5 !text-[12px]">Save</SubmitButton>
      <button type="button" className="text-[12px] text-faint" onClick={() => setEditing(false)}>Cancel</button>
    </ActionForm>
  );
}
