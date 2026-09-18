import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureConversationEmailHandler, type ConversationEmailCaptureDependencies, type ConversationEmailCaptureContext } from '../../supabase/functions/_shared/capture-conversation-email.ts';
import { sha256Hex } from '../../supabase/functions/_shared/release-email-payload.ts';
const actor = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const upload = '33333333-3333-4333-8333-333333333333';
const bytes = new TextEncoder().encode('%PDF-original');
function request(body: unknown = { id }) { return new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer staff' }, body: JSON.stringify(body) }); }
async function fixture() {
  const context: ConversationEmailCaptureContext = { request_id: id, actor_id: actor, captured: false,
    payload: { conversation_id: id, channel: 'EMAIL', to: 'client@example.com', subject: 'File', body: 'Review', attachment_ids: [upload] },
    manifest: [{ upload_id: upload, file_name: 'file.pdf', mime_type: 'application/pdf', byte_length: bytes.length, sha256: await sha256Hex(bytes), storage_path: `${actor}/${id}/${upload}/original` }] };
  let capturedHash = ''; let captures = 0; let downloads = 0;
  const auth = { actorId: actor, download: async () => { downloads++; return new Blob([bytes], { type: 'application/pdf' }); },
    readReview: async (): Promise<unknown> => ({ request_id: id, captured: context.captured, status: 'prepared', payload_hash: capturedHash }) };
  const deps: ConversationEmailCaptureDependencies = {
    authenticate: async () => auth, context: async () => context,
    capture: async (requestId, actorId, text) => { assert.equal(requestId, id); assert.equal(actorId, actor); captures++; capturedHash = await sha256Hex(new TextEncoder().encode(text)); context.captured = true; },
    sender: () => ({ from: 'staff@example.com', replyTo: 'reply@example.com' }),
  };
  return { context, auth, deps, counts: () => ({ captures, downloads }) };
}
test('captures owned bytes and returns confirmed review without queueing', async () => {
  const f = await fixture(); const response = await createCaptureConversationEmailHandler(f.deps)(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).captured, true);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(f.counts(), { captures: 1, downloads: 1 });
});
test('recovers successful capture after lost response without rebuilding from new sender', async () => {
  const f = await fixture(); const capture = f.deps.capture;
  f.deps.capture = async (...args) => { await capture(...args); throw new Error('lost receipt'); };
  const handler = createCaptureConversationEmailHandler(f.deps);
  assert.equal((await handler(request())).status, 503);
  f.deps.sender = () => { throw new Error('Changed configuration must not rebuild saved bytes'); };
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(f.counts(), { captures: 1, downloads: 1 });
});
test('rejects unsigned, unauthenticated and browser-supplied payloads', async () => {
  const f = await fixture(); const handler = createCaptureConversationEmailHandler(f.deps);
  assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 401);
  assert.equal((await handler(request({ id, recipient: 'other@example.com' }))).status, 400);
  assert.equal((await handler(request({ id: 'x'.repeat(2000) }))).status, 400);
  f.deps.authenticate = async () => null;
  assert.equal((await handler(request())).status, 401);
  assert.deepEqual(f.counts(), { captures: 0, downloads: 0 });
});
test('rejects foreign or mismatched saved requests before touching files', async () => {
  for (const field of ['actor_id', 'request_id'] as const) {
    const f = await fixture(); f.context[field] = upload;
    assert.equal((await createCaptureConversationEmailHandler(f.deps)(request())).status, 403);
    assert.deepEqual(f.counts(), { captures: 0, downloads: 0 });
  }
});
test('changed same-size bytes never reach capture', async () => {
  const f = await fixture(); f.auth.download = async () => new Blob(['%PDF-modified'], { type: 'application/pdf' });
  assert.equal((await createCaptureConversationEmailHandler(f.deps)(request())).status, 503);
  assert.equal(f.counts().captures, 0);
});
test('rejects mismatched capture acknowledgment and lost staff access', async () => {
  for (const review of [null, { request_id: upload, captured: true, payload_hash: 'a'.repeat(64) },
    { request_id: id, captured: true, payload_hash: 'a'.repeat(64) }]) {
    const f = await fixture(); f.auth.readReview = async () => review;
    assert.equal((await createCaptureConversationEmailHandler(f.deps)(request())).status, 503);
  }
  const f = await fixture(); f.auth.readReview = async () => { throw new Error('Staff revoked'); };
  const response = await createCaptureConversationEmailHandler(f.deps)(request());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /Staff revoked/);
});

test('abandoned capture cannot return a successful review', async () => {
  const f = await fixture(); const read = f.auth.readReview;
  f.auth.readReview = async () => ({ ...await read() as Record<string, unknown>, status: 'abandoned' });
  assert.equal((await createCaptureConversationEmailHandler(f.deps)(request())).status, 503);
});
