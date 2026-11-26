import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { canEdit } from "@/features/ims/role";
import { BillForm } from "@/features/ims/ui/bill-form";
import { loadPage } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add stock · Inventory · EPIK" };

export default async function NewReceipt() {
  const { data, role } = await loadPage();
  if (!data) return <ImsUnavailable role={role} current="in" />;
  const s = data.snapshot;
  const products = s.products.map((p) => ({ sku: p.sku, name: p.name }));
  const vendors = [...new Set(s.inwards.map((w) => w.vendor).filter((v): v is string => !!v))].sort().slice(0, 300);
  return (
    <ImsShell current="in" role={role} readAt={data.readAt} stale={data.stale}>
      <Link href="/ims/stock-in" className="ims-back"><ArrowLeft size={15} /> Stock in</Link>
      <div className="ims-head">
        <div>
          <h1>Add stock from a bill</h1>
          <p>Upload the bill: the AI reads it, you check every line, add serials, and save. Stock goes up at once.</p>
        </div>
      </div>
      {!canEdit(role) ? <p className="ims-card ims-empty">Switch to Editor (top right) to add stock.</p> : <BillForm products={products} vendors={vendors} ready={data.entriesReady} />}
    </ImsShell>
  );
}
