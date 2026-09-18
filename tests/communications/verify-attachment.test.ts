import assert from "node:assert/strict";
import test from "node:test";
import {
  createVerifyConversationAttachmentHandler,
  verifyConversationAttachmentBytes,
} from "../../supabase/functions/_shared/verify-conversation-attachment.ts";
const id = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222";
const blob = new Blob(["%PDF-test"], { type: "application/pdf" });
const reservation = {
  id,
  actor_id: actor,
  storage_path: `${actor}/conversation/${id}/original`,
  mime_type: "application/pdf",
  byte_length: blob.size,
  status: "uploading" as const,
};
function fixture(
  overrides: Record<string, unknown> = {},
  transform: (result: Record<string, unknown>) => unknown = (result) => result,
) {
  const calls: { name: string; value: unknown }[] = [];
  const handler = createVerifyConversationAttachmentHandler({
    authenticate: async () => ({
      actorId: actor,
      readUpload: async () => ({ ...reservation, ...overrides }),
      download: async (path) => {
        calls.push({ name: "download", value: path });
        return blob;
      },
    }),
    verify: async (args) => {
      calls.push({ name: "verify", value: args });
      return transform({
        ...reservation,
        status: "ready",
        sha256: args.p_sha256,
        verified_at: "2026-09-16T00:00:00Z",
      });
    },
  });
  const request = (input: unknown = { id }) =>
    new Request("https://local.test", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify(input),
    });
  return { handler, calls, request };
}
test("server hashes exact supported bytes and rejects claimed MIME or size mismatches", async () => {
  const hash = await verifyConversationAttachmentBytes(blob, reservation);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(
    hash,
    await verifyConversationAttachmentBytes(
      new Blob(["%PDF-best"], { type: "application/pdf" }),
      reservation,
    ),
  );
  for (
    const expected of [{ ...reservation, byte_length: 999 }, {
      ...reservation,
      mime_type: "image/png",
    }, { ...reservation, byte_length: 0 }]
  ) await assert.rejects(verifyConversationAttachmentBytes(blob, expected));
  await assert.rejects(
    verifyConversationAttachmentBytes(
      new Blob(["BAD-test!"], { type: "application/pdf" }),
      { mime_type: "application/pdf", byte_length: 9 },
    ),
  );
});
test("only the owned reservation selects the path and server hash sent to finalization", async () => {
  const f = fixture();
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].value, reservation.storage_path);
  assert.deepEqual(f.calls[1].value, {
    p_id: id,
    p_actor_id: actor,
    p_byte_length: blob.size,
    p_mime_type: "application/pdf",
    p_sha256: await verifyConversationAttachmentBytes(blob, reservation),
  });
});
test("rejects client-supplied hash/path fields before download", async () => {
  for (
    const input of [
      { id, sha256: "a".repeat(64) },
      { id, path: "other/file" },
      [],
      { id: "invalid" },
    ]
  ) {
    const f = fixture();
    assert.equal((await f.handler(f.request(input))).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
test("foreign and abandoned reservations cannot fetch bytes or finalize", async () => {
  for (
    const [overrides, status] of [[{ actor_id: "other" }, 403], [{
      status: "abandoned",
    }, 409]] as const
  ) {
    const f = fixture(overrides);
    assert.equal((await f.handler(f.request())).status, status);
    assert.equal(f.calls.length, 0);
  }
});
test("mismatched bytes do not reach trusted finalization", async () => {
  const f = fixture({ byte_length: 900 });
  assert.equal((await f.handler(f.request())).status, 422);
  assert.deepEqual(f.calls.map((x) => x.name), ["download"]);
});
test("missing bearer token and oversized request cannot cause downloads", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(
      new Request("https://local.test", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    )).status,
    401,
  );
  assert.equal(
    (await f.handler(f.request({ id, padding: "x".repeat(2000) }))).status,
    413,
  );
  assert.equal(f.calls.length, 0);
});

test("missing or mismatched finalization receipts remain unconfirmed", async () => {
  const changes: Array<(result: Record<string, unknown>) => unknown> = [
    () => null,
    () => [],
    () => ({}),
    (result) => ({ ...result, id: actor }),
    (result) => ({ ...result, actor_id: id }),
    (result) => ({ ...result, status: "uploading" }),
    (result) => ({ ...result, sha256: "a".repeat(64) }),
    (result) => ({ ...result, byte_length: 1 }),
    (result) => ({ ...result, mime_type: "image/png" }),
    (result) => ({ ...result, storage_path: "other/object" }),
    (result) => ({ ...result, verified_at: null }),
  ];
  for (const change of changes) {
    const f = fixture({}, change);
    assert.equal((await f.handler(f.request())).status, 503);
    assert.deepEqual(f.calls.map((call) => call.name), ["download", "verify"]);
  }
});
test("lost finalization acknowledgment remains recoverable", async () => {
  const f = fixture({}, () => {
    throw new Error("lost acknowledgment");
  });
  const response = await f.handler(f.request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Retry the same upload/);
});
