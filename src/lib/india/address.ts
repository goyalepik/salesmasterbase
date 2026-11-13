// Indian addresses: the state and city from a delivery address and pincode. Pure (no network), so it works in
// tests, the Slack handler and the Shopify push alike.
//
// Why it matters: Shopify works out GST from the shipping state. With no state it charged only CGST 9% on EPIK's
// orders instead of CGST + SGST (Karnataka) or IGST (other states). State codes are the ones this store's own
// Shopify orders use (TS for Telangana, CG for Chhattisgarh, OR for Odisha, UK for Uttarakhand).

export type IndianState = { code: string; name: string };

const S: Record<string, string> = {
  AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CH: "Chandigarh",
  CG: "Chhattisgarh", DL: "Delhi", GA: "Goa", GJ: "Gujarat", HP: "Himachal Pradesh", HR: "Haryana", JH: "Jharkhand",
  JK: "Jammu and Kashmir", KA: "Karnataka", KL: "Kerala", MH: "Maharashtra", ML: "Meghalaya", MN: "Manipur", MP: "Madhya Pradesh",
  MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", PB: "Punjab", PY: "Puducherry", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu",
  TR: "Tripura", TS: "Telangana", UK: "Uttarakhand", UP: "Uttar Pradesh", WB: "West Bengal",
};

/** Every state and union territory, A to Z, for the State list on the sale forms. */
export const STATE_NAMES: readonly string[] = Object.values(S).sort((a, b) => a.localeCompare(b));

/** The state named exactly (from the form's State list), or null. */
export function stateByName(name: string | null | undefined): IndianState | null {
  const wanted = (name ?? "").trim().toLowerCase();
  const hit = Object.entries(S).find(([, n]) => n.toLowerCase() === wanted);
  return hit ? { code: hit[0], name: hit[1] } : null;
}

/** The address the sale forms save: what the CDE typed, then the City and State they entered. */
export function joinAddress(street: string, city: string, state: string): string {
  return [street, city, state].map((p) => p.replace(/\s+/g, " ").trim().replace(/,+$/, "")).filter(Boolean).join(", ");
}

/** [first pincode digits (longest wins), state code]. India Post's postal circles. */
const PIN_STATE: Array<[string, string]> = [
  ["110", "DL"],
  ["12", "HR"], ["13", "HR"],
  ["14", "PB"], ["15", "PB"], ["160", "CH"], ["16", "PB"],
  ["17", "HP"],
  ["18", "JK"], ["19", "JK"],
  ["2", "UP"], ["246", "UK"], ["248", "UK"], ["249", "UK"], ["263", "UK"], ["2476", "UK"], ["2625", "UK"], ["2626", "UK"],
  ["30", "RJ"], ["31", "RJ"], ["32", "RJ"], ["33", "RJ"], ["34", "RJ"],
  ["36", "GJ"], ["37", "GJ"], ["38", "GJ"], ["39", "GJ"],
  ["40", "MH"], ["403", "GA"], ["41", "MH"], ["42", "MH"], ["43", "MH"], ["44", "MH"],
  ["45", "MP"], ["46", "MP"], ["47", "MP"], ["48", "MP"], ["49", "CG"],
  ["50", "TS"], ["51", "AP"], ["52", "AP"], ["53", "AP"],
  ["56", "KA"], ["57", "KA"], ["58", "KA"], ["59", "KA"],
  ["60", "TN"], ["6050", "PY"], ["6051", "PY"], ["61", "TN"], ["62", "TN"], ["63", "TN"], ["64", "TN"],
  ["67", "KL"], ["68", "KL"], ["69", "KL"],
  ["70", "WB"], ["71", "WB"], ["72", "WB"], ["73", "WB"], ["737", "SK"], ["74", "WB"], ["744", "AN"],
  ["75", "OR"], ["76", "OR"], ["77", "OR"],
  ["78", "AS"], ["790", "AR"], ["791", "AR"], ["792", "AR"], ["793", "ML"], ["794", "ML"], ["795", "MN"], ["796", "MZ"], ["797", "NL"], ["798", "NL"], ["799", "TR"],
  ["80", "BR"], ["81", "BR"], ["814", "JH"], ["815", "JH"], ["816", "JH"], ["82", "JH"], ["83", "JH"], ["836", "BR"], ["84", "BR"], ["85", "BR"],
];

/** A valid Indian pincode (6 digits, not starting with 0), from the pincode box or the address text. */
export function findPincode(pincode: string | null | undefined, address?: string | null): string | null {
  const own = (pincode ?? "").replace(/\s/g, "");
  if (/^[1-9]\d{5}$/.test(own)) return own;
  const inText = /(?:^|\D)([1-9]\d{2}\s?\d{3})(?!\d)/.exec(address ?? "")?.[1]?.replace(/\s/g, "");
  return inText ?? null;
}

