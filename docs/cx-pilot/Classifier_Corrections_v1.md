# Classifier corrections v1 (for Claude Code)

**Status:** tested on 3 Nov 2026. The patches were run in a sandbox copy of the live build's own classifier, in the browser only. Nothing was changed on the website or in Sagepilot.

**Results:**
- **92 test messages:** the current build gets 47 right; with these patches it gets 92 right.
- **199 live Sagepilot tickets:** 34 change category. "Unclear" drops from 25 to 11, and "needs review" drops from 28 to 11.
- **Caveat:** I wrote the test messages myself, so they will flatter the patches. Before go-live, also check accuracy on the 745-row gold set (`gold_set_to_label.csv`) after it has been labelled. The target is ≥ 90%.

Implement this in `rules.json`, `scenarios.json` and the classify function. Then add every row of the test table at the end as a unit test.

## 1. Agreed decisions
- **Ticket ID:** use the Sagepilot ticket number as the ticket ID, e.g. `#19012`. Drop `CX-10001+`. A website-only ticket (simulator or missed call) gets the prefix `W-` plus a running number.
- **Priorities:** B1 Book a demo = **P0**, D1 Wants to place an order = **P0**, B12 Wants to buy after demo = **P0**.
- **Priority adjustments stay as they are:**
  - 2 missed calls → P1; 3 or more → P0.
  - The 3rd contact on the same issue moves the ticket up one step.
  - An upset customer moves the label up one step.
  - VIP halves the SLA times.
- **New rule:** if a complaint is detected anywhere in the message, the ticket is at least P1 and marked upset.

## 2. New categories
Use the spec IDs. The IDs below are placeholders.

| Placeholder | Name | Type | Priority | Queue | AI can answer (L0) |
|---|---|---|---|---|---|
| J4 | Policy question (refund / return / exchange / warranty policy) | informative | P3 | after_sales | yes |
| J5 | Callback request ("call me", "direct call facility") | actionable | P1 | callbacks | no |
| C9 | Serviceability (do you deliver / demo / service in my city or pincode?) | informative | P2 | sales | yes |
| H3 | Rewards or referral points | actionable | P2 | tech | no |
| X5 | Not interested / stop / unsubscribe (also flag do-not-contact) | informative | P3 | marketing | yes, excluded from CX metrics |
| X6 | Auto-reply from another business's bot | informative | P3 | others | yes, excluded |
| X7 | Instagram story mention or tag | informative | P3 | marketing | yes, excluded |

**Changes to existing categories:**
- X1 becomes "Greeting or acknowledgement" (hi, ok, yes, thanks).
- X4 (ad lead) is used only for "interested", or for the ad opener with nothing after it.
- G3 becomes "Wrong or missing item".

## 3. Word clean-up (normalise list, add)

| Customer writes | Treat as |
|---|---|
| want buy, wana buy | want to buy |
| deliver karte ho, deliver karoge, delivery milegi/hogi, deliver hota hai | do you deliver |
| kist, kisht, monthly payment, installment | emi |
| order nahi ho raha/rha/hua, order not going through, unable to place order | cant place order |
| case on delivery, cash on deliver, cash and delivery | cash on delivery |
| sho room, show room | showroom |
| were is, wher is | where is |
| refnd, refound, rifund, refand | refund |
| recieved, recived, recevied | received |
| offer hai, offer h, offers hi | offers |

**Ad opener variants:** treat these the same as "Hi! I'd like to know more":
- "Hello! Can I get more info on this?"
- "Hi, I want to know more (about this)"
- "I'm interested in this"

## 4. Rule changes (regex, matched on the cleaned lowercase text)

**Hard rules**
- `safety`: add a guard in front: `^(?!.*\b(fire ?(tv|stick)|firestick|fire hd|smoke[- ]?(free|less)|smokeless|no smoke|price (is )?(a )?shock|shock(ing)? price)\b)`
- `refund`:
  - add the negations `(don'?t|do not|no|not) (want|need|asking for|looking for) (a |any )?refund|no refund` to the exclusion list;
  - match `\brefund(ed|s|ing)?\b` so that "not refunded" is caught.
