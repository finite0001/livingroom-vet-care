import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversationEmailPayload, type ConversationEmailCapture } from '../../supabase/functions/_shared/conversation-email-payload.ts';
import { sha256Hex } from '../../supabase/functions/_shared/release-email-payload.ts';
const actor = '11111111-1111-4111-8111-111111111111';
const conversation = '22222222-2222-4222-8222-222222222222';
const upload = '33333333-3333-4333-8333-333333333333';
const bytes = new TextEncoder().encode('%PDF-original');
const sender = { from: 'Practice <staff@example.com>', replyTo: 'reply@example.com' };
async function fixture(): Promise<ConversationEmailCapture> {
  return { actor_id: actor, payload: { conversation_id: conversation, channel: 'EMAIL', to: 'client@example.com', subject: 'Your file', body: 'Please review.', attachment_ids: [upload] }, manifest: [{ upload_id: upload, file_name: 'report.pdf', mime_type: 'application/pdf', byte_length: bytes.length, sha256: await sha256Hex(bytes), storage_path: `${actor}/${conversation}/${upload}/original` }] };
}
const download = async () => new Blob([bytes], { type: 'application/pdf' });
test('freezes exact verified bytes, metadata and sender with a repeatable hash', async () => {
  const context = await fixture();
  const first = await buildConversationEmailPayload(context, sender, download);
  assert.deepEqual(first, await buildConversationEmailPayload(context, sender, download));
  const payload = JSON.parse(first.payload_text);
  assert.equal(payload.attachments[0].content, Buffer.from(bytes).toString('base64'));
  assert.equal(payload.attachments[0].filename, 'report.pdf');
  assert.deepEqual(payload.to, ['client@example.com']);
  assert.equal(first.payload_hash, await sha256Hex(new TextEncoder().encode(first.payload_text)));
});
test('rejects changed bytes even when size and PDF signature match', async () => {
  await assert.rejects(buildConversationEmailPayload(await fixture(), sender,
    async () => new Blob(['%PDF-modified'], { type: 'application/pdf' })), /differ/);
});
test('rejects unsupported channels, paths, duplicates and manifest order before downloading', async () => {
  for (const mutate of [
    (c: ConversationEmailCapture) => { c.payload.channel = 'SMS'; },
    (c: ConversationEmailCapture) => { c.manifest[0].storage_path = 'https://example.com/file'; },
    (c: ConversationEmailCapture) => { c.actor_id = conversation; },
    (c: ConversationEmailCapture) => { c.payload.attachment_ids = [conversation]; },
    (c: ConversationEmailCapture) => { c.payload.attachment_ids.push(upload); c.manifest.push(c.manifest[0]); },
    (c: ConversationEmailCapture) => { c.manifest[0].file_name = '../report.pdf'; },
  ]) {
    const context = await fixture(); mutate(context); let calls = 0;
    await assert.rejects(buildConversationEmailPayload(context, sender, async () => { calls++; return download(); }));
    assert.equal(calls, 0);
  }
});
test('rejects missing bytes and MIME mismatch without returning a payload', async () => {
  await assert.rejects(buildConversationEmailPayload(await fixture(), sender, async () => { throw new Error('Missing object'); }), /Missing object/);
  await assert.rejects(buildConversationEmailPayload(await fixture(), sender, async () => new Blob([bytes], { type: 'image/png' })), /reservation/);
});
test('rejects injected sender and total raw size overflow before download', async () => {
  await assert.rejects(buildConversationEmailPayload(await fixture(), { ...sender, from: 'Practice\r\nBcc: victim@example.com <staff@example.com>' }, download), /configured/);
  const context = await fixture();
  context.manifest = [upload, actor, conversation].map(id => ({ ...context.manifest[0], upload_id: id, storage_path: `${actor}/${conversation}/${id}/original`, byte_length: 10485760 }));
  context.payload.attachment_ids = context.manifest.map(file => file.upload_id);
  let calls = 0;
  await assert.rejects(buildConversationEmailPayload(context, sender, async () => { calls++; return download(); }), /twenty MiB/);
  assert.equal(calls, 0);
});
