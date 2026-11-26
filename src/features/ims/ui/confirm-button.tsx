"use client";

import { useState, useTransition } from "react";

/** A small button that asks first, then runs a server action with one argument. */
export function ConfirmButton({ action, arg, label, confirm }: { action: (arg: string) => Promise<{ ok: boolean; message: string }>; arg: string; label: string; confirm: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <>
      <button type="button" className="ims-btn is-small is-quiet" disabled={pending} onClick={() => window.confirm(confirm) && start(async () => setMsg(await action(arg)))}>{pending ? "…" : label}</button>
      {msg && !msg.ok ? <span className="ims-msg-bad">{msg.message}</span> : null}
    </>
  );
}
