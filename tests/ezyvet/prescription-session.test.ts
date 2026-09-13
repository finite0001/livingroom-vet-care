import test from "node:test";
import assert from "node:assert/strict";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";

test("prescription references stay with their actor and are removed on signout", () => {
  const keys = new Set(["unrelated", ...["prescription", "prescriptionitem"].flatMap((resource) =>
    ["alice", "bob"].map((actor) => `lrv-ezyvet-${resource}-run:${actor}:patient:${resource}`))]);
  const storage = {
    get length() { return keys.size; },
    key: (index: number) => [...keys][index] ?? null,
    removeItem: (key: string) => { keys.delete(key); },
  };
  clearOtherInvoiceEmailIntents(storage, "alice");
  assert.equal(keys.size, 3);
  assert.equal([...keys].some((key) => key.includes(":bob:")), false);
  clearOtherInvoiceEmailIntents(storage, null);
  assert.deepEqual([...keys], ["unrelated"]);
});
