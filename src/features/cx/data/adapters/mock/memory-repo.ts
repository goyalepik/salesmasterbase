import type { CallRecord, Customer, Demo, Interaction, Order, Ticket, TicketEvent } from "../../../domain/types";
import type { CxRepository, TicketFilters } from "../../repository";

export type CxSnapshot = {
  tickets: Ticket[];
  events: TicketEvent[];
  customers: Customer[];
  interactions: Interaction[];
  orders: Order[];
  demos: Demo[];
  calls: CallRecord[];
};

export const emptySnapshot = (): CxSnapshot => ({ tickets: [], events: [], customers: [], interactions: [], orders: [], demos: [], calls: [] });

export function matchesFilters(t: Ticket, f: TicketFilters): boolean {
  if (f.level && t.level !== f.level) return false;
  if (f.label && t.label !== f.label) return false;
  if (f.bucket && t.bucket !== f.bucket) return false;
  if (f.queueId && t.queueId !== f.queueId) return false;
  if (f.channel && t.channel !== f.channel) return false;
  if (f.type && t.type !== f.type) return false;
  if (f.status) {
    if (f.status === "open_any" ? t.status === "resolved" || t.status === "closed" : t.status !== f.status) return false;
  }
  if (f.q) {
    const q = f.q.toLowerCase().replace(/\s+/g, "");
    const hay = `${t.id} ${t.customerUid} ${t.orderRef ?? ""} ${t.entities.orderRefs.join(" ")} ${t.subject} ${t.body}`.toLowerCase().replace(/\s+/g, "");
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** In-memory repository. `onChange` lets the browser save a copy (the "localfile" adapter). */
export class MemoryCxRepository implements CxRepository {
  constructor(private data: CxSnapshot = emptySnapshot(), private onChange?: (data: CxSnapshot) => void) {}

  snapshot(): CxSnapshot {
    return this.data;
  }

  private changed() {
    this.onChange?.(this.data);
  }

  async listTickets(filters: TicketFilters = {}) {
    return this.data.tickets.filter((t) => matchesFilters(t, filters));
  }
  async getTicket(id: string) {
    return this.data.tickets.find((t) => t.id === id) ?? null;
  }
  async saveTicket(ticket: Ticket) {
    const i = this.data.tickets.findIndex((t) => t.id === ticket.id);
    this.data = { ...this.data, tickets: i >= 0 ? this.data.tickets.map((t, j) => (j === i ? ticket : t)) : [ticket, ...this.data.tickets] };
    this.changed();
  }
  async listEvents(ticketId?: string) {
    return ticketId ? this.data.events.filter((e) => e.ticketId === ticketId) : this.data.events;
  }
  async appendEvent(event: TicketEvent) {
    this.data = { ...this.data, events: [...this.data.events, event] };
    this.changed();
  }
  async getCustomer(uid: string) {
    return this.data.customers.find((c) => c.uid === uid) ?? null;
  }
  async saveCustomer(customer: Customer) {
    const others = this.data.customers.filter((c) => c.uid !== customer.uid);
    this.data = { ...this.data, customers: [customer, ...others] };
    this.changed();
  }
  async searchCustomers(query: string) {
    const q = query.toLowerCase().replace(/[\s-]/g, "");
    return this.data.customers.filter((c) => c.uid.replace(/[\s-]/g, "").includes(q) || (c.name ?? "").toLowerCase().includes(q) || c.handles.some((h) => h.handle.toLowerCase().includes(q)));
  }
  async listInteractions(customerUid?: string) {
    return customerUid ? this.data.interactions.filter((i) => i.customerUid === customerUid) : this.data.interactions;
  }
  async addInteraction(interaction: Interaction) {
    this.data = { ...this.data, interactions: [...this.data.interactions, interaction] };
    this.changed();
  }
  async listOrders(customerUid?: string) {
    return customerUid ? this.data.orders.filter((o) => o.customerUid === customerUid) : this.data.orders;
  }
  async listDemos(customerUid?: string) {
    return customerUid ? this.data.demos.filter((d) => d.customerUid === customerUid) : this.data.demos;
  }
  async listCalls(customerUid?: string) {
    return customerUid ? this.data.calls.filter((c) => c.customerUid === customerUid) : this.data.calls;
  }
  async addCall(call: CallRecord) {
    this.data = { ...this.data, calls: [...this.data.calls, call] };
    this.changed();
  }
}
