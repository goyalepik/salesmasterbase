import { MemoryCxRepository, type CxSnapshot } from "../adapters/mock/memory-repo";
import { assign, hold, ingest, logOutboundCall, reply, resolve, startWork, takeOwnership, type Actor } from "../../domain/service";
import type { Channel, Demo, Order } from "../../domain/types";

// A synthetic week of EPIK support, so the console looks real without any customer data.
// Phones are fake (+9190000xxxxx). Messages are written to look like the real export, not copied from it.

const MESSAGES: Array<{ text: string; channel?: Channel }> = [
  { text: "Hi, I want to book a free home demo of Dreame L50 this Saturday" },
  { text: "Demo specialist is late, still not here, it's been 1 hour" },
  { text: "Nobody came for my demo, waited all day. Very disappointed" },
  { text: "Can I reschedule my demo to tomorrow evening?" },
  { text: "Liked the demo, I want to buy the Ecovacs X2 Omni" },
  { text: "What is the price of Narwal Freo X Ultra?" },
  { text: "Difference between Dreame X50 and Roborock S8?" },
  { text: "Is no cost EMI available on iPhone 16?" },
  { text: "Is the Samsung 55 inch TV in stock in Bangalore?" },
  { text: "Please share the payment link for my order" },
  { text: "Epson L8050 order confirm koriye. Payment COD. pin 743370" },
  { text: "I want to place an order for Philips air fryer, pin 560034, COD possible?" },
  { text: "Where is my order PIK4123? kab aayega" },
  { text: "Please cancel my order PIK4188" },
  { text: "paisa kat gaya but order nahi aaya. PIK4210" },
  { text: "Amount deducted twice for PIK4231, please check" },
  { text: "Need GST invoice for PIK4105" },
  { text: "Refund not received for PIK4019, it's been 10 days" },
  { text: "My EMI got rejected for PIK4240, what to do" },
  { text: "Delivery delayed, still waiting for PIK4170" },
  { text: "Please change delivery address for PIK4199" },
  { text: "The robot vacuum arrived damaged, box was crushed. PIK4152" },
  { text: "Need installation for my new Samsung TV PIK4160" },
  { text: "Order marked delivered but not received PIK4141" },
  { text: "How to set up the mopping schedule on Dreame app?" },
  { text: "My Ecovacs stopped working, error code 102" },
  { text: "Warranty claim for Dyson V12, battery issue" },
  { text: "I want to return the air purifier, not happy with it" },
  { text: "You sent the wrong product, I ordered black not white. PIK4177" },
  { text: "Cannot login, OTP not coming" },
  { text: "WORST service ever!!! nobody replies, very pathetic" },
  { text: "I will post this on Instagram if not resolved today" },
  { text: "This is fraud, I will go to consumer forum" },
  { text: "The appliance sparked and caught fire, please help urgently" },
  { text: "What are your store timings on Sunday?" },
  { text: "agent agent talk to human" },
  { text: "Thanks for the great service, the demo guy was very helpful" },
  { text: "hi" },
  { text: "Hello" },
  { text: "Applying for video editor role, attaching my CV" },
  { text: "We are an influencer agency, interested in collab" },
  { text: "Interested" },
  { text: "Bulk order for 20 units for our office, need GST invoice" },
  { text: "Kya aap Kolkata mein deliver karte ho?" },
];

const PRODUCTS = ["Dreame L50 Ultra", "Ecovacs X2 Omni", "Narwal Freo X Ultra", "iPhone 16 128GB", "Samsung 55\" Crystal 4K", "Epson L8050", "Philips Air Fryer XL", "Dyson V12"];
const NAMES = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vikram", "Isha", "Arjun", "Sana", "Nikhil", "Priya", "Farhan", "Neha", "Rahul", "Tara"];
const CHANNELS: Channel[] = ["whatsapp", "whatsapp", "whatsapp", "whatsapp", "whatsapp", "whatsapp", "instagram", "facebook", "email", "web_chat", "call"];

