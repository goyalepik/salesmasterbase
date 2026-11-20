// Storage for the warehouse records. Like the operations store: the service (`service.ts`) holds the rules, a store
// only reads and writes. Two implementations: memory (demo, tests) and Supabase (live, tables from 0006_wms.sql).

import type { Grn, MasterKind, RecordKind, RecordKinds, UnitEvent, WmsMaster, WmsPoHeader, WmsUnit } from "./domain/types";
import type { UnitStatus } from "./domain/unit";

export type UnitFilter = { sku?: string; poNumber?: string; grnNumber?: string; statuses?: UnitStatus[]; limit?: number };

/** The insert was refused because a serial is already taken for its SKU (another person received it a moment ago). */
export class SerialTakenError extends Error {
  constructor(public serial: string) {
    super(`Serial ${serial} is already in stock.`);
  }
}

export type Counter = "grn" | "internal_serial" | "shipment" | "rma" | "count";
export type RecordFilter = { orderId?: string; unitId?: string; status?: string; limit?: number };

/** The keys a record is found by (one table for shipments, unit links, returns and counts). */
export function recordKeys<K extends RecordKind>(kind: K, rec: RecordKinds[K]): { id: string; orderId: string | null; unitIds: string[]; status: string; createdAt: string } {
  const r = rec as RecordKinds[RecordKind];
  if (kind === "shipment") {
    const s = r as RecordKinds["shipment"];
    return { id: s.number, orderId: s.orderId, unitIds: s.unitIds, status: s.status, createdAt: s.dispatchedAt };
  }
  if (kind === "link") {
    const l = r as RecordKinds["link"];
    return { id: l.id, orderId: l.orderId, unitIds: [l.unitId], status: l.active ? "active" : "inactive", createdAt: l.linkedAt };
  }
  if (kind === "rma") {
    const m = r as RecordKinds["rma"];
    return { id: m.number, orderId: m.orderId, unitIds: [m.unitId, ...(m.replacementUnitId ? [m.replacementUnitId] : [])], status: m.status, createdAt: m.createdAt };
  }
  const c = r as RecordKinds["count"];
  return { id: c.number, orderId: null, unitIds: [], status: c.status, createdAt: c.createdAt };
}

export interface WmsStore {
  readonly kind: "memory" | "supabase";

  listMasters(kind?: MasterKind): Promise<WmsMaster[]>;
  /** Adds the names that aren't there yet (case-insensitive). */
  addMasters(items: Array<{ kind: MasterKind; name: string }>): Promise<void>;
  setMasterActive(id: string, active: boolean): Promise<boolean>;
  setMasterNote(id: string, note: string | null): Promise<boolean>;

  savePoHeader(header: WmsPoHeader): Promise<void>;
  getPoHeader(poNumber: string): Promise<WmsPoHeader | null>;
  listPoHeaders(): Promise<WmsPoHeader[]>;

  /** All or nothing. Throws SerialTakenError when a serial is already taken for its SKU by a unit not gone for good. */
  insertUnits(units: WmsUnit[]): Promise<void>;
  /** Undo an insert (when the stock receipt after it failed). */
  deleteUnits(ids: string[]): Promise<void>;
  getUnit(id: string): Promise<WmsUnit | null>;
  /** Units whose serial or second ID matches this normalised serial, newest first. */
  unitsBySerial(serialNorm: string): Promise<WmsUnit[]>;
  /** Units with any of these normalised serials (one query for a whole receipt). */
  unitsBySerials(serialNorms: string[]): Promise<WmsUnit[]>;
  listUnits(filter: UnitFilter): Promise<WmsUnit[]>;
  updateUnit(id: string, patch: Partial<WmsUnit>, expectStatus?: UnitStatus): Promise<boolean>;

  addUnitEvents(events: Array<Omit<UnitEvent, "id">>): Promise<void>;
  unitEvents(unitId: string): Promise<UnitEvent[]>;

  /** Next number in a counter. `count` reserves that many at once and returns the first. */
  nextNumber(counter: Counter, count?: number): Promise<number>;

  /** Shipments, unit links, returns and counts: insert or replace by id. */
  saveRecord<K extends RecordKind>(kind: K, rec: RecordKinds[K]): Promise<void>;
  getRecord<K extends RecordKind>(kind: K, id: string): Promise<RecordKinds[K] | null>;
  /** Newest first. */
  listRecords<K extends RecordKind>(kind: K, filter?: RecordFilter): Promise<Array<RecordKinds[K]>>;
  insertGrn(grn: Grn): Promise<void>;
  getGrn(number: string): Promise<Grn | null>;
  listGrns(filter: { poNumber?: string; limit?: number }): Promise<Grn[]>;

  /** Stores a photo (a small JPEG data URL from the phone) and returns its reference. */
  savePhoto(dataUrl: string): Promise<string>;
  /** A link the browser can show for a stored photo. */
  photoUrl(ref: string): Promise<string | null>;
}
