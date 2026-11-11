// Plain shelf categories for the Inventory view and the live sheet tab. Most products came from the sheets without a
// category, so the category is worked out from the product name (and its Shopify type, when it has one). Pure.

import type { StockLevel } from "@/lib/ops/types";

export const STOCK_CATEGORIES = [
  "Phones",
  "Robot vacuums",
  "Vacuums & floor care",
  "Kitchen appliances",
  "Cookware",
  "Large appliances",
  "Air purifiers & fans",
  "TVs & projectors",
  "Audio",
  "Wearables & smart glasses",
  "Personal care",
  "Perfume",
  "Smart home & security",
  "Computers",
  "Health devices",
  "Accessories & spares",
  "Other",
] as const;

export type StockCategory = (typeof STOCK_CATEGORIES)[number];

// Order matters: the first rule that matches wins (accessory kits before robot vacuums, cameras before accessories).
const RULES: Array<[StockCategory, RegExp]> = [
  ["Smart home & security", /surveillance|cp ?plus|\bnvr\b|\bdvr\b|\bpoe\b|bullet camera|dome camera|pan tilt camera|door ?lock|smart lock|external lock|doorbell|door phone|outdoor station|gateway|safe locker|smart plug|smart light|bulb|dashcam|server rack|network rack|\brack\b|rj-45|ethernet cable|utp cable|secureye/i],
  ["Accessories & spares", /accessor|mop(ping)? pads?|dust bag|roller brush|side brush|cleaning (solution|liquid)|silicone case|clear case|hybrid .*case|case for|screen protector|tempered glass|power adapter|charging adapter|charger|usb-c cable|memory card|microsd|apple ?care|filter replacement|hstn frame/i],
  ["Phones", /iphone|galaxy [asmz]\d|galaxy s\d|pixel \d|motorola|moto g|oneplus \d|oneplus nord(?! buds)|nothing phone|smartphone|mobile phone|^ep-(ap-i|sa-[asmz])\d/i],
  ["Robot vacuums", /robot(ic)? vac|robot vacuum|deebot|omni|ilife [atv]\d|ilife t20|ilife v3|robo vac|robot.{0,20}mop/i],
  ["Vacuums & floor care", /vacuum|wet ?& ?dry|spot cleaner|electric mop|\bmop\b|scrubber|floor clean/i],
  ["Perfume", /perfume|parfum|eau de/i],
  ["Personal care", /hair|trimmer|groom|shaver|callus|skin|massag|epilat|breast pump|straighten|styler/i],
  ["Large appliances", /refrigerator|fridge|washing machine|washer|dishwasher|\bac\b|split .*inverter|air conditioner|water heater|water purifier|air cooler|storage water|a\.? ?o\.? smith|garment steamer/i],
  ["Air purifiers & fans", /air purifier|purifier|\bfan\b|atomberg|1200mm/i],
  ["TVs & projectors", /\btv\b|oled|qled|projector|television/i],
  ["Audio", /earbuds|buds|headphone|speaker|soundbar|\btws\b/i],
  ["Wearables & smart glasses", /watch|fitness tracker|whoop|garmin|fitbit|smart glasses|ray-?ban|oakley|pendant|ring\b/i],
  ["Cookware", /cookware|kadai|kadhai|pan\b|tawa|frying pan|saucepan|casserole|kitchen tools|knife/i],
  ["Kitchen appliances", /air fryer|fryer|pressure cooker|robocook|nutri-?pot|soup maker|egg boiler|instant pot|cooktop|induction|microwave|oven|kitchen robot|blender|juicer|mixer|grinder|coffee|espresso|kettle|sandwich|toaster|ice maker|chopper|smart cooker/i],
  ["Computers", /laptop|webcam|macbook|ipad|tablet|monitor|keyboard|mouse/i],
  ["Health devices", /ecg|pain management|curapod|bp monitor|oximeter|glucometer|nebuli/i],
];

/** The shelf category for a product. Shopify's product type helps when the name alone says little. */
export function stockCategory(item: { name: string; category: string | null }): StockCategory {
  const text = `${item.name} ${item.category ?? ""}`;
  for (const [category, test] of RULES) if (test.test(text)) return category;
  return "Other";
}

export type StockGroupBy = "category" | "brand";

export type StockGroup = {
  key: string;
  label: string;
  rows: StockLevel[];
  skus: number;
  onHand: number;
  free: number;
  allocated: number;
  incoming: number;
  valueMinor: number;
};

/** Stock grouped by category or brand, biggest stock value first. Products with nothing on hand or coming are left out. */
export function groupStock(levels: StockLevel[], by: StockGroupBy): StockGroup[] {
  const groups = new Map<string, StockGroup>();
  for (const row of levels) {
    if (row.onHand <= 0 && row.incoming <= 0 && row.reserved <= 0) continue;
    const label = by === "brand" ? row.brand?.trim() || "No brand" : stockCategory(row);
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
    const group = groups.get(key) ?? { key, label, rows: [], skus: 0, onHand: 0, free: 0, allocated: 0, incoming: 0, valueMinor: 0 };
    group.rows.push(row);
    group.skus++;
    group.onHand += Math.max(0, row.onHand);
    group.free += Math.max(0, row.available);
    group.allocated += row.reserved;
    group.incoming += row.incoming;
    group.valueMinor += Math.max(0, row.onHand) * (row.unitCostMinor ?? 0);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => b.onHand - a.onHand || a.name.localeCompare(b.name));
  return [...groups.values()].sort((a, b) => b.valueMinor - a.valueMinor || b.onHand - a.onHand || a.label.localeCompare(b.label));
}
