import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExactOutbox, communicationsSnapshot, communicationsSecurity } from '../../scripts/restore-rehearsal/communications-fixture.mjs';

test('restore outbox gate rejects unrelated deliveries and changed frozen rows', () => {
  const expected = [{ id:'synthetic-reviewed',payload_hash:'original',state:'pending' }];
  const evidence = { rows:{communication_outbox:expected} };
  assert.doesNotThrow(()=>assertExactOutbox(()=>JSON.stringify(expected),evidence));
  assert.doesNotThrow(()=>assertExactOutbox(()=>'[]',undefined));
  for (const actual of [[],[...expected,{id:'unexpected'}],[{...expected[0],payload_hash:'changed'}]]) {
    assert.throws(()=>assertExactOutbox(()=>JSON.stringify(actual),evidence));
  }
  assert.throws(()=>assertExactOutbox(()=>JSON.stringify(expected),undefined));
});

test('communications restore manifests include populated ledger families and storage security', () => {
  let rows = '', security = '';
  communicationsSnapshot(query=>{rows=query;return '{}';});
  communicationsSecurity(query=>{security=query;return '{}';});
  for(const table of ['conversation_attachment_uploads','conversation_email_artifacts','conversation_email_outbox_links','inbound_attachment_captures','abandoned_attachment_cleanup','communication_prepared_requests','communication_outbox']) assert.ok(rows.includes(`public.${table}`));
  assert.match(security,/pg_constraint/);assert.match(security,/storage\.buckets/);assert.match(security,/schemaname='storage'/);
});
