"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Camera, CheckCircle2, Hash, ImagePlus, Loader2, Undo2, X } from "lucide-react";
import { checkScanAction, submitGrnAction } from "@/app/actions/wms";
import { normalizeSerial } from "../domain/serial";
import { CONDITION_LABELS, RECEIVE_CONDITIONS, sellableCondition, type Condition } from "../domain/unit";
import type { SerialSource } from "../domain/types";

export type ReceiveLine = { sku: string; name: string; pending: number };

type Unit = { key: string; sku: string; serial: string | null; serialSource: SerialSource; condition: Condition; remark: string; photo: string | null; warning: string | null };
type Draft = { clientId: string; units: Unit[]; counts: Record<string, number>; countOnly: Record<string, boolean>; invoiceNo: string; invoicePending: boolean };
type Feedback = { tone: "ok" | "bad" | "warn"; text: string } | null;

const MAX_PAYLOAD = 900_000;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function emptyDraft(): Draft {
  return { clientId: newId(), units: [], counts: {}, countOnly: {}, invoiceNo: "", invoicePending: false };
}

/** Short beep (ok) or a low double buzz (error), plus a vibration on phones. */
function signal(ok: boolean) {
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

/** Shrinks a phone photo to at most 1024 px, JPEG, so a receipt stays small. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't open the photo."));
      el.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The receive screen: pick the product line, then scan serials one after another (scanner, camera or typing + Enter).
 * Every scan is checked at once (green beep or red buzz with the reason). The receipt is kept on the phone until saved,
 * so closing the page loses nothing.
 */
const noop = () => () => {};

/** Shopify names run to 200 characters: the first few words are enough on a phone. */
const shortName = (name: string) => (name.length > 48 ? `${name.slice(0, 46).trimEnd()}…` : name);

function readDraft(storageKey: string): Draft {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) return { ...emptyDraft(), ...(JSON.parse(saved) as Draft) };
  } catch {
    /* private window: start fresh */
  }
  return emptyDraft();
}

export function ReceiveScreen(props: { poNumber: string; vendor: string | null; lines: ReceiveLine[] }) {
  // The receipt in progress lives on this phone, so the screen starts once the browser is ready.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  if (!ready) return <section className="dashboard-panel text-[14px] text-muted">Opening the scanner…</section>;
  return <Receive {...props} initial={readDraft(`wms-grn-draft:${props.poNumber}`)} />;
}

