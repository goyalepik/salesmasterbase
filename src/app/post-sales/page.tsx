import Link from "next/link";
import { ArrowUpRight, Boxes, ListChecks, Store, Truck, Users, type LucideIcon } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { POST_SALES_AREAS } from "@/lib/app-roles";
import { isoDateInIst } from "@/lib/format";
import { deliveryStatusOf, statusFromIso } from "@/lib/ops/delivery-status";
import type { OpsStore } from "@/lib/ops/store";
import { isTestName } from "@/lib/ops/test-mode";
import { loadOps } from "@/lib/ops-ui/load";
import { publicStatusPath } from "@/lib/public-status";

export const metadata = { title: "Post-sales · EPIK" };

const LOOK: Record<string, { icon: LucideIcon; colour: string }> = {
  "/sales": { icon: Store, colour: "#14875a" },
  "/logistics": { icon: ListChecks, colour: "#2f6fe8" },
  "/inventory": { icon: Boxes, colour: "#7c5ce6" },
  "/dispatch": { icon: Truck, colour: "#0e8f9a" },
};

/** One number per area, so the cards say what's waiting. Never throws: a card without a number still works. */
async function counts(store: OpsStore): Promise<Record<string, string>> {
  try {
    const today = isoDateInIst(new Date());
    const [recent, pos, installs] = await Promise.all([
      store.listOrders({ stage: "all", from: statusFromIso(), limit: 5000 }),
      store.listPurchaseOrders({ status: "open" }),
      store.listInstallations({ status: "pending" }),
    ]);
    const orders = recent.items.filter((o) => !isTestName(o.customerName));
    const sold = orders.filter((o) => o.stage !== "cancelled" && isoDateInIst(new Date(o.createdAt)) === today).length;
    const fresh = orders.filter((o) => deliveryStatusOf(o.stage) === "new").length;
    const onRoad = orders.filter((o) => deliveryStatusOf(o.stage) === "out_for_delivery").length;
    return {
      "/sales": `${sold} sold today`,
      "/logistics": `${fresh} NEW to check`,
      "/inventory": `${new Set(pos.map((p) => p.poNumber)).size} open POs`,
      "/dispatch": `${onRoad} on the road · ${installs.length} installs due`,
    };
  } catch {
    return {};
  }
}

/** The Post-sales home: one card per area. Everyone can open every area; the role at the top decides who can change things. */
export default async function PostSalesPage() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const numbers = await counts(ops.store);
  const link = publicStatusPath();
  return (
    <section>
      <div className="s-page-head">
        <div>
          <h1>Post-sales</h1>
          <p>From the sale to the customer&apos;s door. Everyone can see every area; the role at the top decides who can change things.</p>
        </div>
      </div>
      <div className="ps-grid">
        {POST_SALES_AREAS.map((area) => {
          const look = LOOK[area.href];
          const Icon = look.icon;
          return (
            <Link key={area.href} href={area.href} className="ps-card">
              <span className="ps-icon" style={{ background: look.colour }}><Icon size={20} /></span>
              <h2>{area.label}</h2>
              <p>{area.description}</p>
              <span className="ps-foot">
                <span className="ps-count">{numbers[area.href] ?? ""}</span>
                <span>{area.who} acts here</span>
              </span>
            </Link>
          );
        })}
        {link ? (
          <a href={`${link}?view=people`} target="_blank" rel="noreferrer" className="ps-card is-readonly">
            <span className="ps-icon" style={{ background: "#475569" }}><Users size={20} /></span>
            <h2>Salespeople&apos;s orders</h2>
            <p>Read only, no login. Each salesperson taps their name and sees every order they posted, with its status.</p>
            <span className="ps-foot">
              <span className="ps-count">Opens the team link</span>
              <ArrowUpRight size={15} />
            </span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
