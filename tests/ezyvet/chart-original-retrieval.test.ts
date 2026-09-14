import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createHandler } from "../../supabase/functions/retrieve-reviewed-ezyvet-attachment/handler.ts";
import type { ChartOriginalContext, ChartOriginalDependencies } from "../../supabase/functions/retrieve-reviewed-ezyvet-attachment/types.ts";
import { parseAttachmentMetadataPage } from "../../supabase/functions/ezyvet-import/attachment-metadata.ts";
const bytes = new TextEncoder().encode("%PDF-1.7\nAdmitted synthetic original\n%%EOF");
async function fixture() {
  const owner = randomUUID(), actor = randomUUID(), pet = randomUUID(), id = randomUUID(), request = randomUUID();
  const metadata = { id: "701", file_id: "801", record_id: "77", record_type: "Animal" as const, mime_type: "application/pdf", name: "Original" };
  const observation = (await parseAttachmentMetadataPage({ items: [{ attachment: metadata }], meta: { items_page: 1, items_page_size: 10, items_page_total: 1, items_total: 1 } }, { animalId: "77", page: 1 })).observations[0];
  const digest = createHash("sha256").update(bytes).digest("hex");
  const state = { reads: 0, contexts: 0, authentications: 0, activeDvm: true, authorized: true, loseRole: false, replaceObject: false, corrupt: false, contextError: null as unknown, response: null as Response | null, context: {
    record: { id, action_id: randomUUID(), approved_by: owner, approved_at: "2026-09-14T10:00:00Z", pet_id: pet, client_id: randomUUID(), patient_version: 1, animal_link_id: randomUUID(), capture_id: randomUUID(), capture_request_id: request, capture_hash: "a".repeat(64), request_hash: "b".repeat(64), record_hash: "c".repeat(64), source_origin: "https://api.trial.ezyvet.com", source_site_uid: "synthetic", source_animal_id: "77", source_attachment_id: "701", source_file_id: "801", snapshot_id: randomUUID(), observed_head_version: 1, stable_metadata_sha256: observation.stable_metadata_sha256, raw_record_sha256: observation.raw_record_sha256, metadata, content_sha256: digest, mime_type: "application/pdf", file_size: bytes.length, captured_at: "2026-09-14T09:00:00Z", entry_method: "staff_reviewed_ezyvet_api_attachment_v1", source_current_at_review: false, previous_record_id: null, version: 1, kind: "original", review_reason: "Reviewed historical original" },
    original: { bucket_id: "ezyvet-attachment-originals", object_path: `${owner}/${pet}/${request}/${randomUUID()}/original`, storage_object_id: randomUUID(), content_sha256: digest, mime_type: "application/pdf", file_size: bytes.length },
  } as ChartOriginalContext };
  const dependencies: ChartOriginalDependencies = { env: key => key === "APP_URL" ? "https://thelivingroom.vet" : undefined, gateway: {
    authenticate: async bearer => { assert.equal(bearer, "synthetic-dvm"); state.authentications++; return state.authorized ? { id: actor, activeDvm: state.activeDvm && !(state.loseRole && state.authentications === 2) } : null; },
    context: async (recordId, petId, caller) => { assert.deepEqual([recordId, petId, caller], [id, pet, actor]); state.contexts++; if (state.contextError) throw state.contextError; const value = structuredClone(state.context); if (state.replaceObject && state.contexts === 2) value.original.storage_object_id = randomUUID(); return value; },
    readOriginal: async original => { state.reads++; assert.deepEqual(original, state.context.original); if (state.response) return state.response; const body = bytes.slice(); if (state.corrupt) body[12] ^= 1; return new Response(body, { headers: { "Content-Type": "application/pdf", "Content-Length": String(body.length) } }); },
  } };
  const handler = createHandler(dependencies);
  const send = (extra = {}, headers = {}) => handler(new Request("https://edge.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic-dvm", Origin: "https://thelivingroom.vet", ...headers }, body: JSON.stringify({ record_id: id, pet_id: pet, ...extra }) }));
  return { state, send, dependencies, actor, owner };
}
test("another active DVM retrieves historical admitted bytes with two authorization/context checks", async () => {
  const f = await fixture(); assert.notEqual(f.actor, f.owner); const response = await f.send(); assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes); assert.equal(f.state.authentications, 2); assert.equal(f.state.contexts, 2);
  assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(response.headers.get("Content-Disposition")!, /^attachment; filename="ezyvet-chart-original-/);
});
test("ADMIN alone or invalid JWT cannot obtain private context", async () => { const f = await fixture(); f.state.activeDvm = false; assert.equal((await f.send()).status, 403); assert.equal(f.state.contexts, 0); const g = await fixture(); g.state.authorized = false; assert.equal((await g.send()).status, 401); assert.equal(g.state.reads, 0); });
test("role loss after byte read withholds original", async () => { const f = await fixture(); f.state.loseRole = true; const r = await f.send(); assert.equal(r.status, 403); assert.equal(f.state.reads, 1); assert.equal(f.state.contexts, 1); });
test("Storage object identity change after readback withholds original", async () => { const f = await fixture(); f.state.replaceObject = true; assert.equal((await f.send()).status, 503); assert.equal(f.state.contexts, 2); });
test("same-size Storage corruption rejects before response bytes", async () => { const f = await fixture(); f.state.corrupt = true; const r = await f.send(); assert.equal(r.status, 409); assert.equal((await r.json()).error, "CHART_ORIGINAL_BYTES_CHANGED"); });
test("unknown, wrong-patient and unadmitted records return only fixed errors", async () => { const f = await fixture(); f.state.contextError = { code: "42501", message: "private/storage/path secret" }; const r = await f.send(); assert.equal(r.status, 403); assert.equal(JSON.stringify(await r.json()).includes("secret"), false); assert.equal(f.state.reads, 0); });
test("caller paths/URLs/capture IDs and noncanonical UUIDs cannot enter service context", async () => { for (const extra of [{ object_path: "bad" }, { url: "https://bad.invalid" }, { capture_id: randomUUID() }, { record_id: "not-uuid" }, { pet_id: null }]) { const f = await fixture(); assert.equal((await f.send(extra)).status, 400); assert.equal(f.state.contexts, 0); } });
test("path must bind original approver/patient/capture request and random component", async () => { for (const segment of [0, 1, 2, 3, 4]) { const f = await fixture(); const path = f.state.context.original.object_path.split("/"); path[segment] = segment === 3 ? ".." : randomUUID(); f.state.context.original.object_path = path.join("/"); assert.equal((await f.send()).status, 503); assert.equal(f.state.reads, 0); } });
test("unsafe context schemas and divergent frozen byte facts fail before Storage", async () => {
  for (const mutate of [(c: ChartOriginalContext) => { c.original.bucket_id = "patient-documents"; }, (c: ChartOriginalContext) => { c.original.content_sha256 = "f".repeat(64); }, (c: ChartOriginalContext) => { c.record.entry_method = "staff_reviewed_manual_export_v1" as never; }, (c: ChartOriginalContext) => { (c.record.metadata as unknown as Record<string, unknown>).file_download_url = "https://secret.invalid"; }, (c: ChartOriginalContext) => { c.record.stable_metadata_sha256 = "f".repeat(64); }]) {
    const f = await fixture(); mutate(f.state.context); assert.equal((await f.send()).status, 503); assert.equal(f.state.reads, 0);
  }
});
test("missing, partial, compressed, unsupported and oversized Storage responses fail closed", async () => {
  for (const response of [new Response("missing", { status: 404 }), new Response(bytes, { status: 206 }), new Response(bytes, { headers: { "Content-Encoding": "gzip" } }), new Response("<html>bad</html>"), new Response(bytes, { headers: { "Content-Length": "20971521" } })]) {
    const f = await fixture(); f.state.response = response; const r = await f.send(); assert.equal(r.status, 503); assert.equal(r.headers.get("Content-Type"), "application/json");
  }
});
test("historical replacement records do not require current source or owner role", async () => {
  const f = await fixture(); f.state.context.record.kind = "replacement"; f.state.context.record.version = 2; f.state.context.record.previous_record_id = randomUUID();
  // No live state or owner-role check in retrieval: service authorizes historical admission.
  assert.equal((await f.send()).status, 200);
});
test("cross-origin request fails before authentication", async () => { const f = await fixture(); assert.equal((await f.send({}, { Origin: "https://bad.invalid" })).status, 403); assert.equal(f.state.authentications, 0); });
