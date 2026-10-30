import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { OrderLinesInput } from "@/components/ops/order-lines-input";
import { PageHeader, TextButton, fieldClassName } from "@/components/ui";
import { firstParam } from "@/lib/query";
import { CX_TYPES, HUBS, INSTALLATIONS, PAYMENT_MODES, PAYMENT_STATUSES, SALE_SOURCES, SALE_TYPES, WARRANTIES } from "@/lib/slack/sale-form";
import { loadWorkspace } from "@/lib/workspace";

const ERRORS: Record<string, string> = {
  customer: "Enter the customer name.",
  phone: "Enter a 10 digit Indian mobile number, for example 98450 12345.",
  product: "Enter the product.",
  product_2: "Product 2 needs a name and an offered price.",
  product_3: "Product 3 needs a name and an offered price.",
  order: "The order could not be created. Check the prices and try again.",
  email: "Enter the email, or leave it blank.",
  shipping_address: "Enter the shipping address.",
  pincode: "Enter the 6 digit pincode.",
  hub: "Choose the hub.",
  cx_type: "Choose New or Repeat.",
  poc: "Enter the POC name.",
  sale_source: "Choose the sale source.",
  sale_type: "Choose Follow up or Same day.",
  list_price: "Enter the product price as a number.",
  offered_price: "Enter the offered price as a number.",
  payment_status: "Choose the payment status.",
  payment_mode: "Choose the payment mode.",
  extended_warranty: "Choose the warranty, or None.",
  installation: "Choose installation, or None.",
  save: "The order could not be saved. Try again.",
};

function SelectField({ name, label, options }: { name: string; label: string; options: readonly string[] }) {
  return (
    <label className="block text-[12px] text-muted">
      {label}
      <select className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name={name} required defaultValue="">
        <option value="" disabled>Choose</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  const code = firstParam(params.error);
  const error = ERRORS[code] ?? (code ? "The order could not be saved. Check the boxes and try again." : "");
  const detail = firstParam(params.detail).slice(0, 200);
  return (
    <section className="max-w-xl">
      <PageHeader
        title="New order"
        description="Phone and at least one product are required. Pick products from the catalogue where you can. Billing address and GST can stay blank."
      />
      {error ? <p className="mb-3 rounded-[14px] border border-[rgba(255,105,120,0.5)] bg-[rgba(255,105,120,0.1)] px-3 py-2 text-[14px] text-bad" role="alert">{error}{detail ? ` ${detail}` : ""}</p> : null}
      <form className="panel-strong grid gap-3 p-4" action="/api/orders" method="post">
        <label className="block text-[12px] text-muted">
          Customer name
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="customer" required minLength={2} maxLength={80} placeholder="Customer name" />
        </label>
        <label className="block text-[12px] text-muted">
          Phone
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="phone" type="tel" required inputMode="tel" pattern="[0-9 +\-]{10,16}" maxLength={16} autoComplete="off" placeholder="98450 12345" />
        </label>
        <label className="block text-[12px] text-muted">
          Email
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="email" type="email" maxLength={80} placeholder="name@email.com" />
        </label>
        <label className="block text-[12px] text-muted">
          Shipping address
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="shipping_address" required minLength={5} maxLength={200} placeholder="House, street, area" />
        </label>
        <label className="block text-[12px] text-muted">
          Pincode
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="pincode" required inputMode="numeric" pattern="\d{6}" placeholder="560001" />
        </label>
        <label className="block text-[12px] text-muted">
          Billing address
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="billing_address" maxLength={200} placeholder="Leave blank if same as shipping" />
        </label>
        <SelectField name="hub" label="Hub" options={HUBS} />
        <SelectField name="cx_type" label="CX type" options={CX_TYPES} />
        <label className="block text-[12px] text-muted">
          POC name
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="poc" required minLength={2} maxLength={80} placeholder="Salesperson name" />
        </label>
        <SelectField name="sale_source" label="Sale source" options={SALE_SOURCES} />
        <SelectField name="sale_type" label="Sale type" options={SALE_TYPES} />
        <p className="pt-2 text-[13px] text-ink">Products</p>
        <OrderLinesInput />
        <SelectField name="payment_status" label="Payment status" options={PAYMENT_STATUSES} />
        <SelectField name="payment_mode" label="Payment mode" options={PAYMENT_MODES} />
        <label className="block text-[12px] text-muted">
          GST details
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="gst" maxLength={120} placeholder="Leave blank if not available" />
        </label>
        <p className="pt-2 text-[13px] text-ink">Add-ons</p>
        <label className="block text-[12px] text-muted">
          Accessories
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="accessories" maxLength={80} placeholder="Leave blank if none" />
        </label>
        <SelectField name="extended_warranty" label="Extended warranty" options={WARRANTIES} />
        <SelectField name="installation" label="Installation" options={INSTALLATIONS} />
        <label className="block text-[12px] text-muted">
          Notes
          <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} name="notes" maxLength={300} placeholder="Anything else" />
        </label>
        <div className="flex items-center gap-3">
          <TextButton>Save order</TextButton>
          <Link href="/orders" className="text-[13px] text-muted">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
