import type { OpsSeed, SeedOrder } from "@/lib/ops/snapshot";
import type { OrderStage, Product } from "@/lib/ops/types";

/**
 * Invented sample data for a fresh clone. Real company data is imported into
 * data/ops-seed.local.json (gitignored) and used instead when it exists.
 */
const PRODUCTS: Product[] = [
  { sku: "ep-dr-l50s-pu", name: "DREAME L50s Pro Ultra Robot Vacuum & Mop", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 8_999_900, gstRate: 0.18, hsn: "85081100", eol: false, needsInstallation: true },
  { sku: "ep-dr-d30u-wh", name: "DREAME D30 Ultra Robot Vacuum and Mop", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 5_999_900, gstRate: 0.18, hsn: "85081100", eol: false, needsInstallation: true },
  { sku: "ep-ec-t50po", name: "ECOVACS Deebot T50 PRO Omni 2 In 1 Robot Vacuum", brand: "Ecovacs", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 7_999_900, gstRate: 0.18, hsn: "85081100", eol: false, needsInstallation: true },
  { sku: "ep-ec-n30-wh", name: "ECOVACS DEEBOT N30 White 2 in 1 Robot Vacuum", brand: "Ecovacs", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 2_399_900, gstRate: 0.18, hsn: "85081100", eol: false, needsInstallation: true },
  { sku: "ep-ap-i17-256-bk", name: "Apple iPhone 17 (Black, 256 GB)", brand: "Apple", category: "Mobile", channel: "CnC", listPriceMinor: 8_990_000, gstRate: 0.18, hsn: "85171300", eol: false, needsInstallation: false },
  { sku: "ep-sa-u7300f-75", name: "Samsung 189 cm (75) Crystal UHD U7300F TV", brand: "Samsung", category: "Television", channel: "CnC", listPriceMinor: 9_499_000, gstRate: 0.18, hsn: "85287217", eol: false, needsInstallation: false },
  { sku: "ep-ph-oc-6l", name: "Philips OneChef 6L Smart All in One Cooker", brand: "Philips", category: "Kitchen appliance", channel: "SOR", listPriceMinor: 2_499_900, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
  { sku: "ep-up-u10", name: "Upliance 1.0 AI Cooking Robot", brand: "Upliance", category: "Kitchen appliance", channel: "SOR", listPriceMinor: 3_699_900, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
  { sku: "ep-dy-v8", name: "Dyson V8 Absolute Vacuum Cleaner", brand: "Dyson", category: "Home Improvement", channel: "CnC", listPriceMinor: 2_799_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
  { sku: "ep-go-fl", name: "Godrej 7 kg Front Load Washing Machine", brand: "Godrej", category: "Large appliance", channel: "CnC", listPriceMinor: 2_890_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
];

const NAMES = ["Asha Rao", "Vikram Shetty", "Neha Kulkarni", "Rahul Menon", "Divya Iyer", "Karthik Gowda", "Sneha Reddy", "Arjun Nair", "Pooja Hegde", "Rohan Das", "Meera Pillai", "Siddharth Jain", "Ananya Bhat", "Imran Khan", "Lakshmi Prasad", "Tarun Mehta"];
const POCS = ["Ibrahim", "Kaustubh", "Harish", "Naveed", "Tushar", "Kishan"];
const HUBS = ["Hebbal", "HQ", "HSR HQ", "Jayanagar", "Kengeri", "Mahadevpura"];

export function buildDemoSeed(now: Date): OpsSeed {
  const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString();
  const plan: Array<[OrderStage, number]> = [
    ["awaiting_payment", 0], ["awaiting_payment", 0], ["awaiting_payment", 1],
    ["awaiting_inventory", 0], ["awaiting_inventory", 2],
    ["ready_to_dispatch", 1], ["ready_to_dispatch", 2],
    ["out_for_delivery", 2],
    ...Array.from({ length: 40 }, (_, i) => ["delivered", 3 + (i % 12)] as [OrderStage, number]),
  ];
  const orders: SeedOrder[] = plan.map(([stage, ago], i) => {
    const product = PRODUCTS[(i * 7) % PRODUCTS.length];
    const offered = Math.round((product.listPriceMinor ?? 1_000_000) * (0.88 + ((i * 13) % 10) / 100));
    const paid = stage === "awaiting_payment" ? 0 : stage === "delivered" ? offered : Math.round(offered * 0.3);
    return {
      key: `demo-${i}`,
      shopifyOrderId: stage === "delivered" ? `#PIK${3800 + i}` : null,
      createdAt: day(ago),
      customerName: NAMES[i % NAMES.length],
      phone: `98${String(45000000 + i * 7919).slice(0, 8)}`,
      address: `${12 + i}, ${["2nd Main", "5th Cross", "100 Ft Rd", "Outer Ring Rd"][i % 4]}, Bengaluru`,
      hub: HUBS[i % HUBS.length],
      poc: POCS[i % POCS.length],
      stage,
      deliveredAt: stage === "delivered" ? day(Math.max(0, ago - 1)) : null,
      paidMinor: paid,
      codDueMinor: stage === "delivered" ? 0 : offered - paid,
      declaredPaymentStatus: paid ? "Advance payment realized" : "Pending",
      declaredPaymentMode: ["UPI", "Card", "Cash", "Snapmint"][i % 4],
      holdReason: null,
      cancelReason: null,
      notes: null,
      lines: [{ sku: product.sku, productName: product.name, offeredPriceMinor: offered, serialNo: null, status: stage === "delivered" || stage === "out_for_delivery" ? "dispatched" : stage === "ready_to_dispatch" ? "reserved" : "pending" }],
    };
  });
  return {
    generatedAt: day(30),
    source: "invented demo data",
    products: PRODUCTS,
    stock: PRODUCTS.map((p, i) => ({ sku: p.sku, units: [6, 0, 3, 9, 2, 1, 14, 4, 0, 2][i], unitCostMinor: Math.round((p.listPriceMinor ?? 0) * 0.8) })),
    purchaseOrders: [
      { poNumber: "PO-DEMO-0001", vendor: "Value-One Retail", sku: "ep-dr-d30u-wh", productName: null, qtyOrdered: 10, qtyReceived: 0, eta: day(-4).slice(0, 10), createdAt: day(6) },
      { poNumber: "PO-DEMO-0002", vendor: "White Knight Advisors", sku: "ep-dy-v8", productName: null, qtyOrdered: 5, qtyReceived: 0, eta: day(1).slice(0, 10), createdAt: day(9) },
    ],
    orders,
    installations: [],
  };
}
