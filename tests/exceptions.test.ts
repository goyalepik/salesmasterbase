import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoState } from "../src/lib/demo/dataset";
import { MemoryRepository } from "../src/lib/memory-repository";

test("resolving an exception writes an audit entry and does not verify payment", async () => {
  const now = new Date("2026-10-28T12:00:00+05:30");
  const repo = new MemoryRepository(buildDemoState(now));
  const target = repo.snapshot().exceptions.find((item) => item.id === "00000000-0000-4000-8000-0000000000a2");
  assert.ok(target);
  const extraction = repo.snapshot().extractions.find((item) => item.messageId === target.messageId);
  assert.ok(extraction);
  extraction.verifiedAmountMinor = 12345;
  const before = repo.snapshot().audit.length;
  const resolved = await repo.resolveException(target.id, "Checked the thread. This note does not verify payment.", "Dashboard user");
  assert.equal(resolved.status, "resolved");
  assert.equal(extraction.verification, "unverified");
  assert.equal(extraction.verifiedAmountMinor, 12345);
  assert.equal(extraction.verifiedCustomerName, null);
  const message = repo.snapshot().messages.find((item) => item.id === target.messageId);
  assert.equal(message?.processingStatus, "processed");
  const added = repo.snapshot().audit.slice(before);
  assert.equal(added.some((entry) => entry.action === "exception_resolved" && entry.outcome === "success"), true);
  const prior = repo.snapshot().audit[0];
  assert.equal(prior?.action, repo.snapshot().audit[0]?.action);
});

test("requires a resolution note and leaves audit history intact", async () => {
  const repo = new MemoryRepository(buildDemoState(new Date("2026-10-28T12:00:00+05:30")));
  const firstAudit = repo.snapshot().audit[0]?.summary;
  await assert.rejects(() => repo.resolveException("00000000-0000-4000-8000-0000000000a2", "short", "Dashboard user"));
  assert.equal(repo.snapshot().audit[0]?.summary, firstAudit);
  assert.equal(repo.snapshot().exceptions.find((item) => item.id === "00000000-0000-4000-8000-0000000000a2")?.status, "open");
});
