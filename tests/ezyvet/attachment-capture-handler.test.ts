import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCaptureHandler, type CaptureGateway } from "../../supabase/functions/ezyvet-attachment-capture/handler.ts";
const uid = (n: number) => `de680000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uid(1), pet = uid(2), requestId = uid(3), leaseId = uid(4), requestHash = "a".repeat(64);
const original = new TextEncoder().encode("%PDF-1.7\nSynthetic endpoint original\n%%EOF");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const metadata = { id: 701, record_type: "Animal", record_id: 77, file_id: "source-file", mime_type: "application/pdf", file_download_url: "https://untrusted.example.test/original" };
const source = { schema_version: 1, run_id: uid(5), page: 1, attachment_snapshot_id: uid(6), attachment_payload_hash: "b".repeat(64), attachment_observed_head_version: 1, attachment_external_id: "701", attachment_metadata: metadata,
  parent: { parent_type: "Animal", parent_external_id: "77", parent_snapshot_id: uid(7), parent_payload_hash: "c".repeat(64), parent_observed_head_version: 1, animal_link_id: uid(8), client_id: uid(9), pet_id: pet, source_origin: "https://api.trial.ezyvet.com", source_site_uid: "synthetic" } };
const body = { request_id: requestId, pet_id: pet, request_hash: requestHash };
function fixture() {
  const calls: string[] = [], urls: string[] = [], failures: Array<Record<string, unknown>> = [];
  const state = { active: true, signedIn: true, enabled: true, stored: null as Uint8Array | null, intent: null as Record<string, unknown> | null, capture: null as Record<string, unknown> | null,
    lostUpload: false, lostComplete: false, denyUpload: false, changedAt: 0, metadataReads: 0, changedFile: false, wrongRecovery: false, wrongStatus: false, wrongLease: false, wrongPath: false, missing: false };
  const makeIntent = (sha = digest(original)) => ({ request_id: requestId, actor_id: actor, pet_id: pet, request_hash: requestHash, originating_lease_id: leaseId, intent_hash: "d".repeat(64), bucket: "ezyvet-attachments", object_path: `${actor}/${pet}/${requestId}/${uid(10)}/original`, content_sha256: sha, file_size: original.length, mime_type: "application/pdf", before_metadata: metadata, after_metadata: metadata });
  const makeCapture = () => ({ request_id: requestId, actor_id: actor, pet_id: pet, intent_hash: state.intent!.intent_hash, bucket: "ezyvet-attachments", object_path: state.intent!.object_path, content_sha256: state.intent!.content_sha256, file_size: original.length, mime_type: "application/pdf", storage_object_id: uid(11), capture_hash: "e".repeat(64) });
  const recovery = () => state.missing ? null : ({ request: { id: requestId, actor_id: actor, pet_id: state.wrongRecovery ? uid(99) : pet, request_hash: requestHash, status: state.wrongStatus ? ["pending"] : state.capture ? "captured" : "pending", source_context: source,
    request_payload: { run_id: source.run_id, page: 1, snapshot_id: source.attachment_snapshot_id, payload_hash: source.attachment_payload_hash, observed_head_version: 1 } }, capture_intent: state.intent, capture: state.capture });
  const gateway: CaptureGateway = {
    authenticate: async () => { calls.push("authenticate"); return state.signedIn ? { id: actor, activeAdmin: state.active } : null; },
    recover: async () => { calls.push("recover"); return recovery(); },
    claim: async identity => { calls.push("claim"); assert.equal(identity.actor, actor); return { request_id: requestId, pet_id: state.wrongLease ? uid(99) : pet, request_hash: requestHash, lease_id: leaseId, lease_until: new Date(Date.now() + 90_000).toISOString(), source_context: source, capture_intent: state.intent }; },
    reserve: async args => { calls.push("reserve"); assert.equal(args.p_actor, actor); assert.equal(args.p_content_sha256, digest(original)); state.intent = makeIntent(); if (state.wrongPath) state.intent.object_path = "other/original"; return state.intent; },
    complete: async args => { calls.push("complete"); assert.equal(args.p_verified_sha256, digest(state.stored!)); state.capture = makeCapture(); if (state.lostComplete) throw new Error("Lost synthetic completion reply"); return state.capture; },
    fail: async args => { calls.push("fail"); failures.push(args); },
    read: async (_path, bearer) => { calls.push("read"); assert.equal(bearer, "synthetic-session"); return state.stored ? new Response(new Uint8Array(state.stored), { headers: { "Content-Type": "application/pdf" } }) : null; },
    upload: async (_path, bytes, _mime, bearer) => { calls.push("upload"); assert.equal(bearer, "synthetic-session"); if (state.denyUpload) throw new Error("Denied upload"); state.stored = new Uint8Array(bytes); if (state.lostUpload) throw new Error("Lost synthetic upload reply"); },
  };
  const env = (key: string) => ({ APP_URL: "https://staff.example.test", APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_ATTACHMENT_CAPTURE_ENABLED: state.enabled ? "true" : undefined, EZYVET_READ_RESOURCES: "attachment", EZYVET_SITE_UID: "synthetic", EZYVET_CLIENT_ID: "synthetic", EZYVET_CLIENT_SECRET: "synthetic" })[key];
  const handler = createCaptureHandler({ gateway, env, now: Date.now, sleep: async () => {}, fetch: async input => {
    const url = new URL(String(input)); urls.push(url.pathname); assert.equal(url.origin, "https://api.trial.ezyvet.com");
    if (url.pathname.endsWith("access_token")) return Response.json({ access_token: "synthetic", expires_in: 3600 });
    if (url.pathname.includes("/download/")) { const bytes = new Uint8Array(original); if (state.changedFile) bytes[bytes.length - 1] ^= 1; return new Response(bytes); }
    state.metadataReads++;
    return Response.json({ items: [{ attachment: state.metadataReads === state.changedAt ? { ...metadata, file_id: "changed" } : metadata }], meta: { items_page: 1, items_page_total: 1 } });
  } });
  const post = (payload: unknown = body, headers: Record<string, string> = {}) => handler(new Request("https://staff.example.test/capture", { method: "POST", headers: { Origin: "https://staff.example.test", Authorization: "Bearer synthetic-session", "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) }));
  return { handler, post, state, calls, urls, failures, makeIntent, makeCapture };
}

test("capture endpoint derives actor, verifies physical readback and returns only receipt summary", async () => {
  const f = fixture(); const response = await f.post();
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { request_id: requestId, status: "captured", capture_hash: "e".repeat(64) });
  assert.deepEqual(f.calls, ["authenticate", "recover", "claim", "reserve", "upload", "read", "complete"]);
  assert.equal(f.state.metadataReads, 3); assert.deepEqual(f.failures, []);
});

test("completed request recovers without claim, source read or Storage operation", async () => {
  const f = fixture(); f.state.intent = f.makeIntent(); f.state.capture = f.makeCapture();
  assert.equal((await f.post()).status, 200); assert.deepEqual(f.calls, ["authenticate", "recover"]); assert.deepEqual(f.urls, []);
});

for (const lost of ["lostUpload", "lostComplete"] as const) {
  test(`${lost} recovers verified committed evidence`, async () => {
    const f = fixture(); f.state[lost] = true;
    assert.equal((await f.post()).status, 200); assert.deepEqual(f.failures, []);
    assert.equal(f.calls.filter(c => c === "upload").length, 1);
    assert.equal(f.calls.filter(c => c === "complete").length, 1);
  });
}

test("existing reserved original is read first and never uploaded or fetched again", async () => {
  const f = fixture(); f.state.intent = f.makeIntent(); f.state.stored = original;
  assert.equal((await f.post()).status, 200);
  assert.ok(!f.calls.includes("upload") && !f.calls.includes("reserve")); assert.ok(!f.urls.some(u => u.includes("/download/")));
  assert.equal(f.state.metadataReads, 1);
});

test("missing reserved object can be recreated only with the frozen bytes", async () => {
  const f = fixture(); f.state.intent = f.makeIntent();
  assert.equal((await f.post()).status, 200); assert.equal(f.calls.filter(c => c === "read").length, 2); assert.ok(!f.calls.includes("reserve"));
});

test("changed bytes cannot replace a missing reserved original even with matching metadata", async () => {
  const f = fixture(); f.state.intent = f.makeIntent(); f.state.changedFile = true;
  assert.equal((await f.post()).status, 409); assert.ok(!f.calls.includes("upload") && !f.calls.includes("complete"));
  assert.equal(f.failures[0].p_code, "SOURCE_ATTACHMENT_METADATA_CHANGED"); assert.equal(f.failures[0].p_retry_seconds, 0);
});

test("altered stored bytes reject before any source read and cannot be overwritten", async () => {
  const f = fixture(); f.state.intent = f.makeIntent(); const altered = new Uint8Array(original); altered[altered.length - 1] ^= 1; f.state.stored = altered;
  assert.equal((await f.post()).status, 409); assert.equal(f.failures[0].p_code, "ATTACHMENT_INVALID_CONTENT"); assert.deepEqual(f.urls, []); assert.ok(!f.calls.includes("upload"));
});

test("changed final metadata withholds capture after upload", async () => {
  const f = fixture(); f.state.changedAt = 3;
  assert.equal((await f.post()).status, 409); assert.ok(f.calls.includes("upload") && !f.calls.includes("complete")); assert.equal(f.failures[0].p_code, "SOURCE_ATTACHMENT_METADATA_CHANGED");
});

test("denied upload with no object remains a retryable durable reservation", async () => {
  const f = fixture(); f.state.denyUpload = true;
  assert.equal((await f.post()).status, 503); assert.ok(f.state.intent); assert.equal(f.failures[0].p_code, "STORAGE_UNAVAILABLE"); assert.ok(!f.calls.includes("complete"));
});

for (const field of ["actor", "bucket", "object_path", "lease_id", "download_url"] as const) {
  test(`caller cannot supply ${field}`, async () => {
    const f = fixture(); assert.equal((await f.post({ ...body, [field]: "untrusted" })).status, 400); assert.deepEqual(f.calls, ["authenticate"]); assert.deepEqual(f.urls, []);
  });
}

for (const problem of ["wrongRecovery", "wrongStatus", "wrongLease", "wrongPath"] as const) {
  test(`${problem} database response fails closed before storage upload`, async () => {
    const f = fixture(); f.state[problem] = true;
    assert.equal((await f.post()).status, 503); assert.ok(!f.calls.includes("upload") && !f.calls.includes("complete"));
    if (problem !== "wrongPath") { assert.deepEqual(f.failures, []); assert.deepEqual(f.urls, []); }
  });
}

test("default-off, inactive and missing-session gates prevent claims", async () => {
  for (const [key, status] of [["enabled", 503], ["active", 403], ["signedIn", 401]] as const) {
    const f = fixture(); f.state[key] = false; assert.equal((await f.post()).status, status); assert.deepEqual(f.calls, ["authenticate"]); assert.deepEqual(f.urls, []);
  }
});

test("origin and body bounds reject before capture work", async () => {
  const f = fixture(); assert.equal((await f.post(body, { Origin: "https://untrusted.example.test" })).status, 403); assert.deepEqual(f.calls, []);
  assert.equal((await f.post({ ...body, large: "x".repeat(3000) })).status, 400); assert.ok(!f.calls.includes("claim"));
});

test("missing request returns an explicit not-found response", async () => {
  const f = fixture(); f.state.missing = true; assert.equal((await f.post()).status, 404); assert.deepEqual(f.calls, ["authenticate", "recover"]);
});

test("empty authorization and non-boolean role results cannot authorize work", async () => {
  const f = fixture(); assert.equal((await f.post(body, { Authorization: "Bearer " })).status, 401); assert.deepEqual(f.calls, []);
  f.state.active = "true" as unknown as boolean; assert.equal((await f.post()).status, 403); assert.deepEqual(f.calls, ["authenticate"]);
});
