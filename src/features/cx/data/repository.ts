import type { CallRecord, Customer, Demo, Interaction, Order, Ticket, TicketEvent } from "../domain/types";

export type TicketFilters = {
  level?: string;
  label?: string;
  bucket?: string;
  queueId?: string;
  channel?: string;
  type?: string;
  status?: string;
  /** Phone, ticket id, order number or a keyword. */
  q?: string;
};

/**
 * Everything the CX module stores. The mock adapter keeps it in memory (optionally saved in the browser);
 * a Supabase adapter implements the same methods later, one table per type plus append-only ticket_events.
 */
export interface CxRepository {
  listTickets(filters?: TicketFilters): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket | null>;
  saveTicket(ticket: Ticket): Promise<void>;
  listEvents(ticketId?: string): Promise<TicketEvent[]>;
  appendEvent(event: TicketEvent): Promise<void>;
  getCustomer(uid: string): Promise<Customer | null>;
  saveCustomer(customer: Customer): Promise<void>;
  searchCustomers(query: string): Promise<Customer[]>;
  listInteractions(customerUid?: string): Promise<Interaction[]>;
  addInteraction(interaction: Interaction): Promise<void>;
  listOrders(customerUid?: string): Promise<Order[]>;
  listDemos(customerUid?: string): Promise<Demo[]>;
  listCalls(customerUid?: string): Promise<CallRecord[]>;
  addCall(call: CallRecord): Promise<void>;
}
