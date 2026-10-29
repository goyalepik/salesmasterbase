import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { PageHeader, TextButton, fieldClassName } from "@/components/ui";
import { firstParam } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

const ERRORS: Record<string, string> = {
  name: "Enter the salesperson's name.",
  customer: "Enter the customer name.",
  product: "Enter the product.",
  price: "Enter the offered price as a number.",
  advance: "Enter the advance as a number, or leave it blank.",
  save: "The order could not be saved. Try again.",
};

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const error = ERRORS[firstParam((await searchParams).error)] ?? "";
  return (
    <section className="max-w-xl">
      <PageHeader
        title="New order"
        description="Customer, product, and offered price are required. Customer type and advance can stay blank. This is the only way a new order is counted."
      />
      {error ? <p className="mb-3 text-[13px] text-warn">{error}</p> : null}
      <form className="panel-strong grid gap-3 p-4" action="/api/orders" method="post">
        <label className="block text-[12px] text-muted">
          Salesperson
          <input className={`mt-1 ${fieldClassName()}`} name="salesperson" required minLength={2} maxLength={60} placeholder="Rahul" />
        </label>
        <label className="block text-[12px] text-muted">
          Customer
          <input className={`mt-1 ${fieldClassName()}`} name="customer" required minLength={2} maxLength={80} placeholder="Customer name" />
        </label>
        <label className="block text-[12px] text-muted">
          Product
          <input className={`mt-1 ${fieldClassName()}`} name="product" required minLength={2} maxLength={80} placeholder="3 seater sofa" />
        </label>
        <label className="block text-[12px] text-muted">
          Offered price
          <input className={`mt-1 ${fieldClassName()}`} name="offeredPrice" required inputMode="decimal" placeholder="69900" />
        </label>
        <label className="block text-[12px] text-muted">
          Customer type
          <input className={`mt-1 ${fieldClassName()}`} name="customerType" maxLength={80} placeholder="Retail" />
        </label>
        <label className="block text-[12px] text-muted">
          Advance, if one was taken
          <input className={`mt-1 ${fieldClassName()}`} name="advance" inputMode="decimal" placeholder="10000" />
        </label>
        <div className="flex items-center gap-3">
          <TextButton>Save order</TextButton>
          <Link href="/inbox" className="text-[13px] text-muted">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
