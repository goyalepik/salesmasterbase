// One line a day for the top of the EPIK home. Short, warm, about doing good work together.

export type Quote = { text: string; by: string | null };

export const QUOTES: Quote[] = [
  { text: "Well done is better than well said.", by: "Benjamin Franklin" },
  { text: "Alone we can do so little; together we can do so much.", by: "Helen Keller" },
  { text: "Well begun is half done.", by: "Aristotle" },
  { text: "Every order is a promise. Let's keep every one.", by: null },
  { text: "Small things, done on time, build a big company.", by: null },
  { text: "Make someone's home a little better today.", by: null },
  { text: "Clear owners, clear dates, no surprises.", by: null },
];

/** The same quote all day (IST), a new one tomorrow. */
export function quoteOfTheDay(now: Date = new Date()): Quote {
  const day = Math.floor((now.getTime() + 5.5 * 60 * 60 * 1000) / 86_400_000);
  return QUOTES[day % QUOTES.length];
}
