"use client";

import { useState, useTransition, type ReactNode } from "react";

type Result = { ok: boolean; message: string };

/** A form that runs a server action and shows its answer next to the button. */
export function ActionButtonForm({ action, children, className }: { action: (form: FormData) => Promise<Result>; children: ReactNode; className?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <form className={className} action={(form) => start(async () => setResult(await action(form)))} style={{ opacity: pending ? 0.6 : 1 }}>
      {children}
      {result ? <span className={result.ok ? "ims-msg-ok" : "ims-msg-bad"}>{result.message}</span> : null}
    </form>
  );
}
