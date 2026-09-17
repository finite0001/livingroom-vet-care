import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const checked = (result) => {
  if (result.error) throw result.error;
  return result.data;
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const outgoingBucket = 'conversation-attachment-uploads';
const incomingBucket = 'inbound-attachment-originals';
const snapshot = (sql) => JSON.parse(sql(`select jsonb_build_object(
  'uploads',(select jsonb_agg(to_jsonb(t) order by id) from conversation_attachment_uploads t),
  'captures',(select jsonb_agg(to_jsonb(t) order by id) from inbound_attachment_captures t),
  'cleanup',(select jsonb_agg(to_jsonb(t) order by id) from abandoned_attachment_cleanup t),
  'objects',(select jsonb_agg(to_jsonb(t) order by id) from storage.objects t where bucket_id in ('${outgoingBucket}','${incomingBucket}'))
);`));

export async function seedConversationAttachments({ state, api, admin, sql }) {
  const fixture = { conversation: randomUUID(), outgoing: [], incoming: [] };
  const bytes = Buffer.from('%PDF-1.7\nSynthetic conversation restore original.\n%%EOF');
  fixture.sha256 = hash(bytes);
  fixture.byteLength = bytes.length;
  sql(`insert into conversations(id,client_id) values('${fixture.conversation}','${state.client}');`);
  for (const status of ['ready', 'uploading', 'abandoned', 'cleaned']) {
    const id = randomUUID();
    let upload;
    if (status === 'cleaned') {
      const path = `${state.user}/${fixture.conversation}/${id}/original`;
      // Only this isolated synthetic reservation is aged to exercise grace rules.
      sql(`insert into conversation_attachment_uploads(id,actor_id,conversation_id,file_name,mime_type,byte_length,storage_path,created_at)
        values('${id}','${state.user}','${fixture.conversation}','restore.pdf','application/pdf',${bytes.length},'${path}',now()-interval '8 days');`);
      upload = { id, storage_path: path };
    } else {
      upload = checked(await api.rpc('prepare_conversation_attachment', {
        p_id: id, p_conversation_id: fixture.conversation, p_file_name: 'restore.pdf',
        p_mime_type: 'application/pdf', p_byte_length: bytes.length,
      }));
    }
    checked(await api.storage.from(outgoingBucket).upload(upload.storage_path, bytes,
      { contentType: 'application/pdf', upsert: false }));
    if (status === 'ready') {
      checked(await admin.rpc('verify_conversation_attachment', {
        p_id: id, p_actor_id: state.user, p_byte_length: bytes.length,
        p_mime_type: 'application/pdf', p_sha256: fixture.sha256,
      }));
    }
    if (status === 'abandoned' || status === 'cleaned') {
      checked(await api.rpc('abandon_conversation_attachment', { p_id: id }));
    }
    if (status === 'cleaned') {
      sql(`update storage.objects set created_at=now()-interval '8 days' where bucket_id='${outgoingBucket}' and name='${upload.storage_path}';`);
      const lease = checked(await admin.rpc('claim_abandoned_attachment_cleanup', { p_upload_id: id, p_grace_hours: 168 }));
      checked(await admin.rpc('revalidate_abandoned_attachment_cleanup', { p_id: lease.id, p_token: lease.token }));
      checked(await admin.storage.from(outgoingBucket).remove([upload.storage_path]));
      const receipt = checked(await admin.rpc('finalize_abandoned_attachment_cleanup', { p_id: lease.id, p_token: lease.token }));
      fixture.cleanup = { lease, receipt };
    }
    fixture.outgoing.push({ id, path: upload.storage_path, status });
  }
  fixture.message = randomUUID();
  fixture.inbound = randomUUID();
  const event = randomUUID(), email = randomUUID();
  const metadata = ['ready', 'capturing'].map(() => ({
    id: randomUUID(), filename: 'incoming.pdf', content_type: 'application/pdf', size: bytes.length,
  }));
  sql(`begin;
    insert into messages(id,conversation_id,type,sender_type,content,is_internal)
      values('${fixture.message}','${fixture.conversation}','EMAIL','CLIENT','Synthetic restore message',false);
    insert into communication_provider_events(id,provider,event_id,resource_id,event_type,payload_hash,metadata,state)
      values('${event}','resend','${event}','${email}','inbound',repeat('a',64),'{}','processed');
    insert into communication_inbound(id,provider,resource_id,event_id,channel,sender,recipient,body,attachment_metadata,occurred_at,client_id,conversation_id,message_id)
      values('${fixture.inbound}','resend','${email}','${event}','EMAIL','restore@example.test','care@example.test','Synthetic restore message',${quote(JSON.stringify(metadata))}::jsonb,now(),'${state.client}','${fixture.conversation}','${fixture.message}');
    commit;`);
  for (const [index, meta] of metadata.entries()) {
    const { lease } = checked(await admin.rpc('claim_inbound_attachment', {
      p_inbound_id: fixture.inbound, p_attachment_id: meta.id, p_version: 1, p_actor_id: state.user,
    }));
    checked(await admin.storage.from(incomingBucket).upload(lease.storage_path, bytes,
      { contentType: 'application/pdf', upsert: false }));
    if (index === 0) {
      checked(await admin.rpc('finalize_inbound_attachment', {
        p_id: lease.id, p_actor_id: state.user, p_token: lease.token,
        p_sha256: fixture.sha256, p_byte_length: bytes.length, p_mime_type: 'application/pdf',
      }));
    }
    fixture.incoming.push({ id: lease.id, path: lease.storage_path, attachmentId: meta.id,
      status: index === 0 ? 'ready' : 'capturing' });
  }
  fixture.snapshot = snapshot(sql);
  state.conversationAttachments = fixture;
}

export async function verifyConversationAttachments({ state, api, admin, anonymous, sql }) {
  const fixture = state.conversationAttachments;
  assert.ok(fixture);
  assert.deepEqual(snapshot(sql), fixture.snapshot, 'All attachment states and Storage metadata survive restoration');
  for (const item of fixture.outgoing) {
    const bucket = admin.storage.from(outgoingBucket);
    if (item.status === 'cleaned') {
      const listed = checked(await bucket.list(item.path.slice(0, item.path.lastIndexOf('/')), { limit: 2 }));
      assert.deepEqual(listed, [], 'Cleaned file stays absent after restore');
      assert.deepEqual(checked(await admin.rpc('finalize_abandoned_attachment_cleanup', {
        p_id: fixture.cleanup.lease.id, p_token: fixture.cleanup.lease.token,
      })), fixture.cleanup.receipt, 'Completed cleanup receipt replays without a second deletion');
      continue;
    }
    const bytes = Buffer.from(await checked(await bucket.download(item.path)).arrayBuffer());
    assert.equal(bytes.length, fixture.byteLength);
    assert.equal(hash(bytes), fixture.sha256);
    const ownerRead = await api.storage.from(outgoingBucket).download(item.path);
    if (item.status === 'ready' || item.status === 'uploading') assert.equal(hash(Buffer.from(await checked(ownerRead).arrayBuffer())), fixture.sha256);
    else assert.ok(ownerRead.error, 'Abandoned file is not readable by staff');
    assert.ok((await anonymous.storage.from(outgoingBucket).download(item.path)).error);
  }
  for (const item of fixture.incoming) {
    const bytes = Buffer.from(await checked(await admin.storage.from(incomingBucket).download(item.path)).arrayBuffer());
    assert.equal(bytes.length, fixture.byteLength);
    assert.equal(hash(bytes), fixture.sha256);
    const authorization = await admin.rpc('authorize_inbound_attachment_read', {
      p_actor_id: state.user, p_capture_id: item.id, p_message_id: fixture.message,
    });
    if (item.status === 'ready') {
      const context = checked(authorization);
      assert.equal(context.storage_path, item.path);
      assert.equal(context.sha256, fixture.sha256);
    } else assert.ok(authorization.error, 'Interrupted capture remains unavailable');
    assert.ok((await api.storage.from(incomingBucket).download(item.path)).error);
    assert.ok((await anonymous.storage.from(incomingBucket).download(item.path)).error);
  }
  assert.deepEqual(snapshot(sql), fixture.snapshot, 'Recovery reads and cleanup replay preserve attachment evidence');
  return { outgoing_states: 4, incoming_states: 2, physical_originals: 5,
    exact_rows_and_bytes: true, staff_and_anonymous_boundaries: true, completed_cleanup_replay: true };
}
