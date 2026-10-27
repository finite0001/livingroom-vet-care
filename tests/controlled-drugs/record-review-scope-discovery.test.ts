import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyReviewScopeReply } from "../../src/hub/features/controlled-drugs/record-review/scope-discovery.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = { schema_version: 1, actor_id: id(1), cursor: null, page_size: 100 };
const raw = (value: unknown) => decodeExactJson(new TextEncoder().encode(JSON.stringify(value)));
const site = () => ({ product_id: id(2), product_name: "Synthetic stock", view: "site", site_id: id(3), site_name: "Synthetic clinic", event_kinds: ["adjust_inventory", "receive_inventory"] });
const exception = () => ({ product_id: id(2), product_name: "Synthetic stock", view: "exceptions", site_id: null, site_name: null, event_kinds: [] });
test("review-only discovery admits ordered site and exception scopes without count permissions", () => {
  const reply = verifyReviewScopeReply(request, raw({ schema_version: 1, items: [exception(), site()], next_cursor: null, has_more: false }));
  assert.equal(reply.items.length, 2); assert.ok(Object.isFrozen(reply.items[1].event_kinds));
});
test("review discovery rejects broadening, duplicate keys, unknown kinds and false continuations", () => {
  for (const items of [[site(), exception()], [site(), site()], [{ ...site(), event_kinds: ["unrecognized"] }],
    [{ ...site(), event_kinds: ["receive_inventory", "adjust_inventory"] }], [{ ...exception(), event_kinds: ["receive_inventory"] }],
    [{ ...site(), capabilities: { count: true } }], [{ ...site(), site_name: null }]])
    assert.throws(() => verifyReviewScopeReply(request, raw({ schema_version: 1, items, next_cursor: null, has_more: false })));
  assert.throws(() => verifyReviewScopeReply(request, raw({ schema_version: 1, items: [site()], next_cursor: null, has_more: true })));
  assert.throws(() => verifyReviewScopeReply({ ...request, cursor: { product_id: id(2), view: "site", site_id: id(3) } }, raw({ schema_version: 1, items: [site()], next_cursor: null, has_more: false })));
  assert.throws(() => verifyReviewScopeReply(request, raw({ schema_version: 1, items: [{ ...site(), product_name: "😺".repeat(513) }], next_cursor: null, has_more: false })));
});
test("scope size follows parsed JSONB bytes while equivalent escaped Unicode stays valid", () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ...site(), site_id: id(index + 10), product_name: "é".repeat(500), site_name: "é".repeat(500) }));
  const spelling = JSON.stringify({ schema_version: 1, items, next_cursor: null, has_more: false }).replaceAll("é", "\\u00e9");
  assert.ok(new TextEncoder().encode(spelling).length > 262144);
  assert.equal(verifyReviewScopeReply(request, decodeExactJson(new TextEncoder().encode(spelling))).items.length, 100);
  assert.throws(() => verifyReviewScopeReply(request, raw({ schema_version: 1, items: items.map(row => ({ ...row, product_name: "é".repeat(1000), site_name: "é".repeat(1000) })), next_cursor: null, has_more: false })));
});
