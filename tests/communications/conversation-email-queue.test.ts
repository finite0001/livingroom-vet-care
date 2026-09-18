import test from 'node:test';
import assert from 'node:assert/strict';
import { withConversationEmailReview } from '../../src/hub/features/communications/conversation-email-queue.ts';
import { QueueIntentStore, type PreparedRequest, type MessageIntent, type QueueTransport, type QueueReceipt } from '../../src/hub/features/communications/queue-intent.ts';
const conversation = '11111111-1111-4111-8111-111111111111';
const upload = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const payload: MessageIntent = { conversation_id: conversation, channel: 'EMAIL', to: 'client@example.test', subject: 'File', body: 'Review', attachment_ids: [upload] };
  let saved: PreparedRequest | null = null; let queues = 0; let approved = false;
  const receipt: QueueReceipt = { success: true, queued: true, outbox_id: conversation, message_id: upload, state: 'pending' };
  const base: QueueTransport = {
    prepare: async () => { throw new Error('Plain preparation forbidden'); },
    submit: async () => { throw new Error('Plain send forbidden'); },
    recover: async () => saved,
    resolve: async () => { assert.ok(saved); return { ...saved, status: 'acknowledged' }; },
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'prepare_conversation_email') saved ??= { request_id: args.p_request_id as string, payload, status: 'prepared', receipt: null };
      if (name === 'enqueue_conversation_email') {
        assert.equal(approved, true); assert.equal(args.p_attest, true); queues++;
        assert.ok(saved); saved.receipt = receipt;
      }
      return { data: null, error: null };
    },
    functions: { invoke: async () => ({ data: { ...saved, captured: true, payload_hash: 'a'.repeat(64), attachment_manifest: [{ upload_id: upload, file_name: 'file.pdf', mime_type: 'application/pdf', byte_length: 5, sha256: 'b'.repeat(64) }] }, error: null }) },
  };
  const review = async (value: { requestId: string; payloadHash: string }) => { approved = true; return { requestId: value.requestId, payloadHash: value.payloadHash }; };
  return { payload, base, client, review, queues: () => queues, saved: () => saved };
}
test('existing request store pauses for explicit attachment approval then queues once', async () => {
  const f = fixture(); const store = new QueueIntentStore();
  const result = await store.send('scope', f.payload, withConversationEmailReview(f.base, f.client, 'scope', () => conversation, f.review));
  assert.equal(result.queued, true); assert.equal(f.queues(), 1);
});
test('closing review preserves saved request and does not enqueue', async () => {
  const f = fixture(); const store = new QueueIntentStore();
  const cancelled = withConversationEmailReview(f.base, f.client, 'scope', () => conversation, async () => { throw new Error('Review closed'); });
  await assert.rejects(store.send('scope', f.payload, cancelled), /Review closed/);
  const id = f.saved()?.request_id; assert.ok(id); assert.equal(f.queues(), 0); assert.equal(store.has('scope'), true);
  await store.send('scope', f.payload, withConversationEmailReview(f.base, f.client, 'scope', () => conversation, f.review));
  assert.equal(f.saved()?.request_id, id); assert.equal(f.queues(), 1);
});
test('changed approval hash cannot queue', async () => {
  const f = fixture(); const store = new QueueIntentStore();
  await assert.rejects(store.send('scope', f.payload, withConversationEmailReview(f.base, f.client, 'scope', () => conversation,
    async value => ({ requestId: value.requestId, payloadHash: 'c'.repeat(64) }))), /Review changed/);
  assert.equal(f.queues(), 0);
});
test('account change while reviewing prevents queueing', async () => {
  const f = fixture(); let active = true;
  const check = () => { if (!active) throw new Error('Account changed'); return conversation; };
  await assert.rejects(new QueueIntentStore().send('scope', f.payload, withConversationEmailReview(f.base, f.client, 'scope', check,
    async value => { active = false; return f.review(value); })), /Account changed/);
  assert.equal(f.queues(), 0);
});
test('lost queue response recovers the existing receipt without another enqueue', async () => {
  const f = fixture(); const original = f.client.rpc;
  f.client.rpc = async (name, args) => { const result = await original(name, args); if (name === 'enqueue_conversation_email') throw new Error('Lost response'); return result; };
  const result = await new QueueIntentStore().send('scope', f.payload, withConversationEmailReview(f.base, f.client, 'scope', () => conversation, f.review));
  assert.equal(result.queued, true); assert.equal(f.queues(), 1);
});
