import test from 'node:test';
import assert from 'node:assert/strict';
import { readCapturedConversationFile } from '../../src/hub/features/communications/conversation-email-attachment.ts';
import type { ConversationEmailReview } from '../../src/hub/features/communications/conversation-email-review.ts';
const id = '11111111-1111-4111-8111-111111111111';
async function fixture() {
  const bytes = new TextEncoder().encode('%PDF-');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
  const review: ConversationEmailReview = { requestId: id, payloadHash: 'a'.repeat(64), receipt: null,
    payload: { conversation_id: id, channel: 'EMAIL', to: 'client@example.test', subject: 'File', body: 'Review', attachment_ids: [id] },
    files: [{ uploadId: id, name: 'file.pdf', mimeType: 'application/pdf', size: 5, sha256 }] };
  const data = { request_id: id, upload_id: id, payload_hash: review.payloadHash, attachment: { filename: 'file.pdf', content_type: 'application/pdf', content: 'JVBERi0=' } };
  return { review, data };
}
test('opens exact captured bytes using request, file and reviewed hash', async () => {
  const { review, data } = await fixture();
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, 'read_conversation_email_attachment');
    assert.deepEqual(args, { p_request_id: id, p_upload_id: id, p_payload_hash: review.payloadHash });
    return { data, error: null };
  } };
  const blob = await readCapturedConversationFile(client, id, () => id, review, id);
  assert.equal(await blob.text(), '%PDF-'); assert.equal(blob.type, 'application/pdf');
});
test('changed actor before or during read cannot receive a file', async () => {
  const { review, data } = await fixture(); let actor: string | null = null; let calls = 0;
  const client = { rpc: async () => { calls++; actor = null; return { data, error: null }; } };
  await assert.rejects(readCapturedConversationFile(client, id, () => actor, review, id), /Account changed/);
  assert.equal(calls, 0); actor = id;
  await assert.rejects(readCapturedConversationFile(client, id, () => actor, review, id), /Account changed/);
});
test('wrong review receipt, metadata or same-size changed bytes are rejected', async () => {
  const { review, data } = await fixture();
  for (const changed of [{ ...data, payload_hash: 'b'.repeat(64) }, { ...data, upload_id: 'other' },
    { ...data, attachment: { ...data.attachment, filename: 'other.pdf' } },
    { ...data, attachment: { ...data.attachment, content: 'JVBERng=' } }]) {
    await assert.rejects(readCapturedConversationFile({ rpc: async () => ({ data: changed, error: null }) }, id, () => id, review, id));
  }
});
test('database failures and unrelated files do not produce a Blob', async () => {
  const { review } = await fixture(); let calls = 0;
  const client = { rpc: async () => { calls++; return { data: null, error: new Error('Access denied') }; } };
  await assert.rejects(readCapturedConversationFile(client, id, () => id, review, 'other'), /not part/);
  assert.equal(calls, 0);
  await assert.rejects(readCapturedConversationFile(client, id, () => id, review, id), /Access denied/);
});
