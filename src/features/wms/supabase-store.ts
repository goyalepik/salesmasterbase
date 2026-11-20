import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Grn, MasterKind, RecordKind, RecordKinds, UnitEvent, WmsMaster, WmsPoHeader, WmsUnit } from "./domain/types";
import type { UnitStatus } from "./domain/unit";
import { recordKeys, SerialTakenError, type Counter, type RecordFilter, type UnitFilter, type WmsStore } from "./store";

const PHOTO_BUCKET = "wms-photos";

type Row = Record<string, unknown>;

function must<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

function list(result: { data: unknown; error: { message: string } | null }, what: string): Row[] {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

const unitFrom = (r: Row): WmsUnit => ({
  id: r.id as string,
  sku: r.sku as string,
  serial: r.serial as string,
  serialNorm: r.serial_norm as string,
  serialSource: r.serial_source as WmsUnit["serialSource"],
  altIds: (r.alt_ids as string[]) ?? [],
  status: r.status as UnitStatus,
  condition: r.condition as WmsUnit["condition"],
  hub: (r.hub as string) ?? null,
  ownership: (r.ownership as WmsUnit["ownership"]) ?? null,
  billedTo: (r.billed_to as string) ?? null,
  unitCostMinor: r.unit_cost_minor == null ? null : Number(r.unit_cost_minor),
  gstRate: r.gst_rate == null ? null : Number(r.gst_rate),
  poNumber: (r.po_number as string) ?? null,
  grnNumber: (r.grn_number as string) ?? null,
  vendor: (r.vendor as string) ?? null,
  invoiceNo: (r.invoice_no as string) ?? null,
  remark: (r.remark as string) ?? null,
  photos: (r.photos as string[]) ?? [],
  receivedAt: r.received_at as string,
  receivedBy: r.received_by as string,
  updatedAt: r.updated_at as string,
});

const unitTo = (u: Partial<WmsUnit>): Row => {
  const row: Row = {};
  const map: Array<[keyof WmsUnit, string]> = [
    ["id", "id"], ["sku", "sku"], ["serial", "serial"], ["serialNorm", "serial_norm"], ["serialSource", "serial_source"], ["altIds", "alt_ids"],
    ["status", "status"], ["condition", "condition"], ["hub", "hub"], ["ownership", "ownership"], ["billedTo", "billed_to"],
    ["unitCostMinor", "unit_cost_minor"], ["gstRate", "gst_rate"], ["poNumber", "po_number"], ["grnNumber", "grn_number"], ["vendor", "vendor"],
    ["invoiceNo", "invoice_no"], ["remark", "remark"], ["photos", "photos"], ["receivedAt", "received_at"], ["receivedBy", "received_by"], ["updatedAt", "updated_at"],
  ];
  for (const [k, col] of map) if (k in u) row[col] = u[k];
  return row;
};

const headerFrom = (r: Row): WmsPoHeader => ({
  poNumber: r.po_number as string,
  vendor: r.vendor as string,
  hub: (r.hub as string) ?? null,
  billedTo: (r.billed_to as string) ?? null,
  paymentTerms: (r.payment_terms as string) ?? null,
  priority: r.priority as WmsPoHeader["priority"],
  eta: (r.eta as string) ?? null,
  notes: (r.notes as string) ?? null,
  lines: (r.lines as WmsPoHeader["lines"]) ?? [],
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
});

const grnFrom = (r: Row): Grn => ({
  number: r.number as string,
  poNumber: r.po_number as string,
  vendor: (r.vendor as string) ?? null,
  hub: (r.hub as string) ?? null,
  invoiceNo: (r.invoice_no as string) ?? null,
  invoicePending: !!r.invoice_pending,
  notes: (r.notes as string) ?? null,
  lines: (r.lines as Grn["lines"]) ?? [],
  unitIds: (r.unit_ids as string[]) ?? [],
  receivedBy: r.received_by as string,
  createdAt: r.created_at as string,
});

const eventFrom = (r: Row): UnitEvent => ({
  id: String(r.id),
  unitId: r.unit_id as string,
  at: r.at as string,
  by: r.by as string,
  kind: r.kind as UnitEvent["kind"],
  fromStatus: (r.from_status as UnitStatus) ?? null,
  toStatus: (r.to_status as UnitStatus) ?? null,
  refType: (r.ref_type as string) ?? null,
  refId: (r.ref_id as string) ?? null,
  text: r.text as string,
});

/** The warehouse records in Supabase (tables from supabase/migrations/0006_wms.sql). Server only, service role. */
export class SupabaseWmsStore implements WmsStore {
  readonly kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async listMasters(kind?: MasterKind) {
    let q = this.db.from("wms_masters").select("id, kind, name, active, sort, note").order("kind").order("sort").order("name");
    if (kind) q = q.eq("kind", kind);
    return list(await q, "wms_masters").map((r: Row) => ({ id: r.id as string, kind: r.kind as MasterKind, name: r.name as string, active: !!r.active, sort: Number(r.sort), note: (r.note as string) ?? null })) as WmsMaster[];
  }

  async addMasters(items: Array<{ kind: MasterKind; name: string }>) {
    if (!items.length) return;
    const existing = await this.listMasters();
    const seen = new Set(existing.map((m) => `${m.kind}|${m.name.toLowerCase()}`));
    const counts = new Map<string, number>();
    for (const m of existing) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
    const rows: Row[] = [];
    for (const item of items) {
      const name = item.name.trim();
      const key = `${item.kind}|${name.toLowerCase()}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const sort = counts.get(item.kind) ?? 0;
      counts.set(item.kind, sort + 1);
      rows.push({ kind: item.kind, name, sort });
    }
    if (!rows.length) return;
    // Two people filling the lists at once: the unique index keeps one of each name.
    const result = await this.db.from("wms_masters").insert(rows);
    if (result.error && result.error.code !== "23505") throw new Error(`wms_masters: ${result.error.message}`);
    if (result.error) {
      for (const row of rows) {
        const one = await this.db.from("wms_masters").insert(row);
        if (one.error && one.error.code !== "23505") throw new Error(`wms_masters: ${one.error.message}`);
      }
    }
  }

  async setMasterActive(id: string, active: boolean) {
    const data = list(await this.db.from("wms_masters").update({ active }).eq("id", id).select("id"), "wms_masters");
    return data.length > 0;
  }

  async setMasterNote(id: string, note: string | null) {
    const data = list(await this.db.from("wms_masters").update({ note }).eq("id", id).select("id"), "wms_masters");
    return data.length > 0;
  }

  async savePoHeader(h: WmsPoHeader) {
    must(
      await this.db.from("wms_po_headers").upsert({
        po_number: h.poNumber,
        vendor: h.vendor,
        hub: h.hub,
        billed_to: h.billedTo,
        payment_terms: h.paymentTerms,
        priority: h.priority,
        eta: h.eta,
        notes: h.notes,
        lines: h.lines,
        created_by: h.createdBy,
        created_at: h.createdAt,
      }),
      "wms_po_headers",
    );
  }

  async getPoHeader(poNumber: string) {
    const data = must(await this.db.from("wms_po_headers").select("*").eq("po_number", poNumber).maybeSingle(), "wms_po_headers");
    return data ? headerFrom(data) : null;
  }

  async listPoHeaders() {
    return list(await this.db.from("wms_po_headers").select("*").order("created_at", { ascending: false }).limit(5000), "wms_po_headers").map(headerFrom);
  }

  async insertUnits(units: WmsUnit[]) {
    if (!units.length) return;
    const result = await this.db.from("wms_units").insert(units.map(unitTo));
    if (result.error?.code === "23505") {
      // Which serial? Look for the first one now taken.
      const taken = await this.unitsBySerials(units.map((u) => u.serialNorm));
      const hit = units.find((u) => taken.some((t) => t.sku === u.sku && t.serialNorm === u.serialNorm));
      throw new SerialTakenError(hit?.serial ?? units[0].serial);
    }
    if (result.error) throw new Error(`wms_units: ${result.error.message}`);
  }

  async deleteUnits(ids: string[]) {
    if (!ids.length) return;
    must(await this.db.from("wms_units").delete().in("id", ids), "wms_units");
  }

  async getUnit(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const data = must(await this.db.from("wms_units").select("*").eq("id", id).maybeSingle(), "wms_units");
    return data ? unitFrom(data) : null;
  }

  async unitsBySerial(serialNorm: string) {
    return this.unitsBySerials([serialNorm]);
  }

  async unitsBySerials(serialNorms: string[]) {
    const wanted = [...new Set(serialNorms.filter(Boolean))];
    if (!wanted.length) return [];
    const out = new Map<string, WmsUnit>();
    for (let i = 0; i < wanted.length; i += 200) {
      const chunk = wanted.slice(i, i + 200);
      const [bySerial, byAlt] = await Promise.all([
        this.db.from("wms_units").select("*").in("serial_norm", chunk),
        this.db.from("wms_units").select("*").overlaps("alt_ids", chunk),
      ]);
      for (const r of [...list(bySerial, "wms_units"), ...list(byAlt, "wms_units")]) out.set(r.id as string, unitFrom(r));
    }
    return [...out.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async listUnits(filter: UnitFilter) {
    const limit = filter.limit ?? 5000;
    const out: WmsUnit[] = [];
    for (let from = 0; from < limit; from += 1000) {
      let q = this.db.from("wms_units").select("*").order("received_at", { ascending: false }).range(from, Math.min(limit, from + 1000) - 1);
      if (filter.sku) q = q.eq("sku", filter.sku);
      if (filter.poNumber) q = q.eq("po_number", filter.poNumber);
      if (filter.grnNumber) q = q.eq("grn_number", filter.grnNumber);
      if (filter.statuses) q = q.in("status", filter.statuses);
      const page = list(await q, "wms_units").map(unitFrom);
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }

  async updateUnit(id: string, patch: Partial<WmsUnit>, expectStatus?: UnitStatus) {
    const row = unitTo({ ...patch, updatedAt: new Date().toISOString() });
    delete row.id;
    let q = this.db.from("wms_units").update(row).eq("id", id);
    if (expectStatus) q = q.eq("status", expectStatus);
    const data = list(await q.select("id"), "wms_units");
    return data.length > 0;
  }

  async addUnitEvents(events: Array<Omit<UnitEvent, "id">>) {
    if (!events.length) return;
    must(
      await this.db.from("wms_unit_events").insert(
        events.map((e) => ({ unit_id: e.unitId, at: e.at, by: e.by, kind: e.kind, from_status: e.fromStatus, to_status: e.toStatus, ref_type: e.refType, ref_id: e.refId, text: e.text })),
      ),
      "wms_unit_events",
    );
  }

  async unitEvents(unitId: string) {
    return list(await this.db.from("wms_unit_events").select("*").eq("unit_id", unitId).order("at").order("id"), "wms_unit_events").map(eventFrom);
  }

  async saveRecord<K extends RecordKind>(kind: K, rec: RecordKinds[K]) {
    const k = recordKeys(kind, rec);
    list(
      await this.db
        .from("wms_records")
        .upsert({ kind, id: k.id, order_id: k.orderId, unit_ids: k.unitIds, status: k.status, created_at: k.createdAt, data: rec, updated_at: new Date().toISOString() }, { onConflict: "kind,id" })
        .select("id"),
      "wms_records",
    );
  }

  async getRecord<K extends RecordKind>(kind: K, id: string) {
    const data = must(await this.db.from("wms_records").select("data").eq("kind", kind).eq("id", id).maybeSingle(), "wms_records");
    return data ? (data.data as RecordKinds[K]) : null;
  }

  async listRecords<K extends RecordKind>(kind: K, filter: RecordFilter = {}) {
    let q = this.db.from("wms_records").select("data").eq("kind", kind).order("created_at", { ascending: false }).limit(filter.limit ?? 5000);
    if (filter.orderId) q = q.eq("order_id", filter.orderId);
    if (filter.unitId) q = q.contains("unit_ids", [filter.unitId]);
    if (filter.status) q = q.eq("status", filter.status);
    return list(await q, "wms_records").map((r) => r.data as RecordKinds[K]);
  }

  async nextNumber(counter: Counter, count = 1) {
    const data = must(await this.db.rpc("wms_next_number", { counter, how_many: count }), "wms_next_number");
    return Number(data);
  }

  async insertGrn(g: Grn) {
    must(
      await this.db.from("wms_grns").insert({
        number: g.number,
        po_number: g.poNumber,
        vendor: g.vendor,
        hub: g.hub,
        invoice_no: g.invoiceNo,
        invoice_pending: g.invoicePending,
        notes: g.notes,
        lines: g.lines,
        unit_ids: g.unitIds,
        received_by: g.receivedBy,
        created_at: g.createdAt,
      }),
      "wms_grns",
    );
  }

  async getGrn(number: string) {
    const data = must(await this.db.from("wms_grns").select("*").eq("number", number).maybeSingle(), "wms_grns");
    return data ? grnFrom(data) : null;
  }

  async listGrns(filter: { poNumber?: string; limit?: number }) {
    let q = this.db.from("wms_grns").select("*").order("created_at", { ascending: false }).limit(filter.limit ?? 200);
    if (filter.poNumber) q = q.eq("po_number", filter.poNumber);
    return list(await q, "wms_grns").map(grnFrom);
  }

  async savePhoto(dataUrl: string) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Not a photo.");
    const ext = match[1].split("/")[1].replace("jpeg", "jpg");
    const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
    const body = Buffer.from(match[2], "base64");
    const storage = this.db.storage;
    let up = await storage.from(PHOTO_BUCKET).upload(path, body, { contentType: match[1] });
    if (up.error && /not found/i.test(up.error.message)) {
      await storage.createBucket(PHOTO_BUCKET, { public: false });
      up = await storage.from(PHOTO_BUCKET).upload(path, body, { contentType: match[1] });
    }
    if (up.error) throw new Error(`Photo upload: ${up.error.message}`);
    return `sb:${path}`;
  }

  async photoUrl(ref: string) {
    if (!ref.startsWith("sb:")) return null;
    const signed = await this.db.storage.from(PHOTO_BUCKET).createSignedUrl(ref.slice(3), 3600);
    return signed.data?.signedUrl ?? null;
  }
}
