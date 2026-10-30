import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";
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

function TextField({ label, wide, ...input }: { label: string; wide?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block text-[12px] text-muted ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input className={`mt-1 ${fieldClassName()} !h-11 !text-[14px]`} {...input} />
    </label>
  );
}

function FormSection({ step, title, note, children }: { step: number; title: string; note: string; children: ReactNode }) {
  return (
    <fieldset className="dashboard-panel">
      <legend className="sr-only">{title}</legend>
      <div className="mb-3 flex items-center gap-3">
        <span className="step-dot">{step}</span>
        <span>
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          <span className="block text-[12px] text-muted">{note}</span>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
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
    <section className="mx-auto max-w-4xl">
      <PageHeader
        title="New order"
        description="Phone and at least one product are required. Pick products from the catalogue where you can. Billing address and GST can stay blank."
      />
      {error ? <p className="mb-3 rounded-[14px] border border-[rgba(255,105,120,0.5)] bg-[rgba(255,105,120,0.1)] px-3 py-2 text-[14px] text-bad" role="alert">{error}{detail ? ` ${detail}` : ""}</p> : null}
      <form className="grid gap-3" action="/api/orders" method="post">
        <FormSection step={1} title="Customer" note="Who is buying and where it goes.">
          <TextField label="Customer name" name="customer" required minLength={2} maxLength={80} placeholder="Customer name" />
          <TextField label="Phone" name="phone" type="tel" required inputMode="tel" pattern="[0-9 +\-]{10,16}" maxLength={16} autoComplete="off" placeholder="98450 12345" />
          <TextField label="Email" name="email" type="email" maxLength={80} placeholder="name@email.com" />
          <TextField label="Pincode" name="pincode" required inputMode="numeric" pattern="\d{6}" placeholder="560001" />
          <TextField wide label="Shipping address" name="shipping_address" required minLength={5} maxLength={200} placeholder="House, street, area" />
          <TextField wide label="Billing address" name="billing_address" maxLength={200} placeholder="Leave blank if same as shipping" />
        </FormSection>
        <FormSection step={2} title="Sale" note="The POC typed here is the seller for this order.">
          <SelectField name="hub" label="Hub" options={HUBS} />
          <TextField label="POC name" name="poc" required minLength={2} maxLength={80} placeholder="Salesperson name" />
          <SelectField name="cx_type" label="CX type" options={CX_TYPES} />
          <SelectField name="sale_source" label="Sale source" options={SALE_SOURCES} />
          <SelectField name="sale_type" label="Sale type" options={SALE_TYPES} />
        </FormSection>
        <FormSection step={3} title="Products" note="Up to 3. Offered price is the deal price, not money received.">
          <div className="sm:col-span-2">
            <OrderLinesInput />
          </div>
        </FormSection>
        <FormSection step={4} title="Payment" note="RevOps checks this against the bank next.">
          <SelectField name="payment_status" label="Payment status" options={PAYMENT_STATUSES} />
          <SelectField name="payment_mode" label="Payment mode" options={PAYMENT_MODES} />
          <TextField wide label="GST details" name="gst" maxLength={120} placeholder="Leave blank if not available" />
        </FormSection>
        <FormSection step={5} title="Add-ons" note="Installation is added automatically for robot vacuums.">
          <TextField label="Accessories" name="accessories" maxLength={80} placeholder="Leave blank if none" />
          <SelectField name="extended_warranty" label="Extended warranty" options={WARRANTIES} />
          <SelectField name="installation" label="Installation" options={INSTALLATIONS} />
          <TextField label="Notes" name="notes" maxLength={300} placeholder="Anything else" />
        </FormSection>
        <div className="form-actions">
          <Link href="/orders" className="btn-quiet inline-flex h-10 items-center rounded-[12px] px-4 text-[13px]">Cancel</Link>
          <TextButton>Save order</TextButton>
        </div>
      </form>
    </section>
  );
}
