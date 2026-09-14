import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHandler } from "../../supabase/functions/capture-ezyvet-attachment/handler.ts";
import type { CaptureContext, CaptureDependencies } from "../../supabase/functions/capture-ezyvet-attachment/types.ts";
import { parseAttachmentMetadataPage } from "../../supabase/functions/ezyvet-import/attachment-metadata.ts";
import { readAttachmentBytes, maxAttachmentBytes } from "../../supabase/functions/ezyvet-import/attachment-bytes.ts";
const pdf = new TextEncoder().encode("%PDF-1.7\nSynthetic original\n%%EOF");
const raw = (revision = 1) => ({ id: 701, file_id: 801, record_type: "Animal", record_id: 77, mime_type: "application/pdf", name: "Original", file_download_url: `https://secret.invalid/?cap=${revision}` });
const envelope = (revision = 1) => ({ items: [{ attachment: raw(revision) }], meta: { items_page: 1, items_page_total: 1, items_page_size: 10, items_total: 1 } });
async function fixture() {
  const parsed = (await parseAttachmentMetadataPage(envelope(), { animalId: "77", page: 1 })).observations[0];
  const id = randomUUID(), actor = randomUUID(), mapping = randomUUID(), pet = randomUUID(), client = randomUUID();
  const context: CaptureContext = { request: { id, requested_by: actor, animal_link_id: mapping, pet_id: pet, client_id: client, run_id: randomUUID(), page: 1, ordinal: 1, snapshot_id: randomUUID(), observed_head_version: 1, external_id: "701", file_id: "801", stable_metadata_sha256: parsed.stable_metadata_sha256, raw_record_sha256: parsed.raw_record_sha256, metadata: parsed.metadata, parent_context: { animal_link_id: mapping, pet_id: pet, client_id: client, animal_external_id: "77", parent_type: "Animal", parent_external_id: "77", parent_snapshot_id: randomUUID(), parent_payload_hash: "a".repeat(64), parent_observed_head_version: 1, source_origin: "https://api.trial.ezyvet.com", source_site_uid: "synthetic-site" }, request_hash: "b".repeat(64), status: "prepared", source_current: true, lease_active: false, retry_after: null, last_error_code: null, retryable: true, created_at: "now", updated_at: "now", capture: null }, lease_id: null, lease_until: null, intent: null };
  const state = { context, calls: [] as string[], object: null as Uint8Array | null, admin: true, authorized: true, loseUpload: false, loseComplete: false, loseDelete: false, corruptAfter: false, storageDenied: false, failures: [] as string[], metadataReads: 0, rawHashes: [] as string[] };
  const clone = () => structuredClone(state.context);
  const env: Record<string, string> = { APP_URL: "https://thelivingroom.vet", APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_SITE_UID: "synthetic-site", EZYVET_CLIENT_ID: "synthetic", EZYVET_CLIENT_SECRET: "synthetic", EZYVET_READ_RESOURCES: "attachment" };
  const dependencies: CaptureDependencies = { env: k => env[k], now: Date.now, sleep: async () => {}, fetch: async (input, init) => {
    const url = String(input); state.calls.push(url); assert.equal(init?.redirect, "error"); assert.equal(new URL(url).origin, "https://api.trial.ezyvet.com");
    if (url.endsWith("access_token")) { assert.equal(JSON.parse(String(init?.body)).scope, "read-attachment"); return Response.json({ access_token: "synthetic", expires_in: 3600 }); }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    if (url.includes("/download/")) { assert.equal(url, "https://api.trial.ezyvet.com/v1/attachment/download/701"); return new Response(pdf, { headers: { "Content-Type": "application/octet-stream" } }); }
    assert.equal(url, "https://api.trial.ezyvet.com/v1/attachment?page=1&limit=10&id=701&record_type=Animal&record_id=77");
    const body = envelope(++state.metadataReads); if (state.corruptAfter && state.metadataReads === 2) body.items[0].attachment.file_id = 999;
    return Response.json(body);
  }, gateway: {
    authenticate: async () => state.authorized ? { id: actor, activeAdmin: state.admin } : null,
    context: async () => clone(), claim: async () => { state.context.lease_id = randomUUID(); state.context.lease_until = "later"; return clone(); },
    reserve: async (_id, _actor, lease, file, beforeRaw, afterRaw) => { assert.equal(lease, state.context.lease_id); state.rawHashes = [beforeRaw, afterRaw]; state.context.intent = { id: randomUUID(), bucket_id: "ezyvet-attachment-originals", object_path: `${actor}/${pet}/${id}/${randomUUID()}/original`, content_sha256: file.sha256, mime_type: file.mimeType, file_size: file.size, before_raw_sha256: beforeRaw, after_raw_sha256: afterRaw }; state.context.request.status = "reserved"; return clone(); },
    complete: async (_id, _actor, lease, intent, file) => { assert.equal(lease, state.context.lease_id); assert.equal(file.sha256, intent.content_sha256); state.context.request.status = "ready"; state.context.request.capture = { id: randomUUID(), request_id: id, entry_method: "ezyvet_api_attachment_original_v1", content_sha256: file.sha256, mime_type: file.mimeType, file_size: file.size, capture_hash: "c".repeat(64), captured_at: "now" }; state.context.lease_id = null; if (state.loseComplete) { state.loseComplete = false; throw new Error("secret lost complete"); } return clone(); },
    fail: async (_id, _actor, _lease, code, seconds, terminal) => { assert.equal(terminal ? seconds === 0 : seconds >= 1 && seconds <= 3600, true); state.failures.push(code); },
    beginDiscard: async () => { if (state.context.request.status === "ready") throw { code: "42501" }; state.context.request.status = state.context.request.status === "abandoned" ? "abandoned" : "discarding"; state.context.lease_id = null; return clone(); },
    completeDiscard: async () => { assert.equal(state.object, null); state.context.request.status = "abandoned"; return clone(); },
    readObject: async () => { if (state.storageDenied) throw new Error("storage denied secret"); return state.object ? new Response(state.object as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "application/pdf" } }) : null; },
    uploadObject: async (_intent, bytes, bearer) => { assert.equal(bearer, "staff-token"); assert.equal(state.object, null, "No replacement upload"); state.object = bytes.slice(); if (state.loseUpload) throw new Error("lost upload"); },
    deleteObject: async () => { assert.equal(state.context.request.status, "discarding"); state.object = null; if (state.loseDelete) throw new Error("lost deletion"); },
  } };
  const handler = createHandler(dependencies);
  const send = (action = "capture", extra = {}) => handler(new Request("https://edge.invalid", { method: "POST", headers: { Authorization: "Bearer staff-token", Origin: "https://thelivingroom.vet" }, body: JSON.stringify({ action, request_id: id, ...extra }) }));
  return { state, dependencies, env, send };
}
test("original capture preserves raw URL renewal evidence while pinning stable metadata and bytes", async () => {
  const f = await fixture(); const response = await f.send(); assert.equal(response.status, 200); assert.equal((await response.json()).status, "ready");
  assert.notEqual(f.state.rawHashes[0], f.state.rawHashes[1]); assert.deepEqual(f.state.object, pdf); assert.equal(f.state.calls.length, 4);
  assert.equal(JSON.stringify(f.state.context).includes("secret.invalid"), false);
});
test("lost upload acknowledgment verifies existing reserved object before completing", async () => { const f = await fixture(); f.state.loseUpload = true; assert.equal((await f.send()).status, 200); assert.equal(f.state.calls.length, 4); });
test("lost completion acknowledgement recovers ready receipt without importer activation", async () => {
  const f = await fixture(); f.state.loseComplete = true; assert.equal((await f.send()).status, 503); delete f.env.EZYVET_IMPORT_MODE; assert.equal((await f.send()).status, 200); assert.equal(f.state.calls.length, 4);
});
test("ready retrieval verifies original bytes with importer disabled and download-only headers", async () => {
  const f = await fixture(); await f.send(); delete f.env.EZYVET_IMPORT_MODE; const r = await f.send("retrieve"); assert.equal(r.status, 200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), pdf); assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(r.headers.get("Content-Disposition")!, /^attachment;/); assert.equal(f.state.calls.length, 4);
});
test("same-size stored tampering never returns downloadable bytes", async () => { const f = await fixture(); await f.send(); f.state.object![10] ^= 1; const response = await f.send("retrieve"); assert.equal(response.status, 409); assert.equal((await response.json()).error, "STORAGE_OBJECT_CHANGED"); });
test("stable metadata change blocks before reservation/upload", async () => { const f = await fixture(); f.state.corruptAfter = true; assert.equal((await f.send()).status, 409); assert.equal(f.state.context.intent, null); assert.equal(f.state.object, null); assert.deepEqual(f.state.failures, ["SOURCE_ATTACHMENT_METADATA_CHANGED"]); });
test("reserved object recovery performs no new source request", async () => {
  const f = await fixture(); await f.send(); f.state.context.request.status = "reserved"; f.state.context.request.capture = null; f.state.context.lease_id = null; f.state.calls.length = 0; delete f.env.EZYVET_IMPORT_MODE;
  assert.equal((await f.send()).status, 200); assert.equal(f.state.calls.length, 0);
});
test("storage denied is never interpreted as missing or followed by provider reads", async () => {
  const f = await fixture(); await f.send(); f.state.context.request.status = "reserved"; f.state.context.request.capture = null; f.state.storageDenied = true; f.state.calls.length = 0;
  assert.equal((await f.send()).status, 503); assert.equal(f.state.calls.length, 0);
});
test("discard fences an unfinished intent and recovers lost deletion acknowledgement", async () => { const f = await fixture(); await f.send(); f.state.context.request.status = "reserved"; f.state.context.request.capture = null; f.state.loseDelete = true; const r = await f.send("discard"); assert.equal(r.status, 200); assert.equal(f.state.object, null); assert.equal(f.state.context.request.status, "abandoned"); assert.equal((await f.send("discard")).status, 200); });
test("ready captures cannot be discarded and unauthorized callers never access source", async () => { const f = await fixture(); await f.send(); assert.equal((await f.send("discard")).status, 403); assert.deepEqual(f.state.object, pdf); const g = await fixture(); g.state.admin = false; assert.equal((await g.send()).status, 403); g.state.authorized = false; assert.equal((await g.send()).status, 401); assert.equal(g.state.calls.length, 0); });
test("browser cannot substitute URL, path, source or file hash", async () => { for (const extra of [{ url: "https://bad.invalid" }, { object_path: "bad" }, { source_site_uid: "bad" }, { content_sha256: "a".repeat(64) }]) { const f = await fixture(); assert.equal((await f.send("capture", extra)).status, 400); assert.equal(f.state.calls.length, 0); } });
test("byte reader rejects unsupported, partial, empty, oversized, compressed and truncated responses", async () => {
  for (const response of [new Response(pdf, { status: 206 }), new Response(pdf, { headers: { "Content-Encoding": "gzip" } }), new Response(pdf, { headers: { "Content-Length": String(pdf.length + 1) } }), new Response(pdf, { headers: { "Content-Length": String(maxAttachmentBytes + 1) } }), new Response(null), new Response("<html>bad</html>")]) await assert.rejects(readAttachmentBytes(response, null, AbortSignal.timeout(1000)));
});
test("byte reader accepts tiny chunks without allocation proportional to chunk count and aborts stalled stream", async () => {
  let i = 0; const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (i === pdf.length) controller.close(); else controller.enqueue(pdf.slice(i, ++i)); } });
  assert.deepEqual((await readAttachmentBytes(new Response(stream), null, AbortSignal.timeout(1000))).bytes, pdf);
  const controller = new AbortController(); const promise = readAttachmentBytes(new Response(new ReadableStream({ pull() {} })), null, controller.signal); controller.abort(); await assert.rejects(promise, /UPSTREAM_UNAVAILABLE/);
});
test("missing reserved object can only recover the original pinned bytes", async () => {
  const f = await fixture(); await f.send(); f.state.context.request.status = "reserved"; f.state.context.request.capture = null; f.state.object = null; f.state.calls.length = 0;
  f.state.context.intent!.content_sha256 = "f".repeat(64);
  assert.equal((await f.send()).status, 409); assert.equal(f.state.object, null); assert.equal(f.state.failures.at(-1), "STORAGE_OBJECT_CHANGED");
});
test("configured source substitution and malformed action never cause provider traffic", async () => {
  const f = await fixture(); f.env.EZYVET_SITE_UID = "other-site"; assert.equal((await f.send()).status, 503); assert.equal(f.state.calls.length, 0); assert.equal(f.state.failures.at(-1), "CAPTURE_UNAVAILABLE");
  const g = await fixture(); assert.equal((await g.send("capture", { action: ["capture"] })).status, 400); assert.equal(g.state.calls.length, 0);
});
test("PNG and JPEG retain exact signatures and reject conflicting MIME", async () => {
  for (const [values, mime] of [[[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], "image/png"], [[0xff,0xd8,0xff,0xe0], "image/jpeg"]] as const) {
    const bytes = Uint8Array.from(values); const file = await readAttachmentBytes(new Response(bytes), mime, AbortSignal.timeout(1000)); assert.deepEqual(file.bytes, bytes); assert.equal(file.mimeType, mime);
    await assert.rejects(readAttachmentBytes(new Response(bytes), "application/pdf", AbortSignal.timeout(1000)), /ATTACHMENT_INVALID_CONTENT/);
  }
});

test("private intent path must bind actor, patient and request before privileged Storage access", async () => {
  const f = await fixture(); await f.send(); f.state.context.intent!.object_path = `${randomUUID()}/${f.state.context.request.pet_id}/${f.state.context.request.id}/${randomUUID()}/original`;
  let reads = 0; f.dependencies.gateway.readObject = async () => { reads++; throw new Error("Unexpected privileged read"); };
  assert.equal((await f.send("retrieve")).status, 503); assert.equal(reads, 0);
});
