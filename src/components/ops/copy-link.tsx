"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies a link from this site (the path is turned into a full address in the browser). */
export function CopyLink({ path, label = "Copy link" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }
  return (
    <button type="button" onClick={copy} className="btn-quiet inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] px-3.5 text-[13px] font-medium">
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "Copied" : label}
    </button>
  );
}
