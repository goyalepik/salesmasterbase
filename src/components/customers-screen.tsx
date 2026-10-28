import Link from "next/link";
import { EmptyState, PageHeader, ReviewText, TextButton, fieldClassName } from "@/components/ui";
import { formatDateTime, formatInrFromMinor } from "@/lib/format";
import type { CustomerGroup } from "@/lib/types";

export function CustomersScreen({ query, groups }: { query: string; groups: CustomerGroup[] }) {
  return (
    <section>
      <PageHeader
        title="Customers"
        description="Search by customer name or product. Phone, email, and address stay on the order page."
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/customers">
        <label className="block min-w-[240px] flex-1 text-[12px] text-muted">
          Customer or product
          <input className={`mt-1 ${fieldClassName()}`} name="q" defaultValue={query} placeholder="Name or product" />
        </label>
        <TextButton>Search</TextButton>
      </form>
      {groups.length === 0 ? (
        <EmptyState title="No matching customer" detail="Try the name or product written on the order sheet. A phone number is not a search key here." />
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <section key={group.customerName} className="panel-strong px-3 py-3">
              <h2 className="text-[15px]">{group.customerName}</h2>
              <ul className="mt-2 border-t border-line">
                {group.orders.map((order) => (
                  <li key={order.id} className="grid gap-1 border-t border-line py-2 first:border-t-0 sm:grid-cols-[140px_minmax(0,1fr)_auto] sm:items-baseline">
                    <span className="text-[12px] text-muted tabular-nums">{formatDateTime(order.eventReceivedAt)}</span>
                    <Link href={`/inbox/${order.id}`} className="text-[13px]">
                      <span className="block">{order.summary}</span>
                      <span className="text-[12px] text-muted">
                        {order.product ? `${order.product}` : "No product label"}
                        {order.offeredPriceMinor != null ? ` · offered ${formatInrFromMinor(order.offeredPriceMinor)}` : ""}
                        {order.customerType ? ` · ${order.customerType}` : ""}
                        {order.threadUpdates > 0 ? ` · ${order.threadUpdates} thread update${order.threadUpdates === 1 ? "" : "s"}` : ""}
                      </span>
                    </Link>
                    <ReviewText review={order.review} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