- `damaged` (damaged on arrival): exclude it when the product was used first: `(after|since|within) (\d+|a|one|two|few) (days?|weeks?|months?|years?)`, `been using`, `of use`, `after using`.
- `wrong_product`: add `missing (item|part|product|accessory)`, `(is|are|was|were) missing`, `empty box`, `box was empty`.
- **New** `auto_reply` → X6: `thank(s| you) for (contacting|reaching out to|messaging|writing to) …`, `greetings from`, `this is an auto(mated)? (message|reply)`, `we will get back to you shortly`, `our (team|executive) will (contact|get back)`.
- **New** `story_mention` → X7: `instagram story mention`, `mentioned @?getepik`.

**Scenario rules**
- **B1 (any demo mention):** `^(?!.*\b(no|don'?t (want|need)|without) (a )?demo\b).*\b(demo|demonstration|demo request)\b`
- **B12:** only after a demo has happened: `\b(after|liked|loved|saw|had|attended) (the |my )?demo\b.*\b(buy|order|purchase)\b`
- **D1:**
  - exclude `(pre|post|after)[- ]?purchase` and `mistake to (buy|purchase)`;
  - match `place order`, `confirm order`, `cant place order`, `want(ed) to order/buy/purchase`, `like to buy`, `ready to buy`, `interested in buying/purchasing`, `buy this/it/now/one`, `book order`.
- **D4 cancel order:** not when the message mentions a demo.
- **D6 payment link:** not when the message mentions a demo. Add `link please/pls/bhejo` and `where is the link`.
- **D2 order status:** add `consignment`, `shipment status`, `awb`, `dispatch(ed)`.
- **E1 delivery date:** add `when is/will my order (be/getting) deliver(ed)`, `getting delivered`, `when will I get/receive it`.
- **E2 delivery delayed:** not when the message says `too late` or mentions a demo.
- **E4 address:** allow "my" (`update my address`).
- **G1 return:** not when it says `return/refund/exchange policy` or `return the favour`.
- **G2 replacement:** not when it says `exchange offer(s)/value/bonus/price`, `old phone/device`, or `upgrade` (these are pre-sales offers and go to C2).
- **F2 not working:** add `cracked`, `not cleaning`, `not turning on`, `not starting`, `not connecting`.
- **I1 complaint:** add `big mistake`, `after sell/sales support`, `no one picks up`, `not picking`, `fas gai/gaya`, `bekar`, `dhokha`.
- **C2 price/offer:** add plurals `discounts`, `offers`, `deals`, plus `exchange offer/value` and `down payment`.
- **J3 feedback:** exclude sarcasm `thanks for the delay/nothing/wasting`.
- **X1:** add `ok`, `okay`, `yes`, `yas`, `yeah`, `thanks`, `thank you` when they are the whole message.
- **X4:** only `interested` / `i am interested` when that is the whole message.
- **New:**
  - **X5:** `^(stop|unsubscribe|not interested|no thanks|don'?t (message|call|text) me)`
  - **J4:** `(refund|return|replacement|exchange|cancellation|warranty) polic(y|ies)`. Put it before G1.
  - **C9:** `do you deliver/ship/provide/service`, `deliver(y) in/to/at <place>`, `service in/available in`, `serviceable`, `in my city/area`, `pincode <6 digits>`
  - **H3:** `referral`, `reward points`, `my points`, `loyalty points`
  - **J5:** `call me`, `callback`, `call back`, `direct call`, `call facility`, `contact number`, `customer care number`
- **Sentiment, add to the angry list:** `thanks for the delay`, `thanks for nothing`, `not picking`, `no one picks`, `rude`.

## 5. Code changes (not just config)

1. **Pick the right primary category when several match.** This step comes before the "most urgent wins" rule.
   - **Specific demo beats general demo:** B2/B3/B9/B10/B12 win over B1.
   - **Demo beats buying/price/link:** any demo category wins over D1/C1/C2/C4/D6/E2. The customer wants the demo first. Don't send it to review.
   - **A complaint is a mood, not the category:** if I1 matches together with an operational category, the operational one is primary. Keep I1 as secondary, mark the ticket upset, and make it at least P1.
   - When one of these rules decides, confidence is at least 80% and the ticket is **not** sent to "Others / needs review".
