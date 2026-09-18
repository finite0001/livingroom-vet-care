import test from "node:test";
import assert from "node:assert/strict";
import { createIncomingAttachmentReadHandler, type IncomingReadContext } from "../../supabase/functions/_shared/inbound/read-attachment.ts";
const id = "11111111-1111-4111-8111-111111111111";
const message = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const blob = new Blob(["%PDF-original"], { type: "application/pdf" });
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())).toString("hex");
  const context: IncomingReadContext = { id, message_id: message, storage_path: `${id}/${message}/${id}/original`, sha256, byte_length: blob.size, mime_type: blob.type, filename: "client's report.pdf" };
  return { blob, context };
}
const request = (body: unknown = { capture_id: id, message_id: message }) => new Request("http://localhost/read", { method: "POST", headers: { Authorization: "Bearer staff" }, body: JSON.stringify(body) });
test("returns exact private bytes with no caching after two authorization checks", async () => {
  const { blob, context } = await fixture(); let authorizations = 0;
  const handler = createIncomingAttachmentReadHandler({ authenticate: async () => id, authorize: async (actor, capture, msg) => { assert.equal(actor, id); assert.equal(capture, id); assert.equal(msg, message); authorizations++; return context; }, download: async path => { assert.equal(path, context.storage_path); return blob; } });
  const result = await handler(request()); assert.equal(result.status, 200); assert.equal(await result.text(), "%PDF-original"); assert.equal(authorizations, 2);
  assert.equal(result.headers.get("Cache-Control"), "no-store"); assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(result.headers.get("Content-Disposition"), "attachment; filename*=UTF-8''client%27s%20report.pdf");
});
test("rejects a caller-supplied Storage path before authorization", async () => {
  let calls = 0; const { blob, context } = await fixture();
  const handler = createIncomingAttachmentReadHandler({ authenticate: async () => id, authorize: async () => { calls++; return context; }, download: async () => blob });
  assert.equal((await handler(request({ capture_id: id, message_id: message, storage_path: context.storage_path }))).status, 400); assert.equal(calls, 0);
});
test("revoked access during download returns no file bytes", async () => {
  const { blob, context } = await fixture(); let checks = 0;
  const handler = createIncomingAttachmentReadHandler({ authenticate: async () => id, authorize: async () => { if (++checks === 2) throw new Error("Revoked"); return context; }, download: async () => blob });
  const response = await handler(request()); assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /original|storage_path/);
});
test("changed saved association, path or hash prevents a read response", async () => {
  const { blob, context } = await fixture();
  for (const patch of [{ message_id: id }, { storage_path: `${message}/${id}/${id}/original` }, { sha256: "a".repeat(64) }]) {
    let checks = 0;
    const handler = createIncomingAttachmentReadHandler({ authenticate: async () => id, authorize: async () => ++checks === 1 ? context : { ...context, ...patch }, download: async () => blob });
    assert.equal((await handler(request())).status, 404);
  }
});
test("altered stored bytes fail before the final authorization", async () => {
  const { context } = await fixture(); let checks = 0;
  const handler = createIncomingAttachmentReadHandler({ authenticate: async () => id, authorize: async () => { checks++; return context; }, download: async () => new Blob(["%PDF-modified"], { type: context.mime_type }) });
  assert.equal((await handler(request())).status, 404); assert.equal(checks, 1);
});
test("invalid authentication prevents all private operations", async () => {
  const { blob, context } = await fixture(); let calls = 0;
  const handler = createIncomingAttachmentReadHandler({ authenticate: async () => null, authorize: async () => { calls++; return context; }, download: async () => { calls++; return blob; } });
  assert.equal((await handler(request())).status, 401); assert.equal(calls, 0);
});
