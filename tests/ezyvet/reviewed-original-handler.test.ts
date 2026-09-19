import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createHandler } from "../../supabase/functions/retrieve-reviewed-ezyvet-original/handler.ts";
const actor = "11111111-1111-4111-8111-111111111111",
  record = "22222222-2222-4222-8222-222222222222",
  pet = "33333333-3333-4333-8333-333333333333";
const bytes = new TextEncoder().encode("%PDF-1.4\nSynthetic original\n%%EOF");
const sha = createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const context = {
    record_id: record,
    record_hash: "a".repeat(64),
    pet_id: pet,
    request_id: record,
    capture_hash: "b".repeat(64),
    capture_owner: actor,
    intent_id: actor,
    storage_object_id: record,
    bucket_id: "ezyvet-attachment-originals",
    object_path: `${actor}/${pet}/${record}/${pet}/original`,
    content_sha256: sha,
    mime_type: "application/pdf",
    file_size: bytes.length,
  };
  const state = {
    reads: 0,
    contexts: 0,
    auth: 0,
    denied: false,
    afterDenied: false,
    signedOut: false,
    tamper: false,
    changed: false,
  };
  const handler = createHandler({
    env: () => "https://staff.example.test",
    authenticate: async () => {
      state.auth++;
      return state.signedOut && state.auth > 1 ? null : actor;
    },
    context: async () => {
      state.contexts++;
      if (state.denied || (state.afterDenied && state.contexts > 1))
        throw new Error("private failure");
      return {
        ...context,
        record_hash:
          state.changed && state.contexts > 1
            ? "c".repeat(64)
            : context.record_hash,
      };
    },
    read: async () => {
      state.reads++;
      return new Response(
        state.tamper ? bytes.map((b, i) => (i === 15 ? b + 1 : b)) : bytes,
        { headers: { "Content-Type": "application/pdf" } },
      );
    },
  });
  const request = (
    body: unknown = {
      record_id: record,
      pet_id: pet,
      capture_hash: context.capture_hash,
    },
    origin = "https://staff.example.test",
  ) =>
    new Request("https://backend.example.test/retrieve", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic", Origin: origin },
      body: JSON.stringify(body),
    });
  return { context, state, handler, request };
}
test("reviewed download verifies bytes and rechecks authorization before response", async () => {
  const f = fixture();
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("x-capture-hash"), f.context.capture_hash);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.state.contexts, 2);
  assert.equal(f.state.auth, 2);
});
test("reviewed download denies changed bytes context and revoked access after read", async () => {
  for (const option of [
    "tamper",
    "changed",
    "afterDenied",
    "signedOut",
  ] as const) {
    const f = fixture();
    f.state[option] = true;
    const response = await f.handler(f.request());
    assert.notEqual(response.status, 200);
    assert.equal(f.state.reads, 1);
    assert.doesNotMatch(
      await response.text(),
      /private failure|object_path|%PDF/,
    );
  }
});
test("reviewed download rejects arbitrary paths patient substitutions and unauthenticated input before read", async () => {
  for (const change of [
    { object_path: "../private" },
    { pet_id: actor },
    { record_id: actor },
    { capture_hash: "c".repeat(64) },
    { file_size: 20971521 },
  ]) {
    const f = fixture();
    Object.assign(f.context, change);
    const response = await f.handler(
      f.request({
        record_id: record,
        pet_id: pet,
        capture_hash: "b".repeat(64),
      }),
    );
    assert.notEqual(response.status, 200);
    assert.equal(f.state.reads, 0);
  }
  const f = fixture();
  assert.equal((await f.handler(new Request("https://backend.example.test/retrieve", {method:"POST",body:"{}"}))).status,401);
  f.state.denied=true;
  assert.equal((await f.handler(f.request())).status,403);
  assert.equal(f.state.reads,0);
  f.state.denied=false;
  assert.equal(
    (await f.handler(f.request({}, "https://other.example.test"))).status,
    403,
  );
  assert.equal(
    (
      await f.handler(
        f.request({
          record_id: record,
          pet_id: pet,
          capture_hash: f.context.capture_hash,
          path: "injected",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.handler(f.request({ padding: "x".repeat(3000) }))).status,
    400,
  );
  assert.equal(f.state.reads, 0);
});
