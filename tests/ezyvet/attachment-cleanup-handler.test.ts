import test from "node:test";
import assert from "node:assert/strict";
import { createCleanupHandler, type CleanupGateway } from "../../supabase/functions/ezyvet-attachment-cleanup/handler.ts";
const uid = (n: number) => `de690000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uid(1), pet = uid(2), id = uid(3), cleanup = uid(4), lease = uid(5), requestHash = "a".repeat(64), intentHash = "b".repeat(64);
const body = { cleanup_id: cleanup, request_id: id, pet_id: pet, request_hash: requestHash };
function fixture() {
  const calls: string[] = [];
  const state = { noIntent: false, missingIntent: false, active: true, signedIn: true, enabled: true, present: true, status: "abandoned", loseDelete: false, denyDelete: false, loseComplete: false, loseClaim: false, wrongPath: false, wrongLease: false, expired: false, wrongActor: false, wrongReceipt: false, claimCode: "", absentRequest: false, claimed: false, completed: false };
  const metadata = { id: 701, record_type: "Animal", record_id: 77 };
  const intent = { request_id: id, actor_id: actor, pet_id: pet, request_hash: requestHash, intent_hash: intentHash, bucket: "ezyvet-attachments", object_path: `${actor}/${pet}/${id}/${uid(6)}/original`, content_sha256: "c".repeat(64), file_size: 37, mime_type: "application/pdf", before_metadata: metadata, after_metadata: metadata };
  const attempt = () => ({ id: cleanup, request_id: id, actor_id: actor, pet_id: pet, request_hash: requestHash, intent_hash: intentHash, lease_id: state.wrongLease ? "wrong" : lease, created_at: new Date(Date.now() - 100_000).toISOString(), lease_until: new Date(Date.now() + (state.expired ? -1000 : 90_000)).toISOString() });
  const receipt = () => ({ cleanup_id: cleanup, request_id: id, actor_id: state.wrongReceipt ? uid(99) : actor, intent_hash: intentHash, verified_absent_at: "2026-09-13T00:00:00.000Z" });
  const gateway: CleanupGateway = {
    authenticate: async () => { calls.push("auth"); return state.signedIn ? { id: actor, activeAdmin: state.active } : null; },
    rpc: async (name, args, bearer) => {
      calls.push(name);
      if (name === "recover_ezyvet_attachment_download") {
        assert.equal(bearer, "staff-jwt"); return state.absentRequest ? null : { request: { id, actor_id: state.wrongActor ? uid(99) : actor, pet_id: pet, request_hash: requestHash, status: state.status, source_context: { attachment_metadata: metadata } }, capture: state.status === "captured" ? {} : null, capture_intent: state.missingIntent ? undefined : state.noIntent ? null : intent };
      }
      if (name === "recover_ezyvet_attachment_cleanup") { assert.equal(bearer, "staff-jwt"); return state.claimed ? { attempt: attempt(), receipt: state.completed ? receipt() : null } : null; }
      assert.equal(bearer, undefined); assert.equal(args.p_actor, actor);
      if (name === "claim_ezyvet_attachment_cleanup") {
        if (state.claimCode) throw { code: state.claimCode };
        state.claimed = true;
        if (state.loseClaim) { state.loseClaim = false; throw new Error("Lost claim reply"); }
        return { attempt: attempt(), receipt: state.completed ? receipt() : null, bucket: intent.bucket, object_path: state.wrongPath ? "untrusted/original" : intent.object_path };
      }
      assert.equal(name, "complete_ezyvet_attachment_cleanup"); assert.equal(args.p_lease_id, lease); assert.equal(args.p_verified_absent, true); assert.equal(state.present, false);
      state.completed = true; if (state.loseComplete) throw new Error("Lost completion reply"); return receipt();
    },
    remove: async (path, bearer) => { calls.push("delete"); assert.equal(path, intent.object_path); assert.equal(bearer, "staff-jwt"); if (state.denyDelete) throw new Error("Denied"); state.present = false; if (state.loseDelete) throw new Error("Lost delete reply"); },
    read: async (path, bearer) => { calls.push("read"); assert.equal(path, intent.object_path); assert.equal(bearer, "staff-jwt"); return state.present ? new Response("original") : null; },
  };
  const handler = createCleanupHandler({ now: Date.now, env: key => ({ APP_ENV: "staging", APP_URL: "https://staff.example.test", EZYVET_ATTACHMENT_CLEANUP_ENABLED: state.enabled ? "true" : undefined })[key], gateway });
  const post = (payload: unknown = body, authorization = "Bearer staff-jwt", origin = "https://staff.example.test") => handler(new Request("https://worker.example.test", { method: "POST", headers: { Origin: origin, Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  return { state, calls, post, intent, gateway, handler };
}

test("cleanup deletes only reserved path with staff JWT and records verified absence", async () => {
  const f = fixture(), response = await f.post(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cleanup_id: cleanup, request_id: id, verified_absent_at: "2026-09-13T00:00:00.000Z", status: "cleanup_recorded" });
  assert.ok(f.calls.indexOf("delete") < f.calls.indexOf("read")); assert.ok(f.calls.indexOf("read") < f.calls.indexOf("complete_ezyvet_attachment_cleanup"));
});
for (const lost of ["loseDelete", "loseComplete"] as const) test(`${lost} recovers success without issuing another cleanup lease`, async () => {
  const f = fixture(); f.state[lost] = true; assert.equal((await f.post()).status, 200); assert.equal(f.calls.filter(c => c === "delete").length, 1);
});
test("lost claim leaves a durable operation that retry can complete", async () => {
  const f = fixture(); f.state.loseClaim = true; assert.equal((await f.post()).status, 503); assert.ok(!f.calls.includes("delete")); assert.equal((await f.post()).status, 200);
});
test("completed retry returns original point-in-time receipt without another delete", async () => {
  const f = fixture(); await f.post(); f.calls.length = 0; f.state.present = true;
  assert.equal((await f.post()).status, 200); assert.ok(!f.calls.includes("delete") && !f.calls.includes("read") && !f.calls.includes("claim_ezyvet_attachment_cleanup"));
});
test("denied deletion and remaining object cannot become a success receipt", async () => {
  const f = fixture(); f.state.denyDelete = true; assert.equal((await f.post()).status, 503); assert.equal(f.state.completed, false);
});
test("missing object can finish an already abandoned cleanup", async () => {
  const f = fixture(); f.state.present = false; assert.equal((await f.post()).status, 200);
});
for (const status of ["pending", "captured"]) test(`${status} request cannot be cleaned`, async () => {
  const f = fixture(); f.state.status = status; assert.equal((await f.post()).status, 409); assert.ok(!f.calls.includes("delete"));
});
for (const malformed of ["wrongPath", "wrongLease", "wrongActor"] as const) test(`${malformed} response fails before Storage access`, async () => {
  const f = fixture(); f.state[malformed] = true; assert.equal((await f.post()).status, 503); assert.ok(!f.calls.includes("delete"));
});
test("expired exact lease requires a new explicit cleanup operation", async () => {
  const f = fixture(); f.state.expired = true; const r = await f.post(); assert.equal(r.status, 409); assert.equal((await r.json()).retry_safe, false); assert.ok(!f.calls.includes("delete"));
});
test("wrong receipt cannot report cleanup success", async () => {
  const f = fixture(); f.state.wrongReceipt = true; assert.equal((await f.post()).status, 503);
});
for (const code of ["42501", "55P03", "23514"]) test(`database ${code} prevents any deletion`, async () => {
  const f = fixture(); f.state.claimCode = code; assert.equal((await f.post()).status, code === "42501" ? 403 : 409); assert.ok(!f.calls.includes("delete"));
});
test("default-off gate, inactive owner and missing request fail closed", async () => {
  const f = fixture(); f.state.enabled = false; assert.equal((await f.post()).status, 503); f.state.enabled = true; f.state.active = false; assert.equal((await f.post()).status, 403); f.state.active = true; f.state.absentRequest = true; assert.equal((await f.post()).status, 404); assert.ok(!f.calls.includes("delete"));
});
test("caller cannot select actor, bucket, path or URL", async () => {
  const f = fixture(); for (const key of ["actor", "bucket", "path", "url"]) assert.equal((await f.post({ ...body, [key]: "untrusted" })).status, 400); assert.ok(!f.calls.includes("delete"));
});
test("bad origin, bearer and oversized body cannot start cleanup", async () => {
  const f = fixture(); assert.equal((await f.post(body, "Bearer staff-jwt", "https://other.example.test")).status, 403); assert.equal((await f.post(body, "Bearer ")).status, 401); assert.equal((await f.post({ ...body, padding: "x".repeat(2049) })).status, 400); assert.ok(!f.calls.includes("delete"));
});
test("production environment cannot enable the sandbox cleanup worker", async () => {
  const f = fixture();
  const handler = createCleanupHandler({ now: Date.now, gateway: f.gateway, env: key => ({ APP_ENV: "production", APP_URL: "https://staff.example.test", EZYVET_ATTACHMENT_CLEANUP_ENABLED: "true" })[key] });
  const response = await handler(new Request("https://worker.example.test", { method: "POST", headers: { Authorization: "Bearer staff-jwt" }, body: JSON.stringify(body) }));
  assert.equal(response.status, 503); assert.ok(!f.calls.includes("delete"));
});
test("non-boolean role result cannot authorize cleanup", async () => {
  const f = fixture(); f.gateway.authenticate = async () => ({ id: actor, activeAdmin: "true" as unknown as boolean });
  assert.equal((await f.post()).status, 403); assert.ok(!f.calls.includes("delete"));
});

test("abandoned request with no reserved file is not eligible for cleanup", async () => {
  const f = fixture(); f.state.noIntent = true;
  const response = await f.post();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "CLEANUP_NOT_ELIGIBLE", retry_safe: false });
  assert.deepEqual(f.calls, ["auth", "recover_ezyvet_attachment_download"]);
  assert.equal(f.state.claimed, false); assert.equal(f.state.completed, false);
});
test("missing reservation field remains an invalid response rather than verified absence", async () => {
  const f = fixture(); f.state.missingIntent = true;
  assert.equal((await f.post()).status, 503);
  assert.deepEqual(f.calls, ["auth", "recover_ezyvet_attachment_download"]);
  assert.equal(f.state.completed, false);
});
