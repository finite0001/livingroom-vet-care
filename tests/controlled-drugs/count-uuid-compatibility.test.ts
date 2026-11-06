import assert from "node:assert/strict";
import test from "node:test";
import { createCountClient } from "../../src/hub/features/controlled-drugs/count/count-client.ts";
import { reviewUuidSchema } from "../../src/hub/features/controlled-drugs/record-review/request.ts";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const identity = { actorId: id(1), sessionId: id(90), generation: 1 };
const request = { schema_version: 1, actor_id: id(1), product_id: id(30), site_id: id(31) };
const config = { projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" };
const sessions = { current: async () => ({ ...identity, accessToken: "synthetic.session.token" }), isCurrent: () => true };

test("retained UUID protocol accepts every version and variant nibble without changing its spelling", () => {
  for (const version of "0123456789abcdef") for (const variant of "0123456789abcdef") {
    const value = `01234567-89ab-${version}123-${variant}123-0123456789ab`;
    assert.equal(reviewUuidSchema.parse(value), value);
  }
  for (const value of ["00000000-0000-0000-0000-000000000000", "01234567-89AB-0123-0123-0123456789ab",
    "0123456789ab012301230123456789ab", `${id(1)} `, `${id(1)}\n`, id(1).replace(/1$/, "g"), 1, null]) {
    assert.equal(reviewUuidSchema.safeParse(value).success, false, String(value));
  }
});

test("policy and correction reads carry retained PostgreSQL UUIDs through identity, request and response validation", async () => {
  const calls: string[] = [];
  const client = createCountClient(config, sessions, async (url, options) => {
    const name = String(url).split("/").at(-1)!;
    calls.push(name);
    assert.equal(JSON.parse(options!.body as string).p_request.actor_id, identity.actorId);
    assert.equal(options!.headers["Authorization"], "Bearer synthetic.session.token");
    const result = name === "read_controlled_count_policy_v1"
      ? { schema_version: 1, state: "unconfigured", data: { product_id: id(30), site_id: id(31), policy: null } }
      : { schema_version: 1, product_id: id(30), site_id: id(31), items: [], other_scope_causes: false, next_cursor: null, has_more: false };
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  });
  assert.equal((await client.policy(request, identity)).state, "unconfigured");
  assert.deepEqual((await client.investigations({ ...request, cursor: null, page_size: 100 }, identity)).items, []);
  assert.deepEqual(calls, ["read_controlled_count_policy_v1", "list_controlled_count_investigations_v1"]);
  await assert.rejects(client.policy(request, { ...identity, sessionId: "malformed" }));
  await assert.rejects(client.policy(request, { ...identity, actorId: id(2) }));
  assert.equal(calls.length, 2);
});
