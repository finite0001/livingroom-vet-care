import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConversationEmailReview } from '../../src/hub/features/communications/conversation-email-review.ts';
const id = '11111111-1111-4111-8111-111111111111';
const file = '22222222-2222-4222-8222-222222222222';
const expected = { requestId: id, conversationId: id };
function fixture() { return { request_id: id, captured: true, status: 'prepared', payload_hash: 'a'.repeat(64), receipt: null,
  payload: { conversation_id: id, channel: 'EMAIL', to: 'client@example.test', subject: 'File', body: 'Review', attachment_ids: [file] },
  attachment_manifest: [{ upload_id: file, file_name: 'report.pdf', mime_type: 'application/pdf', byte_length: 5, sha256: 'b'.repeat(64), storage_path: 'private/path' }] }; }
test('review exposes exact saved content and file facts without private storage paths', () => {
  const result = parseConversationEmailReview(fixture(), expected);
  assert.equal(result.payloadHash, 'a'.repeat(64)); assert.equal(result.files[0].name, 'report.pdf');
  assert.equal('storage_path' in result.files[0], false); assert.equal(result.receipt, null);
});
test('rejects wrong request/conversation, incomplete capture and abandoned request', () => {
  for (const value of [null, {}, { ...fixture(), request_id: file }, { ...fixture(), captured: false },
    { ...fixture(), status: 'abandoned' }, { ...fixture(), payload_hash: null },
    { ...fixture(), payload: { ...fixture().payload, conversation_id: file } }])
    assert.throws(() => parseConversationEmailReview(value, expected));
});
test('rejects missing, reordered, duplicate or malformed file evidence', () => {
  for (const value of [{ ...fixture(), attachment_manifest: [] },
    { ...fixture(), attachment_manifest: [{ ...fixture().attachment_manifest[0], upload_id: id }] },
    { ...fixture(), attachment_manifest: [{ ...fixture().attachment_manifest[0], byte_length: 0 }] },
    { ...fixture(), attachment_manifest: [{ ...fixture().attachment_manifest[0], sha256: '' }] },
    { ...fixture(), payload: { ...fixture().payload, attachment_ids: [file, file] }, attachment_manifest: [fixture().attachment_manifest[0], fixture().attachment_manifest[0]] }])
    assert.throws(() => parseConversationEmailReview(value, expected));
});
test('queued recovery requires an exact complete receipt', () => {
  const receipt = { success: true, queued: true, outbox_id: id, message_id: file, state: 'pending' };
  assert.deepEqual(parseConversationEmailReview({ ...fixture(), status: 'acknowledged', receipt }, expected).receipt, receipt);
  for (const value of [{ ...fixture(), status: 'acknowledged' }, { ...fixture(), receipt: {} },
    { ...fixture(), receipt: { ...receipt, queued: false } }, { ...fixture(), receipt: { ...receipt, outbox_id: '' } }])
    assert.throws(() => parseConversationEmailReview(value, expected));
});
