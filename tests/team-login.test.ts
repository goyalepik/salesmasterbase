import assert from "node:assert/strict";
import { test } from "node:test";
import { accessGate } from "../src/lib/access";
import { personalCode, personFromCookie, sameCode, sessionCookieValue, spacesFor } from "../src/lib/team-login";

const MASTER = "main-code-123456";

test("personal codes: 8 easy characters, stable, different per person and per main code", () => {
  const code = personalCode(MASTER, "U04PIYUSH");
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(personalCode(MASTER, "U04PIYUSH"), code);
  assert.notEqual(personalCode(MASTER, "U04RITIKA"), code);
  assert.notEqual(personalCode("another-main-code", "U04PIYUSH"), code, "changing the main code changes every personal code");
  assert.ok(sameCode(code.toLowerCase().replace("-", " "), code), "case, spaces and dashes do not matter");
  assert.ok(!sameCode("ABCD-EFGH", code));
});

test("sessions: a signed cookie names the person; a forged one is refused", () => {
  const cookie = sessionCookieValue(MASTER, "U04PIYUSH");
  assert.equal(personFromCookie(MASTER, cookie), "U04PIYUSH");
  assert.equal(personFromCookie(MASTER, cookie.replace("U04PIYUSH", "U04ADMIN1")), null);
  assert.equal(personFromCookie("other-main-code", cookie), null);
  assert.equal(personFromCookie(MASTER, undefined), null);
});

test("the gate lets a personal sign-in through in live mode", () => {
  const base = { mode: "live", pathname: "/inventory", accessCode: MASTER, cookie: undefined };
  assert.equal(accessGate(base), "challenge");
  assert.equal(accessGate({ ...base, personCookie: sessionCookieValue(MASTER, "U04PIYUSH") }), "allow");
  assert.equal(accessGate({ ...base, personCookie: "U04PIYUSH.forged" }), "challenge");
});

test("areas follow roles; admin sees everything", () => {
  assert.deepEqual(spacesFor(["inventory"]), ["command", "inventory"]);
  assert.deepEqual(spacesFor(["revops", "sales"]).sort(), ["command", "payments", "sales"]);
  assert.deepEqual(spacesFor(["logistics"]), ["command", "delivery"]);
  assert.equal(spacesFor(["admin"]).length, 5);
});
