import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageAttachments, readMessageAttachment } from '../../src/hub/features/communications/message-attachments.ts';
const id = '11111111-1111-4111-8111-111111111111';
function row() { return { message_id: id, request_id: id, payload_hash: 'a'.repeat(64), files: [{ upload_id: id, file_name: 'file.pdf', mime_type: 'application/pdf', byte_length: 5, sha256: 'b'.repeat(64), storage_path: 'private' }] }; }
test('history returns only requested message file facts without storage paths', () => {
  const history = parseMessageAttachments([row()], [id]);
  assert.equal(history[0].messageId, id); assert.equal(history[0].files[0].name, 'file.pdf');
  assert.equal('storage_path' in history[0].files[0], false);
  assert.deepEqual(parseMessageAttachments([], [id]), []);
});
test('mismatched messages, duplicate rows and incomplete files fail closed', () => {
  for (const value of [null, [row(), row()], [{ ...row(), message_id: 'other' }],
    [{ ...row(), files: [{ ...row().files[0], sha256: '' }] }], [{ ...row(), files: [row().files[0], row().files[0]] }]])
    assert.throws(() => parseMessageAttachments(value, [id]));
});
test('shared history retrieval binds message, request, file, hash and actual bytes', async () => {
  const history = parseMessageAttachments([row()], [id])[0];
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('%PDF-')));
  history.files[0].sha256 = [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
  const data = { message_id: id, request_id: id, upload_id: id, payload_hash: history.payloadHash,
    attachment: { filename: 'file.pdf', content_type: 'application/pdf', content: 'JVBERi0=' } };
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, 'read_conversation_message_attachment');
    assert.deepEqual(args, { p_message_id: id, p_upload_id: id, p_payload_hash: history.payloadHash });
    return { data, error: null };
  } };
  assert.equal(await (await readMessageAttachment(client, id, () => id, history, id)).text(), '%PDF-');
  data.message_id = 'other';
  await assert.rejects(readMessageAttachment(client, id, () => id, history, id), /another message/);
});
