import { randomUUID } from "node:crypto";
import type { Grn, MasterKind, RecordKind, RecordKinds, UnitEvent, WmsMaster, WmsPoHeader, WmsUnit } from "./domain/types";
import { TERMINAL, type UnitStatus } from "./domain/unit";
import { recordKeys, SerialTakenError, type Counter, type RecordFilter, type UnitFilter, type WmsStore } from "./store";

const copy = <T>(value: T): T => structuredClone(value);

/** The warehouse records in memory: demo mode and tests. Lost on restart. */
export class MemoryWmsStore implements WmsStore {
  readonly kind = "memory" as const;
  private masters: WmsMaster[] = [];
  private headers = new Map<string, WmsPoHeader>();
  private units = new Map<string, WmsUnit>();
  private events: UnitEvent[] = [];
  private grns: Grn[] = [];
  private counters = new Map<string, number>();
  private photos = new Map<string, string>();
  private records = new Map<string, Map<string, unknown>>();

  async listMasters(kind?: MasterKind) {
    return copy(this.masters.filter((m) => !kind || m.kind === kind).sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name)));
  }

  async addMasters(items: Array<{ kind: MasterKind; name: string }>) {
    for (const item of items) {
      const name = item.name.trim();
      if (!name || this.masters.some((m) => m.kind === item.kind && m.name.toLowerCase() === name.toLowerCase())) continue;
      const sort = this.masters.filter((m) => m.kind === item.kind).length;
      this.masters.push({ id: randomUUID(), kind: item.kind, name, active: true, sort, note: null });
    }
  }

  async setMasterActive(id: string, active: boolean) {
    const m = this.masters.find((x) => x.id === id);
    if (!m) return false;
    m.active = active;
    return true;
  }

  async setMasterNote(id: string, note: string | null) {
    const m = this.masters.find((x) => x.id === id);
    if (!m) return false;
    m.note = note;
    return true;
  }

  async savePoHeader(header: WmsPoHeader) {
    this.headers.set(header.poNumber, copy(header));
  }

  async getPoHeader(poNumber: string) {
    const h = this.headers.get(poNumber);
    return h ? copy(h) : null;
  }

  async listPoHeaders() {
    return copy([...this.headers.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async insertUnits(units: WmsUnit[]) {
    const live = (u: WmsUnit) => !TERMINAL.includes(u.status);
    const taken = new Set([...this.units.values()].filter(live).map((u) => `${u.sku}|${u.serialNorm}`));
    for (const u of units) {
      const key = `${u.sku}|${u.serialNorm}`;
      if (taken.has(key)) throw new SerialTakenError(u.serial);
      taken.add(key);
    }
    for (const u of units) this.units.set(u.id, copy(u));
  }

  async deleteUnits(ids: string[]) {
    for (const id of ids) this.units.delete(id);
    this.events = this.events.filter((e) => !ids.includes(e.unitId));
  }

  async getUnit(id: string) {
    const u = this.units.get(id);
    return u ? copy(u) : null;
  }

  async unitsBySerial(serialNorm: string) {
    return this.unitsBySerials([serialNorm]);
  }

  async unitsBySerials(serialNorms: string[]) {
    const wanted = new Set(serialNorms);
    return copy([...this.units.values()].filter((u) => wanted.has(u.serialNorm) || u.altIds.some((a) => wanted.has(a))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
  }

  async listUnits(filter: UnitFilter) {
    const rows = [...this.units.values()]
      .filter((u) => (!filter.sku || u.sku === filter.sku) && (!filter.poNumber || u.poNumber === filter.poNumber) && (!filter.grnNumber || u.grnNumber === filter.grnNumber) && (!filter.statuses || filter.statuses.includes(u.status)))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return copy(rows.slice(0, filter.limit ?? 5000));
  }

  async updateUnit(id: string, patch: Partial<WmsUnit>, expectStatus?: UnitStatus) {
    const u = this.units.get(id);
    if (!u || (expectStatus && u.status !== expectStatus)) return false;
    this.units.set(id, { ...u, ...copy(patch), id, updatedAt: new Date().toISOString() });
    return true;
  }

  async addUnitEvents(events: Array<Omit<UnitEvent, "id">>) {
    for (const e of events) this.events.push({ ...copy(e), id: randomUUID() });
  }

  async unitEvents(unitId: string) {
    return copy(this.events.filter((e) => e.unitId === unitId).sort((a, b) => a.at.localeCompare(b.at)));
  }

  async saveRecord<K extends RecordKind>(kind: K, rec: RecordKinds[K]) {
    const table = this.records.get(kind) ?? new Map<string, unknown>();
    table.set(recordKeys(kind, rec).id, copy(rec));
    this.records.set(kind, table);
  }

  async getRecord<K extends RecordKind>(kind: K, id: string) {
    const rec = this.records.get(kind)?.get(id) as RecordKinds[K] | undefined;
    return rec ? copy(rec) : null;
  }

  async listRecords<K extends RecordKind>(kind: K, filter: RecordFilter = {}) {
    const rows = [...(this.records.get(kind)?.values() ?? [])] as Array<RecordKinds[K]>;
    return copy(
      rows
        .filter((r) => {
          const k = recordKeys(kind, r);
          return (!filter.orderId || k.orderId === filter.orderId) && (!filter.unitId || k.unitIds.includes(filter.unitId)) && (!filter.status || k.status === filter.status);
        })
        .sort((a, b) => recordKeys(kind, b).createdAt.localeCompare(recordKeys(kind, a).createdAt))
        .slice(0, filter.limit ?? 5000),
    );
  }

  async nextNumber(counter: Counter, count = 1) {
    const next = (this.counters.get(counter) ?? 0) + 1;
    this.counters.set(counter, next + count - 1);
    return next;
  }

  async insertGrn(grn: Grn) {
    this.grns.push(copy(grn));
  }

  async getGrn(number: string) {
    const g = this.grns.find((x) => x.number === number);
    return g ? copy(g) : null;
  }

  async listGrns(filter: { poNumber?: string; limit?: number }) {
    return copy(this.grns.filter((g) => !filter.poNumber || g.poNumber === filter.poNumber).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, filter.limit ?? 200));
  }

  async savePhoto(dataUrl: string) {
    const ref = `mem:${randomUUID()}`;
    this.photos.set(ref, dataUrl);
    return ref;
  }

  async photoUrl(ref: string) {
    return this.photos.get(ref) ?? null;
  }
}
