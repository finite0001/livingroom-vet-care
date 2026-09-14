import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../supabase/functions/ezyvet-import/handler.ts";
import type { ImportRun } from "../../supabase/functions/ezyvet-import/handler.ts";
import { createAdapter } from "../../supabase/functions/ezyvet-import/adapter.ts";
const id = "e6500000-0000-4000-8000-000000000001";
const mapping = "e6500000-0000-4000-8000-000000000002";
const snapshot = "e6500000-0000-4000-8000-000000000003";
const payloadHash = "a".repeat(64);
function fixture(parentType: "Animal" | "Consult" = "Animal") {
  const env: Record<string, string> = { APP_URL: "https://thelivingroom.vet", APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_SITE_UID: "synthetic-site", EZYVET_CLIENT_ID: "synthetic-client", EZYVET_CLIENT_SECRET: "synthetic-secret", EZYVET_READ_RESOURCES: "attachment" };
  const body = { run_id: id, resource: "attachment", animal_link_id: mapping, parent_type: parentType, parent_snapshot_id: snapshot, parent_payload_hash: payloadHash, parent_observed_head_version: 1 };
  const state = { calls: [] as string[], stages: 0, claims: 0, wrongParent: false, corruptContext: false, loseReply: false, admin: true, failures: [] as string[], run: {
    id, resource: "attachment", requested_by: "synthetic-admin", source_site_uid: "synthetic-site", status: "running", next_page: 1, lease_id: "owned-lease",
    parent_context: { animal_link_id: mapping, parent_type: parentType, parent_external_id: "77", parent_snapshot_id: snapshot, parent_payload_hash: payloadHash, parent_observed_head_version: 1, source_origin: "https://api.trial.ezyvet.com", source_site_uid: "synthetic-site" },
  } as ImportRun };
  const handler = createHandler({ env: key => env[key], now: Date.now, sleep: async () => {}, fetch: async (input, init) => {
    const url = String(input); state.calls.push(url); assert.equal(init?.redirect, "error");
    if (url.endsWith("access_token")) {
      assert.equal(JSON.parse(String(init?.body)).scope, "read-attachment");
      return Response.json({ access_token: "synthetic-bearer", expires_in: 43200 });
    }
    const parsed = new URL(url); assert.equal(parsed.pathname, "/v1/attachment");
    assert.equal(parsed.searchParams.get("record_type"), parentType); assert.equal(parsed.searchParams.get("record_id"), "77");
    assert.equal(parsed.searchParams.get("limit"), "10"); assert.equal(parsed.searchParams.has("animal_id"), false);
    return Response.json({ meta: { items_page: 1, items_page_total: 1 }, items: [{ attachment: { id: 701, record_type: parentType, record_id: state.wrongParent ? 88 : 77, mime_type: "unsupported/example", file_download_url: "https://untrusted.example.test/never-fetch", name: "<script>original</script>" } }] });
  }, gateway: {
    authenticate: async () => ({ id: "synthetic-admin", activeAdmin: state.admin }),
    claim: async () => { throw new Error("Generic claim must never receive attachments"); },
    claimAttachment: async (...args) => {
      state.claims++; assert.deepEqual(args, [id, "synthetic-admin", "synthetic-site", "https://api.trial.ezyvet.com", mapping, parentType, snapshot, payloadHash, 1]);
      return state.corruptContext ? { ...state.run, parent_context: { ...state.run.parent_context!, parent_snapshot_id: mapping } } : state.run;
    },
    stage: async (_run, actor, page) => {
      assert.equal(actor, "synthetic-admin"); assert.equal(page.items[0].payload.mime_type, "unsupported/example");
      state.stages++; state.run = { ...state.run, status: "review_ready", next_page: 2 };
      if (state.loseReply) throw new Error("Untrusted database detail");
      return state.run;
    },
    fail: async (_run, _actor, code) => { state.failures.push(code); },
  } });
  const send = (input: unknown = body) => handler(new Request("https://functions.example.test/ezyvet-import", { method: "POST", headers: { Authorization: "Bearer synthetic-session" }, body: JSON.stringify(input) }));
  return { env, state, body, send };
}
for (const parent of ["Animal", "Consult"] as const) {
  test(`attachment metadata uses database-derived ${parent} filter and preserves unsupported evidence`, async () => {
    const f = fixture(parent); const response = await f.send(); assert.equal(response.status, 200); assert.equal(f.state.stages, 1);
    assert.equal(f.state.calls.length, 2); assert.ok(f.state.calls.every(url => url.startsWith("https://api.trial.ezyvet.com/")));
    assert.equal(JSON.stringify(await response.json()).includes("owned-lease"), false);
  });
}
test("missing pins, arbitrary external IDs and unsupported parent types never claim or fetch", async () => {
  for (const change of [{ parent_type: "Contact" }, { parent_type: ["Animal"] }, { parent_snapshot_id: undefined }, { parent_payload_hash: "bad" }, { parent_observed_head_version: 0 }, { record_id: "88" }, { parent_external_id: "88" }]) {
    const f = fixture(); assert.equal((await f.send({ ...f.body, ...change })).status, 400); assert.equal(f.state.claims, 0); assert.equal(f.state.calls.length, 0);
  }
});
test("attachment scope and administrator gates precede claims", async () => {
  const f = fixture(); f.env.EZYVET_READ_RESOURCES = "contact,animal"; assert.equal((await f.send()).status, 400); assert.equal(f.state.claims, 0);
  const g = fixture(); g.state.admin = false; assert.equal((await g.send()).status, 403); assert.equal(g.state.claims, 0);
});
test("wrong upstream parent fails whole page without staging or following file URL", async () => {
  const f = fixture(); f.state.wrongParent = true; const response = await f.send(); assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "SOURCE_ATTACHMENT_PARENT_MISMATCH"); assert.equal(f.state.stages, 0); assert.equal(f.state.calls.length, 2);
});
test("mismatched database parent context stops before upstream or failure mutation", async () => {
  const f = fixture(); f.state.corruptContext = true; const response = await f.send(); assert.equal(response.status, 503);
  assert.equal(f.state.calls.length, 0); assert.deepEqual(f.state.failures, []);
});
test("lost terminal stage response recovers without another fetch or duplicate stage", async () => {
  const f = fixture(); f.state.loseReply = true; const first = await f.send(); assert.equal(first.status, 503); assert.equal(JSON.stringify(await first.json()).includes("Untrusted"), false);
  const second = await f.send(); assert.equal(second.status, 200); assert.equal((await second.json()).status, "review_ready");
  assert.equal(f.state.stages, 1); assert.equal(f.state.claims, 2); assert.equal(f.state.calls.length, 2);
});
test("adapter rejects missing or conflicting attachment parent arguments before authentication", async () => {
  let requests = 0;
  const adapter = createAdapter({ baseUrl: "https://api.trial.ezyvet.com", siteUid: "site", clientId: "id", clientSecret: "secret", readResources: ["attachment"] }, { now: Date.now, sleep: async () => {}, fetch: async () => { requests++; throw new Error("Unexpected fetch"); } });
  await assert.rejects(adapter.page("attachment", 1), /ATTACHMENT_PARENT_REQUIRED/);
  await assert.rejects(adapter.page("attachment", 1, "77", undefined, undefined, { parent_type: "Animal", parent_external_id: "77" }), /ATTACHMENT_PARENT_REQUIRED/);
  await assert.rejects(adapter.page("attachment", 1, undefined, undefined, undefined, { parent_type: "Animal", parent_external_id: "../77" }), /ATTACHMENT_PARENT_REQUIRED/);
  assert.equal(requests, 0);
});