export function stateForPincode(pincode: string | null | undefined): IndianState | null {
  const pin = findPincode(pincode);
  if (!pin) return null;
  let best: [string, string] | null = null;
  for (const entry of PIN_STATE) if (pin.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  return best ? { code: best[1], name: S[best[1]] } : null;
}

const STATE_WORDS = new RegExp(`^(${[...Object.values(S), ...Object.keys(S), "India", "Bangalore Urban", "Bengaluru Urban", "New Delhi"].map((s) => s.replace(/ /g, "\\s+")).join("|")})$`, "i");

/** A state named in the address text ("…, Karnataka" or "…, KA 560038"), when the pincode can't say. */
export function stateFromText(address: string | null | undefined): IndianState | null {
  const text = address ?? "";
  // A city settles it ("Delhi Public School Rd, Bengaluru" is Karnataka).
  const city = cityFor(text, null);
  if (city && CITY_STATE[city]) return { code: CITY_STATE[city], name: S[CITY_STATE[city]] };
  for (const [code, name] of Object.entries(S)) if (new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i").test(text)) return { code, name };
  return null;
}

/** Cities named in addresses, written the way the team writes them. */
const CITY_WORDS: Array<[RegExp, string]> = [
  [/bengaluru|bangalore|\bblr\b/i, "Bengaluru"],
  [/gurugram|gurgaon/i, "Gurugram"],
  [/greater noida/i, "Greater Noida"],
  [/noida/i, "Noida"],
  [/ghaziabad/i, "Ghaziabad"],
  [/faridabad/i, "Faridabad"],
  [/new delhi|\bdelhi\b/i, "Delhi"],
  [/navi mumbai/i, "Navi Mumbai"],
  [/\bthane\b/i, "Thane"],
  [/mumbai|bombay/i, "Mumbai"],
  [/hyderabad|secunderabad/i, "Hyderabad"],
  [/chennai|madras/i, "Chennai"],
  [/\bpune\b/i, "Pune"],
  [/kolkata|calcutta/i, "Kolkata"],
  [/mysuru|mysore/i, "Mysuru"],
  [/mangaluru|mangalore/i, "Mangaluru"],
  [/hubballi|hubli/i, "Hubballi"],
  [/ahmedabad/i, "Ahmedabad"],
  [/\bsurat\b/i, "Surat"],
  [/\bjaipur\b/i, "Jaipur"],
  [/lucknow/i, "Lucknow"],
  [/chandigarh/i, "Chandigarh"],
  [/\bkochi\b|cochin|ernakulam/i, "Kochi"],
  [/coimbatore/i, "Coimbatore"],
];

/** The state each named city is in, so a street called "Delhi Public School Rd" in a Bengaluru pincode stays Bengaluru. */
const CITY_STATE: Record<string, string> = { Bengaluru: "KA", Mysuru: "KA", Mangaluru: "KA", Hubballi: "KA", Gurugram: "HR", Faridabad: "HR", Noida: "UP", "Greater Noida": "UP", Ghaziabad: "UP", Delhi: "DL", Mumbai: "MH", Thane: "MH", "Navi Mumbai": "MH", Pune: "MH", Hyderabad: "TS", Chennai: "TN", Coimbatore: "TN", Kolkata: "WB", Ahmedabad: "GJ", Surat: "GJ", Jaipur: "RJ", Lucknow: "UP", Chandigarh: "CH", Kochi: "KL" };

/** Big cities by the first pincode digits (longest wins). Used only when the address text names no city. */
const PIN_CITY: Array<[string, string]> = [
  ["560", "Bengaluru"], ["5621", "Bengaluru"], ["5620", "Bengaluru"],
  ["110", "Delhi"], ["122", "Gurugram"], ["121", "Faridabad"], ["2013", "Noida"], ["2010", "Ghaziabad"],
  ["400", "Mumbai"], ["4006", "Thane"], ["4007", "Navi Mumbai"], ["411", "Pune"],
  ["500", "Hyderabad"], ["600", "Chennai"], ["700", "Kolkata"],
  ["570", "Mysuru"], ["575", "Mangaluru"], ["380", "Ahmedabad"], ["395", "Surat"], ["302", "Jaipur"], ["226", "Lucknow"],
  ["160", "Chandigarh"], ["682", "Kochi"], ["641", "Coimbatore"], ["452", "Indore"], ["462", "Bhopal"], ["751", "Bhubaneswar"],
  ["781", "Guwahati"], ["800", "Patna"], ["834", "Ranchi"], ["248", "Dehradun"], ["530", "Visakhapatnam"], ["695", "Thiruvananthapuram"],
];

/** The customer's city from the delivery address, then the pincode. Never the seller's hub. Null when unknown. */
export function cityFor(address: string | null | undefined, pincode?: string | null): string | null {
  const text = address ?? "";
  const pin = findPincode(pincode, text);
  const pinState = pin ? stateForPincode(pin)?.code ?? null : null;
  for (const [test, city] of CITY_WORDS) if (test.test(text) && (!pinState || CITY_STATE[city] === pinState)) return city;
  if (pin) {
    let best: [string, string] | null = null;
    for (const entry of PIN_CITY) if (pin.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
    if (best) return best[1];
  }
  // Otherwise the last part of the address that is a place name: not a number, a state or the country.
  const parts = text.split(/[,\n]/).map((p) => p.replace(/\b\d{6}\b/g, "").trim()).filter((p) => p && !/\d{2,}/.test(p) && !STATE_WORDS.test(p));
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  return last && last.length <= 30 ? last.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** Everything Shopify needs to place the address: city, state and pincode, each null when unknown. */
export function placeFor(address: string | null | undefined, pincode: string | null | undefined): { street: string; city: string | null; state: IndianState | null; zip: string | null } {
  const text = (address ?? "").trim();
  const zip = findPincode(pincode, text);
  // Sales made with the City and State boxes end "…, City, State": what the CDE typed wins over any guess.
  const parts = text.split(",").map((p) => p.trim());
  const typedState = parts.length >= 3 ? stateByName(parts[parts.length - 1]) : null;
  if (typedState) {
    const city = parts[parts.length - 2];
    return { street: parts.slice(0, -2).join(", "), city: city || null, state: typedState, zip };
  }
  return { street: text, city: cityFor(text, zip), state: stateForPincode(zip) ?? stateFromText(text), zip };
}
