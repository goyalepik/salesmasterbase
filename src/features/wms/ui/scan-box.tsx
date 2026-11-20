"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";

export type ScanReply = { tone: "ok" | "bad" | "warn"; text: string };

/** Short beep (ok) or a low double buzz (error), plus a vibration on phones. */
export function scanSignal(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const tone = (freq: number, start: number, length: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = ok ? "sine" : "square";
        osc.frequency.value = freq;
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + length);
      };
      if (ok) tone(1320, 0, 0.09);
      else {
        tone(220, 0, 0.14);
        tone(220, 0.2, 0.14);
      }
      window.setTimeout(() => void ctx.close(), 600);
    }
  } catch {
    /* sound is a bonus */
  }
  try {
    navigator.vibrate?.(ok ? 40 : [90, 60, 90]);
  } catch {
    /* not on desktop */
  }
}

/**
 * The always-ready scan box: a scanner (characters + Enter) or typing. Each scan gets green or red with the reason,
 * the cursor comes straight back, and a repeat of the same code within 1.5 s is ignored.
 */
export function ScanBox({ placeholder, hint, onScan, disabled = false }: { placeholder: string; hint: string; onScan: (serial: string) => Promise<ScanReply>; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const [reply, setReply] = useState<ScanReply | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const focus = useCallback(() => window.setTimeout(() => input.current?.focus(), 30), []);
  useEffect(() => {
    focus();
  }, [focus]);

  async function submit(raw: string) {
    const serial = raw.trim();
    setValue("");
    focus();
    if (!serial) return;
    const now = Date.now();
    if (last.current.value === serial && now - last.current.at < 1500) return;
    last.current = { value: serial, at: now };
    setBusy(true);
    try {
      const r = await onScan(serial);
      setReply(r);
      scanSignal(r.tone !== "bad");
    } catch {
      setReply({ tone: "bad", text: "Couldn't check that scan. Check the connection and scan again." });
      scanSignal(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`wms-scan-box ${reply ? `is-${reply.tone}` : ""}`}>
      <div className="wms-scan-row">
        <label className="sr-only" htmlFor="wms-scan-box">{placeholder}</label>
        <input
          id="wms-scan-box"
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit(e.currentTarget.value);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="done"
          disabled={disabled}
        />
      </div>
      <div className={`wms-feedback ${reply ? `is-${reply.tone}` : ""}`} role="status" aria-live="assertive">
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        {reply?.text ?? hint}
      </div>
    </section>
  );
}
