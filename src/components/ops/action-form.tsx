"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";
import type { ActionResult } from "@/lib/ops-ui/action-result";

type Toast = ActionResult & { key: number };

const ToastContext = createContext<((result: ActionResult) => void) | null>(null);
const PendingContext = createContext(false);

/** Shows the result of the last button press at the bottom of the screen. Lives in the shell, so it survives the page refresh. */
export function ActionToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  const show = useCallback((result: ActionResult) => {
    counter.current += 1;
    setToast({ ...result, key: counter.current });
  }, []);

  useEffect(() => {
    if (!toast?.ok) return;
    const timer = window.setTimeout(() => setToast((current) => (current?.key === toast.key ? null : current)), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="action-toast-wrap" aria-live="polite">
        {toast ? (
          <div key={toast.key} className={`action-toast ${toast.ok ? "is-ok" : "is-error"}`} role={toast.ok ? "status" : "alert"}>
            {toast.ok ? <CheckCircle2 size={18} className="shrink-0" /> : <CircleAlert size={18} className="shrink-0" />}
            <p className="min-w-0 flex-1">{toast.message}</p>
            <button type="button" aria-label="Close message" onClick={() => setToast(null)}>
              <X size={15} />
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * A form that calls a server action and shows its message. Fields are kept when the action fails,
 * so a typo does not wipe the form. Every button inside is disabled while it runs.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnSuccess = true,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
}) {
  const toast = useContext(ToastContext);
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<ActionResult | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (confirm && !window.confirm(confirm)) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(form, submitter);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await action(data);
      } catch {
        result = { ok: false, message: "Could not reach the server. Check the connection and try again." };
      }
      if (toast) toast(result);
      else setLocal(result);
      if (result.ok && resetOnSuccess) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <PendingContext.Provider value={pending}>
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
      </PendingContext.Provider>
      {local ? <p className={`mt-2 text-[13px] ${local.ok ? "text-good" : "text-bad"}`}>{local.message}</p> : null}
    </form>
  );
}

const TONES = {
  primary: "glow-button text-white",
  good: "btn-good",
  danger: "btn-danger",
  quiet: "btn-quiet",
} as const;

/** A big, obvious button. Shows a spinner while its form is working. */
export function SubmitButton({
  children,
  tone = "primary",
  name,
  value,
  small = false,
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  name?: string;
  value?: string;
  small?: boolean;
  className?: string;
}) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`${TONES[tone]} inline-flex items-center justify-center gap-1.5 rounded-[14px] font-medium disabled:cursor-wait disabled:opacity-60 ${small ? "h-9 px-3 text-[13px]" : "h-11 px-4 text-[14px]"} ${className}`}
    >
      {pending ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
