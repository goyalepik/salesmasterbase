"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { AssistantScreen } from "@/components/assistant-screen";
import type { AssistantStatus } from "@/lib/ai/runtime";

/** The AI works across every space, so it floats above all of them. */
export function AskDrawer({ status }: { status: AssistantStatus }) {
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept, so the conversation survives closing the drawer.
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`ask-orb ${open ? "is-hidden" : ""}`}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        aria-label="Ask EPIK"
      >
        <Sparkles size={18} />
        <span>Ask EPIK</span>
      </button>
      {open ? <button type="button" className="ask-scrim" aria-label="Close Ask EPIK" onClick={() => setOpen(false)} /> : null}
      <aside className={`ask-drawer ${open ? "is-open" : ""}`} aria-label="Ask EPIK" aria-hidden={!open} inert={!open}>
        <header className="ask-drawer-head">
          <span className="flex items-center gap-2.5">
            <span className="ask-drawer-mark"><Sparkles size={16} /></span>
            <span>
              <span className="block text-[15px] font-semibold text-ink">Ask EPIK</span>
              <span className="block text-[11.5px] text-faint">Knows every team. {status.provider === "rules" ? "No AI key yet." : `Powered by ${status.provider === "anthropic" ? "Claude" : "OpenAI"}.`}</span>
            </span>
          </span>
          <button type="button" className="topbar-icon" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
        </header>
        <div className="ask-drawer-body">{opened ? <AssistantScreen initialQuestion="" status={status} compact /> : null}</div>
      </aside>
    </>
  );
}
