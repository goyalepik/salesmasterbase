import assert from "node:assert/strict";
import { test } from "node:test";
import { cityFor, joinAddress, placeFor, stateForPincode } from "../src/lib/india/address";

test("the state comes from the pincode, with this store's Shopify codes", () => {
  const code = (pin: string) => stateForPincode(pin)?.code;
  assert.equal(code("110042"), "DL");
  assert.equal(code("560038"), "KA");
  assert.equal(code("562125"), "KA");
  assert.equal(code("122002"), "HR");
  assert.equal(code("201301"), "UP");
  assert.equal(code("400050"), "MH");
  assert.equal(code("403601"), "GA");
  assert.equal(code("500034"), "TS");
  assert.equal(code("530017"), "AP");
  assert.equal(code("600040"), "TN");
  assert.equal(code("682016"), "KL");
  assert.equal(code("700091"), "WB");
  assert.equal(code("248001"), "UK");
  assert.equal(code("492001"), "CG");
  assert.equal(code("751001"), "OR");
  assert.equal(code("834001"), "JH");
  assert.equal(code("800001"), "BR");
  assert.equal(code("160017"), "CH");
  assert.equal(code("12345"), undefined, "five digits is not a pincode");
  assert.equal(code("012345"), undefined);
});

test("city and state for Shopify, from the address and pincode", () => {
  assert.deepEqual(placeFor("Sector 29, Rohini", "110042"), { street: "Sector 29, Rohini", city: "Delhi", state: { code: "DL", name: "Delhi" }, zip: "110042" });
  assert.equal(placeFor("Flat 4, Sector 54, Gurgaon, Haryana", null).state?.code, "HR");
  assert.equal(placeFor("No pin box, Sarjapur Road, Bengaluru 562125", null).zip, "562125");
  // A street named after another city does not move the customer.
  assert.equal(cityFor("Delhi Public School Rd, Electronic City", "560100"), "Bengaluru");
  assert.equal(cityFor("Some lane, Kolhapur", "416001"), "Kolhapur");
  assert.deepEqual(placeFor("", null), { street: "", city: null, state: null, zip: null });
});

test("the City and State typed on the form are what Shopify gets, never a guess", () => {
  const saved = joinAddress("Flat 2, Sector 29, Rohini", "New Delhi", "Delhi");
  assert.equal(saved, "Flat 2, Sector 29, Rohini, New Delhi, Delhi");
  assert.deepEqual(placeFor(saved, "110042"), { street: "Flat 2, Sector 29, Rohini", city: "New Delhi", state: { code: "DL", name: "Delhi" }, zip: "110042" });
  // The typed state wins even if the pincode points elsewhere: the CDE's entry is the record.
  assert.equal(placeFor(joinAddress("12 MG Road", "Bengaluru", "Karnataka"), "110042").state?.code, "KA");
});