2. **Only strip AI sentences from messages the AI wrote.** Use the Sagepilot message author (`pilot/*`), never a sentence prefix. Today "Agent said the refund will come in 5 days. Still nothing." loses the customer's own words and ends up Unclear.
3. **Detect the ad opener variants** listed in section 3.
4. **Do not auto-close L0 tickets in Sagepilot mode.** Mark a ticket "AI answered" only if Sagepilot shows an AI reply after the customer's last message. Otherwise keep it open at L1.
5. **Owner follows the queue.** The owner is the queue's owner, not always Khadija. The triage design is to be confirmed by the business.

## 6. Regression tests (all must pass)

| Message | Expected |
|---|---|
| Fire TV stick price? | C2 Price, L0 |
| Is the air fryer smoke free? | not Safety |
| The price is a shock | C2 Price |
| The appliance sparked and caught fire | I4 Safety, L3 |
| There is smoke coming from the charger | I4 Safety, L3 |
| Is this a scam? | not L3 |
| Your company is a scam | I2 Legal/fraud, L3 |
| I don't want a refund, I want a replacement | G2 Replacement |
| Money not refunded yet for PIK4019 | D9 Refund |
| refnd not recieved | D9 Refund |
| What is your refund policy? / return policy? | J4 Policy, L0 |
| I want to return this air purifier | G1 Return |
| Screen cracked after 2 months of use | F2 Not working |
| The robot vacuum arrived damaged, box was crushed | E5 Damaged on arrival |
| The TV was not damaged but the remote is missing | G3 Wrong/missing item |
| Delivered but the box was empty | G3 |
| cancel my demo | B3 Cancel demo |
| Please cancel my order PIK4188 | D4 Cancel order |
| Can you send me the link for demo booking? | B1 Book demo |
| Is it too late to book a demo for 8pm? | B1 |
| ok / Yes | X1 Acknowledgement, L0 |
| stop / Not interested | X5 |
| interested | X4 Ad lead |
| Agent said the refund will come in 5 days. Still nothing. | D9 Refund |
| Thanks for the delay, worst service | E2 Delay, upset, P1 |
| Kya aap Kolkata mein deliver karte ho? | C9 Serviceability |
| Hello! Can I get more info on this? | X4 Ad lead |
| Worst after sell support … service request. My big mistake to purchase Philips | F4 Service visit (complaint, upset, P1), not Place order |
| Request for pre purchase home demo D3 Ultra | B1 |
| I like to see demo then i will buy it | B1 |
| Exchange offer h abhi koi | C2 Offer |
| Demo of N 50 pro ecovacs [address] | B1 |
| When my order is getting delivered? … consignment status | E1 or D2 |
| Coi offers hi ke ni | C2 |
| Thank you for contacting JS! Please let us know how we can help you. | X6 Auto-reply |
| [Instagram story mention] … | X7 |
| Demo ₹50000 to 1 lac / Robot demo 20,000 | B1 |
| Wanted to buy nutricook rice cooker / Yes I want buy iphone | D1 |
| Its aa have case on delivery | D7 COD (ask for pincode) |
| Where is my referral 1000 points | H3 |
| Link please Where is link | D6 |
| Unable to hear you, is there a direct call facility | J5 Callback |
| Were is your sho room in Hyderabad | J1 Store |
| Do u people have service in Ongole, pincode 523001 | C9 |
| Please update my address | E4 |
| Mujhe kist par iphone lena hai | C4 EMI |
| Epson L8050 order confirm koriye. Payment COD. pin 743370 | D1, P0, warning "outside COD zone, prepaid/EMI only" |
| *Must stay correct:* price, EMI, stock, store hours, thanks, hi, where is my order, delivery date, buy iPhone, demo request (English and Hinglish), demo no-show, demo late, reschedule demo, liked demo → buy, payment deducted, double charge, GST invoice, EMI rejected, wrong colour, OTP, angry complaint, public post threat, consumer forum, talk to human, job application, influencer, bulk order, error code, warranty, installation, ad opener only, public "Rubbish product" | unchanged |
