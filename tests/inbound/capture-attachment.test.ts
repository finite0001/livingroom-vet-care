import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundAttachmentCaptureHandler, type InboundCaptureDependencies, type InboundCaptureLease, type InboundCaptureReceipt } from '../../supabase/functions/_shared/inbound/capture-attachment.ts';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const lease: InboundCaptureLease = { id, inbound_id: id, attachment_id: id, message_id: id, inbound_version: 1, actor_id: id, email_id: id, token: id,
    storage_path: `${id}/${id}/${id}/original`, metadata: { id, filename: 'file.pdf', content_type: 'application/pdf', size: 5 } };
  const ready: InboundCaptureReceipt = { id, inbound_id: id, attachment_id: id, message_id: id, inbound_version: 1, status: 'ready', sha256: 'a'.repeat(64), byte_length: 5, mime_type: 'application/pdf' };
  let reads = 0; let writes = 0; let finals = 0;
  const deps: InboundCaptureDependencies = {
    authenticate: async () => id,
    claim: async () => ({ ready: null, lease }),
    retrieve: async () => { reads++; return { bytes: new TextEncoder().encode('%PDF-'), filename: 'file.pdf', mimeType: 'application/pdf', sha256: ready.sha256 }; },
    store: async path => { assert.equal(path, lease.storage_path); writes++; },
    finalize: async () => { finals++; return ready; },
  };
  return { lease, ready, deps, counts: () => [reads, writes, finals] };
}
const request = (body: unknown = { inbound_id: id, attachment_id: id, version: 1 }) => new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer staff' }, body: JSON.stringify(body) });
test('capture publishes only a confirmed exact message-bound receipt', async () => {
  const f = fixture(); const response = await createInboundAttachmentCaptureHandler(f.deps)(request());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), f.ready); assert.deepEqual(f.counts(), [1, 1, 1]);
});
test('already captured retry returns durable receipt without another download or write', async () => {
  const f = fixture(); f.deps.claim = async () => ({ ready: f.ready, lease: null });
  assert.equal((await createInboundAttachmentCaptureHandler(f.deps)(request())).status, 200);
  assert.deepEqual(f.counts(), [0, 0, 0]);
});
test('browser cannot supply a URL, actor or incomplete identity', async () => {
  for (const input of [{ inbound_id: id, attachment_id: id, version: 1, url: 'https://evil.test' }, { inbound_id: id, attachment_id: id, version: 0 }]) {
    const f = fixture(); assert.equal((await createInboundAttachmentCaptureHandler(f.deps)(request(input))).status, 400); assert.deepEqual(f.counts(), [0, 0, 0]);
  }
});
test('changed actor, association, version or path prevents provider retrieval', async () => {
  for (const change of [{ actor_id: other }, { message_id: 'invalid' }, { inbound_id: other }, { inbound_version: 2 }, { storage_path: 'arbitrary' }]) {
    const f = fixture(); Object.assign(f.lease, change);
    assert.equal((await createInboundAttachmentCaptureHandler(f.deps)(request())).status, 503); assert.deepEqual(f.counts(), [0, 0, 0]);
  }
});
test('lost or mismatched finalization does not claim success or expose private errors', async () => {
  for (const change of [null, { id: other }, { message_id: other }, { sha256: 'b'.repeat(64) }]) {
    const f = fixture(); f.deps.finalize = async () => change === null ? null : { ...f.ready, ...change };
    assert.equal((await createInboundAttachmentCaptureHandler(f.deps)(request())).status, 503);
  }
  const f = fixture(); f.deps.finalize = async () => { throw new Error('private signed URL'); };
  const response = await createInboundAttachmentCaptureHandler(f.deps)(request());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private signed URL/);
});
test('lost finalization reply recovers committed evidence on the next request', async () => {
  const f = fixture(); let committed = false;
  f.deps.finalize = async () => { committed = true; throw new Error('Lost response'); };
  f.deps.claim = async () => committed ? { ready: f.ready, lease: null } : { ready: null, lease: f.lease };
  const handler = createInboundAttachmentCaptureHandler(f.deps);
  assert.equal((await handler(request())).status, 503); assert.equal((await handler(request())).status, 200);
  assert.deepEqual(f.counts().slice(0, 2), [1, 1]);
});
