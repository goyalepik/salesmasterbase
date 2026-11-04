// Turns a raw row of the "Completed Demos" sheet into a clean demo record.
// Everything here is pure, so it is tested on made-up rows; the real sheet never enters the repo.

export type RawRow = Record<string, string>;

export type Survey = { outcome: string | null; issue: string | null; age: string | null; decisionMaker: string | null; priceResponse: string | null };

export type Demo = {
  id: string;
  phone: string;
  demoDate: string; // YYYY-MM-DD, IST
  demoAt: string; // YYYY-MM-DD HH:MM, IST
  leadDate: string | null;
  type: "Physical" | "Virtual" | "Not set";
  status: string;
  source: string;
  sourceGroup: string;
  hub: string;
  city: string;
  state: string;
  brand: string;
  category: string;
  cd: string | null;
  rating: number | null;
  survey: Survey | null;
  /** When a deal closes the team writes the price ("INR59999") over the survey. */
  dealMinor: number | null;
  demoMinutes: number | null;
  callSeconds: number | null;
  ai: { hot: boolean | null; intent: string | null; sentiment: string | null; result: string | null };
  transcript: string;
  audioRecorded: boolean;
  /** Where the transcript came from: "Metabase", "Partner dashboard" or "None". */
  transcriptSource: string;
};

/** Statuses that mean the customer bought. NEGOTIATION_CLOSED matches real orders 36× more often than COMPLETED, so it counts as a sale. */
export const WON_STATUSES = new Set(["CONVERTED", "NEGOTIATION_CLOSED"]);

const SOURCE_GROUPS: [RegExp, string][] = [
  [/^(mobile-website|desktop-website|web|vyumi:website)$/i, "Website"],
  [/^(android|ios|app|vyumi:app)$/i, "App"],
  [/^(demo_enquiry|consultation|virtual-demo)$/i, "Demo request form"],
  [/^admin-panel$/i, "Added by team"],
  [/^firebase_seed$/i, "Imported leads"],
  [/^whatsapp$/i, "WhatsApp"],
  [/^spinwheel$/i, "Spin wheel"],
  [/(brand|ilife_|neesh|upliance|geek)/i, "Brand partner leads"],
];

export function sourceGroup(source: string): string {
  if (!source) return "Not set";
  for (const [re, label] of SOURCE_GROUPS) if (re.test(source)) return label;
  return "Other";
}

const CATEGORIES: [RegExp, string][] = [
  [/robot|vacuum and mop|deebot|winbot|window cleaning/i, "Robot vacuum"],
  [/glasses|ray-ban|oakley|meta wayfarer|meta skyler/i, "Smart glasses"],
  [/iphone|galaxy s|galaxy z|smartphone|pixel/i, "Phone"],
  [/macbook|ipad|imac|airpods|apple watch|watch/i, "Apple and wearables"],
  [/projector|xgimi|mogo|halo|horizon/i, "Projector"],
  [/vacuum|wet and dry|hair dryer|airwrap|straightener|supersonic/i, "Vacuum and hair care"],
  [/cook|coffee|fryer|blender|mixer|grinder|oven|kettle|juicer|espresso|kitchen|chopper|upliance/i, "Kitchen"],
  [/purifier|humidifier|fan|heater|air /i, "Air care"],
  [/massag|curapod|therapy|recovery|neck|eye care/i, "Wellness"],
  [/tv|television|soundbar|speaker|headphone|earbuds/i, "TV and audio"],
];

export function categoryOf(product: string): string {
  if (!product.trim()) return "Not set";
  for (const [re, label] of CATEGORIES) if (re.test(product)) return label;
  return "Other";
}

/** How each brand is written. Anything not listed is title-cased. */
const BRAND_NAMES: Record<string, string> = {
  IPHONE: "Apple", APPLE: "Apple", ILIFE: "iLife", XGIMI: "XGIMI", EDT: "EDT", LG: "LG", "DE'LONGHI": "De'Longhi", DELONGHI: "De'Longhi",
  "RAY-BAN": "Ray-Ban Meta", OAKLEY: "Oakley Meta", EZYLIFE: "EzyLife", AGARO: "AGARO",
};

export function brandOf(product: string): string {
  const first = product.trim().split(/\s+/)[0]?.toUpperCase().replace(/[^A-Z0-9'-]/g, "") ?? "";
  if (!first) return "Not set";
  return BRAND_NAMES[first] ?? first.charAt(0) + first.slice(1).toLowerCase();
}

function parseSurvey(raw: string): Survey | null {
  if (!raw.startsWith("{")) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const s = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : null);
    return { outcome: s("q1DemoOutcome"), issue: s("q2CustomerIssue"), age: s("q3ApproximateAgeGroup"), decisionMaker: s("q4DecisionMaker"), priceResponse: s("q5PriceResponseDuringDemo") };
  } catch {
    return null;
  }
}

/** "INR59999" → ₹59,999 in paise. "INR1" and silly amounts are placeholders, not prices. */
export function dealPrice(raw: string): number | null {
  const m = /^INR\s*([\d,]+)/i.exec(raw.trim());
  if (!m) return null;
  const rupees = Number(m[1].replace(/,/g, ""));
  return rupees >= 1000 && rupees <= 2_000_000 ? rupees * 100 : null;
}