function Receive({ poNumber, vendor, lines, initial }: { poNumber: string; vendor: string | null; lines: ReceiveLine[]; initial: Draft }) {
  const storageKey = `wms-grn-draft:${poNumber}`;
  const [draft, setDraft] = useState<Draft>(initial);
  const [active, setActive] = useState<string | null>(lines.length === 1 ? lines[0].sku : null);
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ grn: string; message: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const typing = useRef<{ first: number; keys: number }>({ first: 0, keys: 0 });
  const last = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  // Keep the unsaved receipt on this phone.
  useEffect(() => {
    try {
      if (draft.units.length || Object.values(draft.counts).some(Boolean) || draft.invoiceNo) window.localStorage.setItem(storageKey, JSON.stringify(draft));
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* storage full (photos): the receipt still works, it just isn't kept */
    }
  }, [draft, storageKey]);

  const focus = useCallback(() => window.setTimeout(() => input.current?.focus(), 30), []);
  useEffect(() => {
    focus();
  }, [active, focus]);

  const scannedFor = (sku: string) => draft.units.filter((u) => u.sku === sku).length + (draft.counts[sku] ?? 0);
  const line = lines.find((l) => l.sku === active) ?? null;
  const total = draft.units.length + Object.values(draft.counts).reduce((s, n) => s + (n || 0), 0);

  function say(tone: "ok" | "bad" | "warn", text: string) {
    setFeedback({ tone, text });
    signal(tone !== "bad");
  }

  const addUnit = useCallback((unit: Omit<Unit, "key">) => setDraft((d) => ({ ...d, units: [{ ...unit, key: newId() }, ...d.units] })), []);

  async function scan(raw: string) {
    const serial = raw.trim();
    setValue("");
    focus();
    if (!serial) return;
    const now = Date.now();
    // A scanner can fire the same barcode twice in a row: ignore repeats within 1.5 s.
    if (last.current.value === serial && now - last.current.at < 1500) return;
    last.current = { value: serial, at: now };
    if (!line) return say("bad", lines.length > 1 ? "Tap the product first, then scan." : "Nothing left to receive on this PO.");
    if (draft.countOnly[line.sku]) return say("bad", "This product is counted, not scanned. Enter the number of units.");
    if (scannedFor(line.sku) >= line.pending) return say("bad", `All ${line.pending} expected units of this product are scanned.`);
    const batch = draft.units.map((u) => u.serial).filter((s): s is string => !!s);
    if (batch.map(normalizeSerial).includes(normalizeSerial(serial))) return say("bad", `${serial}: already scanned on this receipt.`);
    // Typed by hand if the keys came slowly (a scanner sends the whole code in a few milliseconds).
    const perKey = typing.current.keys ? (now - typing.current.first) / typing.current.keys : 0;
    const source: SerialSource = perKey > 35 ? "manual" : "scan";
    typing.current = { first: 0, keys: 0 };
    setChecking(true);
    try {
      const check = await checkScanAction({ sku: line.sku, serial, batch });
      if (!check.ok) return say("bad", `${serial}: ${check.reason}`);
      addUnit({ sku: line.sku, serial: check.serial, serialSource: source, condition: "good", remark: "", photo: null, warning: check.warning });
      if (check.warning) say("warn", `${check.serial} added. ${check.warning}`);
      else say("ok", `${check.serial} added.`);
    } catch {
      say("bad", "Couldn't check that scan. Check the connection and scan again.");
    } finally {
      setChecking(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void scan(event.currentTarget.value);
      return;
    }
    if (event.key.length === 1) {
      if (!typing.current.keys) typing.current.first = Date.now();
      typing.current.keys += 1;
    }
  }

  function noBarcode() {
    if (!line) return say("bad", "Tap the product first.");
    if (scannedFor(line.sku) >= line.pending) return say("bad", `All ${line.pending} expected units of this product are in.`);
    addUnit({ sku: line.sku, serial: null, serialSource: "internal", condition: "good", remark: "No barcode on item", photo: null, warning: null });
    say("warn", "Added without a barcode. It gets an EPIK serial (EPK-U-…) on save: stick a label on it.");
  }

  const update = (key: string, patch: Partial<Unit>) => setDraft((d) => ({ ...d, units: d.units.map((u) => (u.key === key ? { ...u, ...patch } : u)) }));
  const remove = (key: string) => setDraft((d) => ({ ...d, units: d.units.filter((u) => u.key !== key) }));

  async function save() {
    setError(null);
    if (!draft.invoiceNo.trim() && !draft.invoicePending) return setError("Enter the invoice number, or tick “Invoice not here yet”.");
    if (!total) return setError("Scan at least one unit.");
    const payload = {
      clientId: draft.clientId,
      poNumber,
      invoiceNo: draft.invoiceNo.trim() || null,
      invoicePending: draft.invoicePending && !draft.invoiceNo.trim(),
      notes: null,
      items: [...draft.units].reverse().map((u) => ({ sku: u.sku, serial: u.serial, serialSource: u.serialSource, condition: u.condition, remark: u.remark.trim() || null, photo: u.photo, altId: null })),
      counts: Object.entries(draft.counts).filter(([sku, n]) => draft.countOnly[sku] && n > 0).map(([sku, qty]) => ({ sku, qty })),
    };
    if (JSON.stringify(payload).length > MAX_PAYLOAD) return setError("Too many photos for one receipt. Remove some photos, save, then add the rest on the unit pages later.");
    setSaving(true);
    try {
      const result = await submitGrnAction(payload);
      if (!result.ok) {
        setError(result.message);
        signal(false);
        return;
      }
      signal(true);
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* nothing kept */
      }
      setDone({ grn: result.grn ?? "", message: result.message });
    } catch {
      setError("Couldn't reach the server. Nothing was saved. Check the connection and press Save again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="dashboard-panel wms-done">
        <CheckCircle2 size={44} className="text-good" aria-hidden="true" />
        <h2 className="dashboard-panel-title">{done.grn} saved</h2>
        <p className="text-[14px]">{done.message}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/wms/po/${encodeURIComponent(poNumber)}`} className="glow-button inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-medium text-white">See the PO</Link>
          <Link href="/wms/receive" className="btn-quiet inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-medium">Receive another PO</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="wms-receive">
      <section className="dashboard-panel">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-[12px] text-muted">
            Vendor invoice number{vendor ? ` (${vendor})` : ""}
            <input
              className="field mt-1 h-11 w-full px-3 text-[15px] outline-none"
              value={draft.invoiceNo}
              maxLength={40}
              placeholder="As printed on the bill"
              onChange={(e) => setDraft((d) => ({ ...d, invoiceNo: e.target.value }))}
            />
          </label>
          <label className="flex h-11 items-center gap-2 text-[13px]">
            <input type="checkbox" checked={draft.invoicePending} onChange={(e) => setDraft((d) => ({ ...d, invoicePending: e.target.checked }))} className="h-5 w-5" />
            Invoice not here yet
          </label>
        </div>
      </section>

      <div className="wms-lines" role="group" aria-label="Product on this PO">
        {lines.map((l) => {
          const got = scannedFor(l.sku);
          return (
            <button key={l.sku} type="button" className="wms-line" aria-pressed={active === l.sku} onClick={() => setActive(l.sku)}>
              <strong className="wms-clamp-2">{l.name}</strong>
              <span className="wms-muted">{l.sku}</span>
              <span className="wms-progress">
                <strong>{got}</strong> / {l.pending} this time
              </span>
              <span className="wms-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (got / Math.max(1, l.pending)) * 100)}%` }} /></span>
            </button>
          );
        })}
      </div>

      {line ? (
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" className="h-5 w-5" checked={!!draft.countOnly[line.sku]} onChange={(e) => setDraft((d) => ({ ...d, countOnly: { ...d.countOnly, [line.sku]: e.target.checked } }))} />
          No serial numbers on this product (accessories): count it instead
        </label>
      ) : null}

      {line && draft.countOnly[line.sku] ? (
        <section className="dashboard-panel">
          <label className="block text-[12px] text-muted">
            Units of {line.name} received (up to {line.pending})
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={line.pending}
              className="field mt-1 h-14 w-40 px-3 text-[20px] font-semibold outline-none"
              value={draft.counts[line.sku] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, counts: { ...d.counts, [line.sku]: Math.max(0, Math.min(line.pending, Math.floor(Number(e.target.value) || 0))) } }))}
            />
          </label>
        </section>
      ) : (
        <section className={`wms-scan-box ${feedback ? `is-${feedback.tone}` : ""}`}>
          <div className="wms-scan-row">
            <label className="sr-only" htmlFor="wms-scan">Scan or type a serial number, then Enter</label>
            <input
              id="wms-scan"
              ref={input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKey}
              placeholder={line ? "Scan or type serial" : "Tap a product first"}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="done"
              disabled={!line}
            />
            <button type="button" className="wms-icon-btn" aria-label="Scan with the camera" onClick={() => setCamera((c) => !c)} disabled={!line}>
              <Camera size={22} />
            </button>
          </div>
          {camera && line ? <CameraScanner onCode={(code) => void scan(code)} onClose={() => { setCamera(false); focus(); }} /> : null}
          <div className={`wms-feedback ${feedback ? `is-${feedback.tone}` : ""}`} role="status" aria-live="assertive">
            {checking ? <Loader2 size={16} className="animate-spin" /> : null}
            {feedback?.text ?? (line ? `Scanning ${shortName(line.name)}. The cursor stays here: scan the next one.` : "")}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-quiet inline-flex h-10 items-center gap-1.5 rounded-[12px] px-3 text-[13px]" onClick={noBarcode} disabled={!line}>
              <Hash size={15} /> No barcode on item
            </button>
            {draft.units.length ? (
              <button type="button" className="btn-quiet inline-flex h-10 items-center gap-1.5 rounded-[12px] px-3 text-[13px]" onClick={() => { remove(draft.units[0].key); setFeedback({ tone: "warn", text: "Last scan removed." }); focus(); }}>
                <Undo2 size={15} /> Undo last
              </button>
            ) : null}
          </div>
        </section>
      )}

      {draft.units.length ? (
        <section className="dashboard-panel">
          <h2 className="dashboard-panel-title mb-2">Scanned on this receipt ({draft.units.length})</h2>
          <div className="wms-units">
            {draft.units.map((u) => (
              <UnitRow key={u.key} unit={u} name={lines.length > 1 ? shortName(lines.find((l) => l.sku === u.sku)?.name ?? u.sku) : null} onChange={(patch) => update(u.key, patch)} onRemove={() => remove(u.key)} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="wms-savebar">
        <span className="wms-muted">{total ? `${total} unit${total === 1 ? "" : "s"} on this receipt` : "Nothing scanned yet"}</span>
        {error ? <span className="text-bad text-[13px]" role="alert">{error}</span> : null}
        <button type="button" className="glow-button text-white disabled:opacity-60" onClick={() => void save()} disabled={saving || !total}>
          {saving ? <Loader2 size={16} className="mr-1 inline animate-spin" /> : null}
          Save receipt
        </button>
      </div>
    </div>
  );
}

function UnitRow({ unit, name, onChange, onRemove }: { unit: Unit; name: string | null; onChange: (patch: Partial<Unit>) => void; onRemove: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="wms-unit">
      <div className="wms-unit-head">
        <strong>{unit.serial ?? "EPIK label (on save)"}</strong>
        {unit.serialSource === "manual" ? <span className="wms-badge is-quiet">Typed</span> : null}
        {!sellableCondition(unit.condition) ? <span className="wms-badge is-bad">On hold</span> : null}
        <span className="wms-muted wms-clamp-1">{name}</span>
        <button type="button" className="topbar-icon" aria-label={`Remove ${unit.serial ?? "this unit"}`} onClick={onRemove}><X size={16} /></button>
      </div>
      {unit.warning ? <p className="text-warn text-[12.5px]">{unit.warning}</p> : null}
      <div className="wms-conds" role="radiogroup" aria-label="Condition">
        {RECEIVE_CONDITIONS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={unit.condition === c} className={`wms-cond ${sellableCondition(c) ? "" : "is-bad"}`} onClick={() => onChange({ condition: c })}>
            {CONDITION_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="wms-unit-extra">
        <input type="text" value={unit.remark} maxLength={200} placeholder="Remark (optional)" onChange={(e) => onChange({ remark: e.target.value })} />
        {unit.photo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={unit.photo} alt="" className="wms-thumb" />
            <button type="button" className="wms-photo-btn" onClick={() => onChange({ photo: null })}>Remove photo</button>
          </>
        ) : (
          <label className="wms-photo-btn">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />} Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  onChange({ photo: await shrinkPhoto(file) });
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

/** Camera scanning with the phone's own barcode reader (Android Chrome). Where it isn't there, says so. */
function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const supported = "BarcodeDetector" in window;
  const [problem, setProblem] = useState<string | null>(supported ? null : "This browser can't read barcodes with the camera. Use a scanner, or type the serial and press Enter.");
  // The latest handler, so the camera isn't restarted on every render.
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);

  useEffect(() => {
    const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!BD) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let lastCode = "";
    const detector = new BD({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "data_matrix", "itf", "pdf417"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const code = codes[0]?.rawValue?.trim();
            if (code && code !== lastCode) {
              lastCode = code;
              handler.current(code);
              window.setTimeout(() => { lastCode = ""; }, 1500);
            }
          } catch {
            /* frame not ready */
          }
          window.setTimeout(tick, 250);
        };
        void tick();
      } catch {
        setProblem("Camera not allowed. Allow the camera for this site, or use a scanner.");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (problem) {
    return (
      <p className="text-warn flex items-center justify-between gap-2 text-[13px]">
        {problem}
        <button type="button" className="topbar-icon" aria-label="Close camera" onClick={onClose}><X size={16} /></button>
      </p>
    );
  }
  return (
    <div className="wms-camera">
      <video ref={video} muted playsInline />
      <button type="button" className="wms-icon-btn" aria-label="Close camera" onClick={onClose}><X size={20} /></button>
    </div>
  );
}
