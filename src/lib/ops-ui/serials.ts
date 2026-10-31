import type { StockMovement } from "@/lib/ops/types";

export type SerialInStock = { serial: string; since: string; source: string };
export type StockDetail = {
  serials: SerialInStock[];
  /** Units on hand with no serial number recorded (opening stock, or received without one). */
  unserialised: number;
  movements: Array<{ at: string; kind: StockMovement["kind"]; qty: number; serial: string | null; note: string | null; actor: string; ref: string | null }>;
};

const SOURCE: Record<StockMovement["kind"], string> = {
  opening: "Opening stock",
  inward: "Received",
  return: "Returned",
  adjust: "Count correction",
  dispatch: "Dispatched",
  rtv: "Returned to vendor",
};

export function movementLabel(kind: StockMovement["kind"]): string {
  return SOURCE[kind];
}

/**
 * Serial numbers still on the shelf: every serial that came in, minus every serial that went out.
 * Movements are newest first, as `listMovements` returns them.
 */
export function stockDetail(movements: StockMovement[], onHand: number): StockDetail {
  const ins = new Map<string, SerialInStock[]>();
  const oldestFirst = [...movements].reverse();
  for (const m of oldestFirst) {
    if (!m.serialNo) continue;
    const key = m.serialNo.trim().toUpperCase();
    if (m.qty > 0) {
      const list = ins.get(key) ?? [];
      list.push({ serial: m.serialNo.trim(), since: m.createdAt, source: SOURCE[m.kind] });
      ins.set(key, list);
    } else {
      ins.get(key)?.shift();
    }
  }
  const serials = [...ins.values()].flat().sort((a, b) => b.since.localeCompare(a.since));
  return {
    serials,
    unserialised: Math.max(0, onHand - serials.length),
    movements: movements.slice(0, 15).map((m) => ({ at: m.createdAt, kind: m.kind, qty: m.qty, serial: m.serialNo, note: m.note, actor: m.actor, ref: m.refId })),
  };
}