/** The AI columns sometimes hold the list of allowed values instead of an answer ("low | medium | high"). Treat that as empty. */
function aiValue(v: string): string | null {
  const t = v.trim().toLowerCase();
  return !t || t.includes("|") || t === "unknown" ? null : t;
}

const minutesBetween = (a: string, b: string) => (new Date(`${b.replace(" ", "T")}:00+05:30`).getTime() - new Date(`${a.replace(" ", "T")}:00+05:30`).getTime()) / 60000;

const titleCase = (s: string) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function normaliseDemo(r: RawRow): Demo {
  const product = (r["Products"] ?? "").split(" | ")[0] ?? "";
  const type = (r["Demo Type"] ?? "").toLowerCase();
  const start = r["Start Time (IST)"] ?? "";
  const end = r["End Time (IST)"] ?? "";
  const mins = start && end ? minutesBetween(start, end) : NaN;
  const ratingRaw = (r["Customer Rating"] ?? "").trim();
  const rating = ratingRaw === "" ? null : Number(ratingRaw);
  const audio = Number(r["Audio Duration (sec)"]);
  const hot = (r["Hot Lead (AI)"] ?? "").toLowerCase();
  return {
    id: r["Booking ID"],
    phone: (r["Customer Phone"] ?? "").replace(/\D/g, "").slice(-10),
    demoDate: (r["Demo Date (IST)"] ?? "").slice(0, 10),
    demoAt: r["Demo Date (IST)"] ?? "",
    leadDate: r["Lead Created (IST)"] ? r["Lead Created (IST)"].slice(0, 10) : null,
    type: type === "physical" ? "Physical" : type === "virtual" ? "Virtual" : "Not set",
    status: (r["Status"] ?? "").toUpperCase(),
    source: r["Source"] ?? "",
    sourceGroup: sourceGroup(r["Source"] ?? ""),
    hub: r["Hub"] ? r["Hub"].replace("Kormangala", "Koramangala") : "Not set",
    city: r["City"] ? titleCase(r["City"]) : "Not set",
    state: r["State"] ? titleCase(r["State"]) : "Not set",
    brand: brandOf(product),
    category: categoryOf(product),
    cd: r["CD Name"]?.trim() || null,
    // 0 means the customer was never asked, not a zero-star review.
    rating: rating && rating >= 1 && rating <= 5 ? rating : null,
    survey: parseSurvey(r["CD Comments"] ?? ""),
    dealMinor: dealPrice(r["CD Comments"] ?? ""),
    demoMinutes: Number.isFinite(mins) && mins > 0 && mins < 8 * 60 ? mins : null,
    callSeconds: Number.isFinite(audio) && audio > 0 ? audio : null,
    ai: { hot: hot === "true" ? true : hot === "false" ? false : null, intent: aiValue(r["AI Intent"] ?? ""), sentiment: aiValue(r["AI Sentiment"] ?? ""), result: aiValue(r["AI Call Result"] ?? "") },
    audioRecorded: (r["Audio Recorded"] ?? "").toLowerCase() === "true",
    transcriptSource: /metabase/i.test(r["Transcript Source"] ?? "") ? "Metabase" : /partner/i.test(r["Transcript Source"] ?? "") ? "Partner dashboard" : "None",
    transcript: [r["Full Transcript"], r["Full Transcript (cont. 2)"], r["Full Transcript (cont. 3)"], r["Full Transcript (cont. 4)"]].filter(Boolean).join("\n"),
  };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export function speedBucket(lead: string | null, demo: string): string {
  if (!lead) return "Not known";
  const d = daysBetween(lead, demo);
  if (d < 0) return "Not known";
  if (d === 0) return "Same day";
  if (d === 1) return "Next day";
  if (d <= 3) return "2 to 3 days";
  if (d <= 7) return "4 to 7 days";
  if (d <= 14) return "8 to 14 days";
  return "15+ days";
}

export function demoLengthBucket(m: number | null): string {
  if (m == null) return "Not recorded";
  if (m < 15) return "Under 15 min";
  if (m < 30) return "15 to 30 min";
  if (m < 45) return "30 to 45 min";
  if (m < 60) return "45 to 60 min";
  if (m < 90) return "60 to 90 min";
  return "90+ min";
}

export function callLengthBucket(s: number | null): string {
  if (s == null) return "No recording";
  const m = s / 60;
  if (m < 2) return "Under 2 min";
  if (m < 5) return "2 to 5 min";
  if (m < 15) return "5 to 15 min";
  if (m < 30) return "15 to 30 min";
  if (m < 60) return "30 to 60 min";
  return "60+ min";
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function hourOf(demoAt: string): number | null {
  const h = Number(demoAt.slice(11, 13));
  return Number.isFinite(h) && demoAt.length >= 13 ? h : null;
}

export function hourBucket(h: number | null): string {
  if (h == null) return "Not set";
  if (h < 11) return "Before 11 am";
  if (h < 13) return "11 am to 1 pm";
  if (h < 15) return "1 to 3 pm";
  if (h < 17) return "3 to 5 pm";
  if (h < 19) return "5 to 7 pm";
  return "After 7 pm";
}
