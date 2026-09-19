import test from "node:test";
import assert from "node:assert/strict";
import { configuration, createAdapter, parsePage } from "../../supabase/functions/ezyvet-import/adapter.ts";
import { createHandler, type ImportRun } from "../../supabase/functions/ezyvet-import/handler.ts";
const mapping = "e6900000-0000-4000-8000-000000000002";
const runId = "e6900000-0000-4000-8000-000000000001";
const envelope = (extra = {}) => ({ items: [{ attachment: { id: 701, file_id: 800, record_type: "Animal", record_id: 77, name: "Original", file_download_url: "https://secret.invalid/?token=private", unknown: { token: "private" }, ...extra } }], meta: { items_page: 1, items_page_total: 1, items_page_size: 10, items_total: 1 } });
function fixture() {
  const env: Record<string, string> = { APP_URL: "https://thelivingroom.vet", APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_SITE_UID: "synthetic-site", EZYVET_CLIENT_ID: "synthetic-client", EZYVET_CLIENT_SECRET: "synthetic-secret", EZYVET_READ_RESOURCES: "attachment" };
  const config = configuration(key => env[key]);
  const state = { calls: [] as string[], claims: 0, stages: 0, generic: 0, failures: [] as string[], admin: true, corrupt: false, lostReply: false, upstream: envelope(), run: {
    id: runId, requested_by: "synthetic-admin", resource: "attachment", source_site_uid: config.siteUid,
    animal_link_id: mapping, animal_external_id: "77", next_page: 1, status: "running", lease_id: "private-lease",
    parent_context: { animal_link_id: mapping, animal_external_id: "77", pet_id: "pet", client_id: "client", parent_type: "Animal", parent_external_id: "77", parent_snapshot_id: "snapshot", parent_payload_hash: "a".repeat(64), parent_observed_head_version: 1, source_origin: config.baseUrl, source_site_uid: config.siteUid },
  } as ImportRun };
  const dependencies = { now: Date.now, sleep: async () => {}, fetch: async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); state.calls.push(url); assert.equal(init?.redirect, "error");
    if (url.endsWith("access_token")) { assert.equal(JSON.parse(String(init?.body)).scope, "read-attachment"); return Response.json({ access_token: "synthetic-token", expires_in: 3600 }); }
    assert.equal(url, `${config.baseUrl}/v1/attachment?page=1&limit=10&record_type=Animal&record_id=77`);
    assert.equal(init?.method, "GET"); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-token");
    return Response.json(state.upstream);
  } };
  const gateway = {
    authenticate: async () => ({ id: "synthetic-admin", activeAdmin: state.admin }),
    claim: async () => { state.generic++; throw new Error("Generic claim forbidden"); },
    stage: async () => { state.generic++; throw new Error("Generic stage forbidden"); },
    claimAttachment: async (...args: string[]) => { state.claims++; assert.deepEqual(args, [runId, "synthetic-admin", config.siteUid, config.baseUrl, mapping]); return state.corrupt ? { ...state.run, animal_external_id: "88" } : state.run; },
    stageAttachment: async (_run: ImportRun, actor: string, page: unknown) => {
      assert.equal(actor, "synthetic-admin"); assert.equal(JSON.stringify(page).includes("private"), false); assert.equal(JSON.stringify(page).includes("download_url"), false);
      state.stages++; state.run = { ...state.run, status: "review_ready", next_page: 2, lease_id: null };
      if (state.lostReply) throw new Error("secret upstream response"); return state.run;
    },
    fail: async (_run: ImportRun, _actor: string, code: string) => { state.failures.push(code); },
  };
  const handler = createHandler({ ...dependencies, env: key => env[key], gateway });
  const body = { run_id: runId, resource: "attachment", animal_link_id: mapping };
  const send = (value = body) => handler(new Request("https://edge.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic" }, body: JSON.stringify(value) }));
  return { state, env, config, dependencies, gateway, body, send };
}
test("dedicated attachment path stages safe canonical metadata and uses only DB-derived Animal filter", async () => {
  const f = fixture(); const response = await f.send(); assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.complete, true); assert.equal(data.observed_count, 1); assert.equal(JSON.stringify(data).includes("private-lease"), false);
  assert.equal(f.state.stages, 1); assert.equal(f.state.generic, 0);
});
test("attachment scopes remain opt-in and generic parsing/fetching reject attachments", async () => {
  const f = fixture(); delete f.env.EZYVET_READ_RESOURCES; assert.deepEqual(configuration(key => f.env[key]).readResources, ["contact", "animal"]);
  assert.equal((await f.send()).status, 400); assert.equal(f.state.claims, 0);
  const adapter = createAdapter(f.config, f.dependencies);
  assert.throws(() => parsePage(envelope(), "attachment", 1), /ATTACHMENT_REQUIRES_METADATA_INTAKE/);
  await assert.rejects(adapter.page("attachment", 1), /ATTACHMENT_REQUIRES_METADATA_INTAKE/); assert.equal(f.state.calls.length, 0);
});
test("invalid source IDs/pages/origins are rejected before OAuth", async () => {
  const f = fixture(); const adapter = createAdapter(f.config, f.dependencies);
  for (const id of ["../77", "077", "9007199254740992", ""]) await assert.rejects(adapter.attachmentPage(id, 1), /INVALID_ATTACHMENT_REQUEST/);
  for (const page of [0, 1001, 1.5, NaN]) await assert.rejects(adapter.attachmentPage("77", page), /INVALID_ATTACHMENT_REQUEST/);
  await assert.rejects(createAdapter({ ...f.config, baseUrl: "https://attacker.invalid" }, f.dependencies).attachmentPage("77", 1), /INVALID_ATTACHMENT_REQUEST/);
  assert.equal(f.state.calls.length, 0);
});
test("caller source pins and unrelated fields are forbidden and missing gateways never fall back", async () => {
  for (const extra of [{ record_id: "88" }, { animal_external_id: "88" }, { parent_type: "Animal" }, { consult_snapshot_id: "bad" }, { prescription_snapshot_id: "bad" }, { animal_link_id: undefined }]) {
    const f = fixture(); assert.equal((await f.send({ ...f.body, ...extra } as typeof f.body)).status, 400); assert.equal(f.state.claims, 0); assert.equal(f.state.calls.length, 0);
  }
  for (const name of ["claimAttachment", "stageAttachment"] as const) { const f = fixture(); delete (f.gateway as Partial<typeof f.gateway>)[name]; assert.equal((await f.send()).status, 503); assert.equal(f.state.generic, 0); assert.equal(f.state.calls.length, 0); }
});
test("wrong DB context and role rejection cause no upstream read", async () => {
  const f = fixture(); f.state.corrupt = true; assert.equal((await f.send()).status, 503); assert.equal(f.state.calls.length, 0); assert.deepEqual(f.state.failures, []);
  const g = fixture(); g.state.admin = false; assert.equal((await g.send()).status, 403); assert.equal(g.state.claims, 0);
});
test("wrong parent, missing file ID and invalid pagination stage no observations", async () => {
  for (const change of [{ record_id: 88 }, { record_type: "Consult" }, { file_id: undefined }]) {
    const f = fixture(); f.state.upstream = envelope(change); assert.equal((await f.send()).status, 503); assert.equal(f.state.stages, 0);
  }
  const f = fixture(); f.state.upstream.meta.items_total = 2; assert.equal((await f.send()).status, 503); assert.equal(f.state.stages, 0);
});
test("lost committed acknowledgement recovers terminal run without another provider request", async () => {
  const f = fixture(); f.state.lostReply = true; const first = await f.send(); assert.equal(first.status, 503); assert.equal(JSON.stringify(await first.json()).includes("secret"), false);
  const second = await f.send(); assert.equal(second.status, 200); assert.equal((await second.json()).status, "review_ready"); assert.equal(f.state.stages, 1); assert.equal(f.state.calls.length, 2);
});
test("metadata stream is limited before parsing and never exposes the rejected body", async () => {
  const f = fixture(); const adapter = createAdapter(f.config, { ...f.dependencies, fetch: async (url, init) => String(url).endsWith("access_token") ? f.dependencies.fetch(url, init) : new Response("sensitive".repeat(40000)) });
  await assert.rejects(adapter.attachmentPage("77", 1), /UPSTREAM_RESPONSE_TOO_LARGE/);
});
test("401 refreshes once; 403 and 429 preserve safe authorization/cooldown errors", async () => {
  for (const status of [401, 403, 429]) {
    const f = fixture(); let reads = 0; const adapter = createAdapter(f.config, { ...f.dependencies, fetch: async (url, init) => String(url).endsWith("access_token") ? f.dependencies.fetch(url, init) : (++reads, new Response("secret", { status, headers: { "retry-after": "120" } })) });
    await assert.rejects(adapter.attachmentPage("77", 1), error => error instanceof Error && error.message === ({401:"UPSTREAM_AUTH_FAILED",403:"UPSTREAM_SCOPE_DENIED",429:"RATE_LIMITED"})[status]); assert.equal(reads, status === 401 ? 2 : 1);
  }
});