/** A small seeded random number generator, so the seed is the same on every load. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function buildSyntheticSeed(now: Date): Promise<CxSnapshot> {
  const repo = new MemoryCxRepository();
  const rand = rng(4905);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const people = Array.from({ length: 34 }, (_, i) => ({ phone: `+9190000${String(10000 + i * 37).slice(-5)}`, name: `${pick(NAMES)} (sample)` }));
  const l1: Actor = { id: "khadija", role: "l1" };
  const snap = () => repo.snapshot();

  // Orders and demos for the Customer 360 timelines.
  const orders: Order[] = [];
  const demos: Demo[] = [];
  people.forEach((p, i) => {
    if (i % 2 === 0) orders.push({ ref: `PIK${4100 + i * 3}`, customerUid: p.phone, at: new Date(now.getTime() - (5 + i) * 86_400_000).toISOString(), product: pick(PRODUCTS), amountRupees: Math.round(8000 + rand() * 90000), payment: pick(["cod", "prepaid", "emi"] as const), status: pick(["placed", "paid", "delivered", "delivered", "unpaid"] as const) });
    if (i % 3 === 0) demos.push({ id: `D${i}`, customerUid: p.phone, at: new Date(now.getTime() - (2 + i) * 86_400_000).toISOString(), product: pick(PRODUCTS), status: pick(["booked", "completed", "completed", "missed"] as const) });
  });

  // About 90 messages spread over the last 9 days, the newest few still fresh.
  const total = 90;
  for (let i = 0; i < total; i++) {
    const m = MESSAGES[i % MESSAGES.length];
    const person = people[Math.floor(rand() * people.length)];
    const ageMin = Math.round(((total - i) / total) * 9 * 24 * 60 * (0.6 + rand() * 0.4));
    const at = new Date(now.getTime() - ageMin * 60_000);
    const channel = m.channel ?? pick(CHANNELS);
    const social = channel === "instagram" || channel === "facebook";
    const noPhone = social && rand() < 0.5;
    const result = await ingest(repo, { channel, text: m.text, phone: noPhone ? undefined : person.phone, name: person.name, handle: social ? `@${person.name.split(" ")[0].toLowerCase()}${i}` : undefined }, at);
    const t = result.ticket;
    if (t.status === "closed" || result.reopened || result.mergedIntoCallback) continue;
    // Older tickets have been worked on: assigned, some on hold, many closed.
    const age = now.getTime() - at.getTime();
    const step = (m2: number) => new Date(Math.min(at.getTime() + m2 * 60_000, now.getTime() - 60_000));
    if (age > 30 * 60_000) {
      await takeOwnership(repo, t.id, l1, step(3));
      await reply(repo, t.id, "Thanks for reaching out, checking this for you.", l1, step(4));
      const queueId = t.queueId;
      if (!["others", "callbacks", "cx_lead"].includes(queueId) && rand() < 0.8) await assign(repo, t.id, queueId, l1, step(12));
      // Most older work is finished; what stays open is mostly from today, so SLA states are a realistic mix.
      const closeChance = age > 24 * 3_600_000 ? 1 : age > 6 * 3_600_000 ? 0.7 : age > 3 * 3_600_000 ? 0.45 : 0;
      if (age > 6 * 3_600_000 && rand() < 0.06) await hold(repo, t.id, pick(["brand", "customer", "internal"] as const), l1, step(40));
      else if (rand() < closeChance) {
        const owner: Actor = { id: snap().tickets.find((x) => x.id === t.id)?.ownerId ?? "khadija", role: "l2" };
        await startWork(repo, t.id, owner, step(30));
        await resolve(repo, t.id, { comment: "Done and confirmed with the customer.", closeReason: t.type === "informative" ? "Information given" : "Action done", resolutionType: t.type }, owner, step(30 + Math.round(rand() * 600)));
      }
    }
  }

  // Missed calls: one caller tried three times, two others once each.
  for (const [n, phone, startMin] of [[3, people[1].phone, 70], [1, people[5].phone, 22], [1, people[9].phone, 6]] as const) {
    for (let k = 0; k < n; k++) await ingest(repo, { channel: "missed_call", phone }, new Date(now.getTime() - (startMin - k * 25) * 60_000));
  }
  const cb = snap().tickets.find((t) => t.customerUid === people[5].phone && t.scenarioId === "K1");
  if (cb) await logOutboundCall(repo, cb.id, "not_connected", l1, new Date(now.getTime() - 20 * 60_000));

  const data = snap();
  // Satisfaction for a few customers, so the 360 label has something to read.
  const customers = data.customers.map((c, i) => (i % 4 === 0 ? { ...c, csat: 2 + (i % 4) } : c));
  return { ...data, customers, orders, demos };
}
