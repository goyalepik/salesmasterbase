"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { checkDispatchScanAction, dispatchAction } from "@/app/actions/wms";
import { ScanBox, scanSignal } from "./scan-box";

export type DispatchLine = { lineId: string; sku: string; name: string; need: number };

const short = (name: string) => (name.length > 52 ? `${name.slice(0, 50).trimEnd()}…` : name);

/** Scan each unit for the order, choose who delivers (our person or a 3PL with AWB), then send. */
export function DispatchScreen({ orderId, label, lines, partners }: { orderId: string; label: string; lines: DispatchLine[]; partners: Array<{ name: string; hasLink: boolean }> }) {
  const [scans, setScans] = useState<Array<{ lineId: string; serial: string }>>([]);
  const [carrier, setCarrier] = useState<"own" | "3pl">(partners.length ? "3pl" : "own");
  const [form, setForm] = useState({ partner: partners[0]?.name ?? "", driver: "", awb: "", trackingUrl: "", expectedDate: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ shipment: string; message: string } | null>(null);
  const total = lines.reduce((s, l) => s + l.need, 0);
  const partner = partners.find((p) => p.name === form.partner);

  async function send() {
    setError(null);
    setSaving(true);
    try {
      const r = await dispatchAction({ orderId, units: scans, carrier, partner: carrier === "3pl" ? form.partner : null, driver: carrier === "own" ? form.driver : null, awb: carrier === "3pl" ? form.awb : null, trackingUrl: form.trackingUrl || null, expectedDate: form.expectedDate || null, note: form.note || null });
      scanSignal(r.ok);
      if (r.ok) setDone({ shipment: r.shipment ?? "", message: r.message });
      else setError(r.message);
    } catch {
      setError("Couldn't reach the server. Nothing was sent. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="dashboard-panel wms-done">
        <CheckCircle2 size={44} className="text-good" aria-hidden="true" />
        <h2 className="dashboard-panel-title">{done.shipment} sent</h2>
        <p className="text-[14px]">{done.message}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/orders/${orderId}`} className="glow-button inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-medium text-white">Open the order</Link>
          <Link href="/wms/dispatch" className="btn-quiet inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-medium">Next order</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="wms-receive">
      <div className="wms-lines">
        {lines.map((l) => {
          const got = scans.filter((s) => s.lineId === l.lineId).length;
          return (
            <div key={l.lineId} className="wms-line" aria-pressed={got >= l.need}>
              <strong className="wms-clamp-2">{l.name}</strong>
              <span className="wms-muted">{l.sku}</span>
              <span className="wms-progress"><strong>{got}</strong> / {l.need} scanned</span>
              <span className="wms-bar" aria-hidden="true"><span style={{ width: `${(got / l.need) * 100}%` }} /></span>
            </div>
          );
        })}
      </div>

      <ScanBox
        placeholder="Scan or type serial"
        hint={`Scan each unit for ${label}. The right product line is picked for you.`}
        onScan={async (serial) => {
          const r = await checkDispatchScanAction({ orderId, serial, already: scans });
          if (!r.ok) return { tone: "bad", text: `${serial}: ${r.reason}` };
          setScans((list) => [...list, { lineId: r.lineId, serial: r.serial }]);
          return { tone: "ok", text: r.text };
        }}
      />

      {scans.length ? (
        <section className="dashboard-panel">
          <h2 className="dashboard-panel-title mb-2">Scanned ({scans.length} of {total})</h2>
          <div className="wms-units">
            {scans.map((s) => (
              <div key={s.serial} className="wms-unit">
                <div className="wms-unit-head">
                  <strong>{s.serial}</strong>
                  <span className="wms-muted wms-clamp-1">{short(lines.find((l) => l.lineId === s.lineId)?.name ?? "")}</span>
                  <button type="button" className="topbar-icon" aria-label={`Remove ${s.serial}`} onClick={() => setScans((list) => list.filter((x) => x.serial !== s.serial))}><X size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dashboard-panel grid gap-3">
        <h2 className="dashboard-panel-title">Who delivers</h2>
        <div className="wms-conds" role="radiogroup" aria-label="Who delivers">
          <button type="button" role="radio" aria-checked={carrier === "3pl"} className="wms-cond" onClick={() => setCarrier("3pl")}>3PL partner</button>
          <button type="button" role="radio" aria-checked={carrier === "own"} className="wms-cond" onClick={() => setCarrier("own")}>Our delivery person</button>
        </div>
        {carrier === "3pl" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-[12px] text-muted">
              Partner
              <select className="field mt-1 h-11 w-full px-3 text-[14px]" value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })}>
                {partners.length ? partners.map((p) => <option key={p.name} value={p.name}>{p.name}</option>) : <option value="">Add partners in Lists</option>}
              </select>
            </label>
            <label className="block text-[12px] text-muted">
              AWB / tracking number
              <input className="field mt-1 h-11 w-full px-3 text-[15px]" value={form.awb} maxLength={60} placeholder="Scan or type" onChange={(e) => setForm({ ...form, awb: e.target.value })} />
            </label>
            <label className="block text-[12px] text-muted">
              Tracking link {partner?.hasLink ? "(made from the AWB)" : "(paste it)"}
              <input className="field mt-1 h-11 w-full px-3 text-[14px]" value={form.trackingUrl} maxLength={300} placeholder={partner?.hasLink ? "Leave empty" : "https://…"} onChange={(e) => setForm({ ...form, trackingUrl: e.target.value })} />
            </label>
          </div>
        ) : (
          <label className="block text-[12px] text-muted">
            Delivery person
            <input className="field mt-1 h-11 w-full px-3 text-[15px]" value={form.driver} maxLength={60} placeholder="Name" onChange={(e) => setForm({ ...form, driver: e.target.value })} />
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] text-muted">
            Expected delivery
            <input type="date" className="field mt-1 h-11 w-full px-3 text-[14px]" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
          </label>
          <label className="block text-[12px] text-muted">
            Note (optional)
            <input className="field mt-1 h-11 w-full px-3 text-[14px]" value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </div>
      </section>

      <div className="wms-savebar">
        <span className="wms-muted">{scans.length} of {total} scanned</span>
        {error ? <span className="text-bad text-[13px]" role="alert">{error}</span> : null}
        <button type="button" className="glow-button text-white disabled:opacity-60" onClick={() => void send()} disabled={saving || !scans.length}>
          {saving ? <Loader2 size={16} className="mr-1 inline animate-spin" /> : null}
          Send out
        </button>
      </div>
    </div>
  );
}
