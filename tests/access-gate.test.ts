import test from "node:test";
import assert from "node:assert/strict";
import { accessCookieValue, accessGate } from "../src/lib/access";

const code = "correct-horse";

test("demo mode stays open without an access code", () => {
  assert.equal(accessGate({ mode: undefined, pathname: "/", accessCode: "", cookie: undefined }), "allow");
  assert.equal(accessGate({ mode: "demo", pathname: "/api/health", accessCode: "", cookie: undefined }), "allow");
});

test("live mode without a usable access code is refused, including pages and APIs", () => {
  assert.equal(accessGate({ mode: "live", pathname: "/", accessCode: "", cookie: undefined }), "refuse");
  assert.equal(accessGate({ mode: "live", pathname: "/api/health", accessCode: "short", cookie: undefined }), "refuse");
  assert.equal(accessGate({ mode: "live", pathname: "/api/slack/events", accessCode: "", cookie: undefined }), "allow");
});

test("live mode with a code challenges missing cookies and allows a matching cookie", () => {
  assert.equal(accessGate({ mode: "live", pathname: "/inbox", accessCode: code, cookie: undefined }), "challenge");
  assert.equal(accessGate({ mode: "live", pathname: "/api/ai/ask", accessCode: code, cookie: "nope" }), "challenge");
  assert.equal(accessGate({ mode: "live", pathname: "/access", accessCode: code, cookie: undefined }), "allow");
  assert.equal(accessGate({ mode: "live", pathname: "/api/live", accessCode: code, cookie: accessCookieValue(code) }), "allow");
});
