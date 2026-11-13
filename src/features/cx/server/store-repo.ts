import type { CxRepository, TicketFilters } from "../data/repository";
import { matchesFilters } from "../data/adapters/mock/memory-repo";
import type { CallRecord, Customer, Interaction, Ticket, TicketEvent } from "../domain/types";
import type { Changes, CxStore } from "./store";

/**
 * The domain code (service.ts) runs against this: reads come from the server's ticket index and the store,
 * writes are buffered and committed once with `changes()`. Only the tickets touched are written back.
 */
export class StoreRepository implements CxRepository {
  private tickets: Map<string, Ticket>;
  private dirtyTickets = new Map<string, Ticket>();
  private newEvents: TicketEvent[] = [];
  private eventCache = new Map<string, TicketEvent[]>();
  private customers = new Map<string, Customer | null>();
  private dirtyCustomers = new Map<string, Customer>();
  private interactionCache = new Map<string, Interaction[]>();
  private newInteractions: Interaction[] = [];
  private callCache = new Map<string, CallRecord[]>();
  private newCalls: CallRecord[] = [];

  constructor(private store: CxStore, index: Map<string, Ticket>) {
    this.tickets = new Map(index);
  }

  async listTickets(filters: TicketFilters = {}) {
    return [...this.tickets.values()].filter((t) => matchesFilters(t, filters));
  }

  async getTicket(id: string) {
    if (this.tickets.has(id)) return this.tickets.get(id)!;
    // Older than the index window: read it from the store.
    const t = await this.store.getTicket(id);
    if (t) this.tickets.set(id, t);
    return t;
  }

  async saveTicket(ticket: Ticket) {
    this.tickets.set(ticket.id, ticket);
    this.dirtyTickets.set(ticket.id, ticket);
  }

  async listEvents(ticketId?: string) {
    if (!ticketId) throw new Error("Listing every event is not supported on the shared store.");
    if (!this.eventCache.has(ticketId)) this.eventCache.set(ticketId, await this.store.getEvents(ticketId));
    return [...this.eventCache.get(ticketId)!, ...this.newEvents.filter((e) => e.ticketId === ticketId)];
  }

  async appendEvent(event: TicketEvent) {
    this.newEvents.push(event);
  }

  async getCustomer(uid: string) {
    if (this.dirtyCustomers.has(uid)) return this.dirtyCustomers.get(uid)!;
    if (!this.customers.has(uid)) this.customers.set(uid, await this.store.getCustomer(uid));
    return this.customers.get(uid) ?? null;
  }

  async saveCustomer(customer: Customer) {
    this.dirtyCustomers.set(customer.uid, customer);
  }

  async searchCustomers(): Promise<Customer[]> {
    throw new Error("Search customers through the ticket index.");
  }

  async listInteractions(customerUid?: string) {
    if (!customerUid) throw new Error("Listing every interaction is not supported on the shared store.");
    if (!this.interactionCache.has(customerUid)) this.interactionCache.set(customerUid, await this.store.interactions(customerUid));
    return [...this.interactionCache.get(customerUid)!, ...this.newInteractions.filter((i) => i.customerUid === customerUid)];
  }

  async addInteraction(interaction: Interaction) {
    this.newInteractions.push(interaction);
  }

  async listOrders() {
    return [];
  }

  async listDemos() {
    return [];
  }

  async listCalls(customerUid?: string) {
    if (!customerUid) throw new Error("Listing every call is not supported on the shared store.");
    if (!this.callCache.has(customerUid)) this.callCache.set(customerUid, await this.store.calls(customerUid));
    return [...this.callCache.get(customerUid)!, ...this.newCalls.filter((c) => c.customerUid === customerUid)];
  }

  async addCall(call: CallRecord) {
    this.newCalls.push(call);
  }

  /** Everything written since this repository was made. */
  changes(): Changes {
    return {
      tickets: [...this.dirtyTickets.values()],
      events: this.newEvents,
      customers: [...this.dirtyCustomers.values()],
      interactions: this.newInteractions,
      calls: this.newCalls,
    };
  }
}
