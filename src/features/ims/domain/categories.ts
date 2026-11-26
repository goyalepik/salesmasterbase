// One clear category per product. The sheets' own categories are too coarse ("Home Improvement" holds robot vacuums,
// "BPCL" is a deal, not a kind of product), so the IMS decides from the product name first, then the sheets'
// category, and an admin's choice always wins. Pure: tests use it.

export const CATEGORIES = [
  "Robot vacuums",
  "Vacuums & floor care",
  "Phones",
  "Laptops & tablets",
  "TVs & projectors",
  "Audio & wearables",
  "Air purifiers & fans",
  "Kitchen",
  "Large appliances",
  "Smart home & security",
  "Personal care",
  "Accessories",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_COLOURS: Record<Category, string> = {
  "Robot vacuums": "#22d3ee",
  "Vacuums & floor care": "#0ea5e9",
  Phones: "#a78bfa",
  "Laptops & tablets": "#818cf8",
  "TVs & projectors": "#f472b6",
  "Audio & wearables": "#fb7185",
  "Air purifiers & fans": "#34d399",
  Kitchen: "#fbbf24",
  "Large appliances": "#f97316",
  "Smart home & security": "#60a5fa",
  "Personal care": "#e879f9",
  Accessories: "#94a3b8",
  Other: "#64748b",
};

/** Words in the product name → category. First match wins, so the specific ones come first. */
const RULES: Array<[RegExp, Category]> = [
  [/cricket|bat game|pet feeder|subscription|gift card|extended warranty|installation charge|safe locker|tyre|ecg|medical/i, "Other"],
  [/robot(ic)?\s+(vacuum|mop|cleaner)|robot vac|deebot|winbot|roborock|freo|window cleaning robot|self[- ]?empt|vacuum (&|and) mop/i, "Robot vacuums"],
  [/vacuum|spot cleaner|wet ?(and|&) ?dry|floor (washer|cleaner)|spin mop|steam cleaner|stick vac|mite remover/i, "Vacuums & floor care"],
  [/air ?fryer|airocook|multi-?cooker|water purifier|soup maker|mixer|grinder|blender|juicer|\bcooker\b|kettle|toaster|coffee|espresso|bean to cup|induction|cooktop|food processor|chopper|instant pot|onechef|cooking|kitchen|knife|cookware|\bpans?\b|frypan|kadai|kadhai|\bwok\b|salt (&|and) pepper|smart oven|marveloven/i, "Kitchen"],
  [/\btv\b|television|oled|qled|projector|soundbar|home theat/i, "TVs & projectors"],
  [/iphone|galaxy [szamf]\d|smartphone|\bpixel \d|\bphone\b|redmi note|oneplus \d|nord ce|motorola|\bmoto g|vivo |oppo |realme/i, "Phones"],
  [/airpods|earbuds|\bbuds\b|headphone|earphone|speaker|smart ?watch|apple watch|\bwatch\b|neckband|\btws\b|ray-?ban|oakley|smart (ai )?glasses|sunglass/i, "Audio & wearables"],
  [/macbook|ipad|laptop|tablet|galaxy tab|chromebook/i, "Laptops & tablets"],
  [/hair|blow brush|styler|epilator|\bipl\b|lumea|callus|skin|trimmer|shaver|toothbrush|massage|grooming|perfume|parfum|fragrance/i, "Personal care"],
  [/purifier|humidifier|dehumidifier|\bfan\b|air cooler|room heater|breeze/i, "Air purifiers & fans"],
  [/washing machine|washer|dryer|refrigerator|fridge|freezer|dishwasher|microwave|\boven\b|\bac\b|air condition|split inverter|water heater|geyser|chimney/i, "Large appliances"],
  [/camera|cctv|dome|\bnvr\b|\bdvr\b|\bpoe\b|router|mesh wi|door lock|smart (lock|plug|bulb|switch)|doorbell|alexa|echo dot/i, "Smart home & security"],
  [/\bcase\b|cover|strap|mouse|keyboard|\bkit\b|\bbag\b/i, "Accessories"],
];

/** Accessory words near the start of the name ("Ecovacs X1 dust bag", "iPhone 18 Pro Silicone Case"): checked first. */
const ACCESSORY_START = /accessor|dust bags?\b|mop(ping)? pads?|roller brush|side brush|filter (set|kit)|replacement|cleaning (liquid|solution)|spare|\bcase\b|screen (guard|protector)|glas\.?tr|tempered|charger|cable|adapter|memory card|microsd|webcam/i;

/** The sheets' coarse categories, used only when the name says nothing. */
const SHEET_HINTS: Array<[RegExp, Category]> = [
  [/kitchen/i, "Kitchen"],
  [/accessor/i, "Accessories"],
  [/electronic gadget/i, "Audio & wearables"],
  [/home improvement/i, "Vacuums & floor care"],
  [/large/i, "Large appliances"],
  [/phone/i, "Phones"],
  [/air purifier/i, "Air purifiers & fans"],
  [/perfume|glasses|cricket|sports|kids|toys|service|subscription|installation|bpcl/i, "Other"],
];

export type CategorySource = "admin" | "name" | "sheet" | "none";
export type CategoryPick = { category: Category; source: CategorySource };

export function categorise(name: string, sheetCategories: Array<string | null | undefined>, adminChoice?: string | null): CategoryPick {
  if (adminChoice && (CATEGORIES as readonly string[]).includes(adminChoice)) return { category: adminChoice as Category, source: "admin" };
  if (ACCESSORY_START.test(name.slice(0, 48))) return { category: "Accessories", source: "name" };
  for (const [re, c] of RULES) if (re.test(name)) return { category: c, source: "name" };
  for (const s of sheetCategories) {
    if (!s) continue;
    for (const [re, c] of SHEET_HINTS) if (re.test(s)) return { category: c, source: "sheet" };
  }
  return { category: "Other", source: "none" };
}
