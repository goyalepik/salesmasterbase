"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { setActorAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";

/** "Acting as" name for the history log. Kept in a cookie on this browser. */
export function ActorControl({ name, signedIn = "admin" }: { name: string; signedIn?: "admin" | "person" }) {
  const [editing, setEditing] = useState(false);
  if (signedIn === "person") {
    // Signed in with a personal code: the name is theirs. Only signing out is offered.
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <Avatar name={name} size={36} />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[130px] truncate text-[13px] leading-tight font-semibold text-ink">{name}</span>
          <button
            type="button"
            className="block text-[11px] leading-tight text-faint hover:text-ink"
            onClick={async () => {
              await fetch("/api/access", { method: "DELETE" }).catch(() => null);
              window.location.href = "/access";
            }}
          >
            Sign out
          </button>
        </span>
      </span>
    );
  }
  if (!editing) {
    // Until a name is set, the history would only say "Dashboard". Ask for it plainly.
    if (name === "Dashboard") {
      return (
        <button type="button" className="name-nudge" onClick={() => setEditing(true)}>
          <span className="mode-dot" />
          Set your name
        </button>
      );
    }
    return (
      <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => setEditing(true)} title="Change who is acting">
        <Avatar name={name} size={36} />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[130px] truncate text-[13px] leading-tight font-semibold text-ink">{name}</span>
          <span className="block text-[11px] leading-tight text-faint">Acting as</span>
        </span>
        <ChevronDown size={15} className="hidden shrink-0 text-muted sm:block" />
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
