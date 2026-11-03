"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PhoneMissed, Plus, Sparkles } from "lucide-react";
import { classify } from "../domain/classifier";
import { BUCKETS, QUEUE, scenario } from "../domain/config";
import { route } from "../domain/routing";
import { ingest, normalisePhone } from "../domain/service";
import type { Channel } from "../domain/types";
import { CHANNEL_NAME, LabelBadge } from "./bits";
import { useCx } from "./cx-store";

const EXAMPLES = [
  "Epson L8050 order confirm koriye. Payment COD. pin 743370 #PIK4905",
  "Nobody came for my demo, waited all day",
  "The appliance sparked and caught fire",
  "paisa kat gaya but order nahi aaya",
  "agent agent talk to human",
  "hi",
  "Applying for video editor role",
  "WORST service!!! where is my order PIK4123",
];

/** Paste a message and see exactly how the pipeline classifies, prioritises and routes it, and why. */
export function Simulator() {
  const { act } = useCx();
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [text, setText] = useState(EXAMPLES[0]);
  const [phone, setPhone] = useState("+91 90000 55555");
  const [order, setOrder] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const result = useMemo(() => {
    const c = classify({ text: order ? `${text} ${order}` : text, channel });
    return { c, r: route(c) };
  }, [text, channel, order]);
  const s = scenario(result.c.scenarioId);

  async function create(kind: "message" | "missed") {
    let id = "";
    const ok = await act(async (repo, _a, now) => {
      const res = await ingest(repo, kind === "missed" ? { channel: "missed_call", phone } : { channel, text, phone: phone || undefined, orderRef: order || undefined, handle: !normalisePhone(phone) ? "@simulator" : undefined }, now);
      id = res.ticket.id;
      return res;
    }, kind === "missed" ? "Missed call recorded." : "Ticket created.");
    if (ok) setCreated(id);
  }

  return (
    <div className="cx-sim">
      <section className="cx-card">
        <h1>Simulator</h1>
        <p className="cx-muted">Try any message. The result on the right updates as you type. Nothing is sent to anyone.</p>
        <div className="cx-sim-form">
          <label className="cx-field"><span>Channel</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {(Object.keys(CHANNEL_NAME) as Channel[]).filter((c) => c !== "missed_call").map((c) => <option key={c} value={c}>{CHANNEL_NAME[c]}</option>)}
            </select>
          </label>
          <label className="cx-field"><span>Phone (optional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9xxxxxxxxx" /></label>
          <label className="cx-field"><span>Order number (optional)</span><input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="PIK4905" /></label>
        </div>
        <label className="cx-field"><span>Message</span><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="cx-examples">
          {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setText(e)}>{e.length > 38 ? `${e.slice(0, 36)}…` : e}</button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="cx-btn is-primary" onClick={() => void create("message")}><Plus size={14} /> Create ticket</button>
          <button type="button" className="cx-btn" onClick={() => void create("missed")}><PhoneMissed size={14} /> Missed call from this phone</button>
          {created ? <Link href="/cx" className="cx-link">Open {created} in the console →</Link> : null}
        </div>
      </section>

      <section className="cx-card cx-sim-result">
        <p className="cx-muted">Result</p>
        <h2>{s.id} · {s.name}</h2>
        <div className="cx-class-grid">
          <div className="cx-kv"><span>Bucket</span><b>{s.bucket} · {BUCKETS.find((b) => b.id === s.bucket)?.name}</b></div>
          <div className="cx-kv"><span>Type</span><b>{result.c.type === "actionable" ? "Actionable" : "Informative"}</b></div>
          <div className="cx-kv"><span>Priority</span><b className="flex items-center gap-2">{result.r.priority} <LabelBadge label={result.r.label} /></b></div>
          <div className="cx-kv"><span>Level</span><b>{result.r.level}{result.r.autoResolvable ? " · AI can answer" : ""}</b></div>
          <div className="cx-kv"><span>Queue</span><b>{QUEUE.get(result.r.queueId)?.name}</b></div>
          <div className="cx-kv"><span>Confidence</span><b className="cx-conf"><span className="cx-conf-track"><i style={{ width: `${Math.round(result.c.confidence * 100)}%` }} /></span> {Math.round(result.c.confidence * 100)}%</b></div>
        </div>
        {result.r.warnings.length ? (
          <div className="cx-warn"><AlertTriangle size={16} /><div>{result.r.warnings.map((w) => <p key={w}>{w}</p>)}</div></div>
        ) : null}
        <div className="cx-why">
          <p className="cx-why-title"><Sparkles size={14} /> Why</p>
          <ul>{[...result.c.explanation, ...result.r.explanation].map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
        <div className="cx-chips">
          {result.c.entities.orderRefs.map((r) => <span key={r}>Order {r}</span>)}
          {result.c.entities.pincode ? <span>Pin {result.c.entities.pincode}{result.c.entities.pincodeValid === false ? " (invalid)" : result.c.entities.codEligible ? " · COD zone" : " · outside COD zone"}</span> : null}
          {result.c.entities.paymentMethod ? <span>{result.c.entities.paymentMethod.toUpperCase()}</span> : null}
          {result.c.entities.brands.map((b) => <span key={b}>{b[0].toUpperCase() + b.slice(1)}</span>)}
          {result.c.sentiment.tone !== "neu" ? <span>{result.c.sentiment.tone === "neg" ? "Upset" : "Happy"}</span> : null}
        </div>
      </section>
    </div>
  );
}
