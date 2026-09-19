/** Synthetic restore evidence only; caller verifies the owned local project. No provider client. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { buildConversationEmailPayload } from '../../supabase/functions/_shared/conversation-email-payload.ts';
import { verifyConversationAttachmentBytes } from '../../supabase/functions/_shared/verify-conversation-attachment.ts';
import { storeIncomingOriginal } from '../../supabase/functions/_shared/inbound/store-attachment.ts';
import { createIncomingAttachmentReadHandler } from '../../supabase/functions/_shared/inbound/read-attachment.ts';
import { runAbandonedUploadCleanup } from '../../supabase/functions/_shared/abandoned-cleanup-adapter.ts';

const checked = result => { if (result.error) throw new Error('Synthetic communications RPC/Storage operation failed'); return result.data; };
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const digest = value => createHash('sha256').update(value).digest('hex');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const tables = ['conversation_attachment_uploads','conversation_email_artifacts','conversation_email_outbox_links','inbound_attachment_captures','abandoned_attachment_cleanup','communication_inbound','communication_provider_events','communication_prepared_requests','messages','communication_outbox'];
export function communicationsSnapshot(sql) {
  return JSON.parse(sql('select jsonb_object_agg(name,rows) from (' + tables.map(table => `select '${table}' name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from public.${table} t`).join(' union all ') + ') s;'));
}
export function communicationsSecurity(sql) {
  return JSON.parse(sql(`select jsonb_build_object(
    'storage_policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='storage'),
    'buckets',(select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b where id in ('conversation-attachment-uploads','inbound-attachment-originals')),
    'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'kind',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c where c.conrelid in (${tables.map(t=>`'public.${t}'::regclass`).join(',')}))
  );`));
}
async function session(config, account) {
  const client = createClient(config.API_URL, config.ANON_KEY, options);
  const data = checked(await client.auth.signInWithPassword({ email: account.email, password: account.password }));
  assert.equal(data.user.id, account.id); return { client, token: data.session.access_token };
}
const rpc = async (client, name, args) => checked(await client.rpc(name, args));
export async function seedCommunications({config,admin,sql}) {
  assert.equal(sql('select count(*) from communication_outbox'), '0', 'Existing release fixtures must not enqueue messages');
  const result = { owner: {}, other: {} };
  for (const account of [result.owner,result.other]) {
    account.email = `restore-communications-${randomUUID()}@example.test`; account.password = randomUUID()+randomUUID();
    account.id = checked(await admin.auth.admin.createUser({ email:account.email,password:account.password,email_confirm:true })).user.id;
    sql(`insert into user_roles(user_id,role) values(${quote(account.id)},'ADMIN');`);
  }
  const { client } = await session(config,result.owner);
  const saved = await rpc(client,'save_client',{p_actor_id:result.owner.id,p_client_id:null,p_expected_version:null,p_first_name:'Synthetic communications',p_last_name:'Restore',p_primary_phone:null,p_primary_email:'restore-files@example.test',p_preferred_channel:'EMAIL',p_mailing_address:null,p_housecall_address:null});
  result.clientId = (Array.isArray(saved) ? saved[0] : saved).id;
  result.conversation = await rpc(client,'ensure_active_conversation',{p_client_id:result.clientId});
  const original = Buffer.from('%PDF-1.7\nSynthetic retained communications restore original\n%%EOF');
  result.original = { size:original.length,sha256:digest(original) };
  result.upload = await rpc(client,'prepare_conversation_attachment',{p_id:randomUUID(),p_conversation_id:result.conversation.id,p_file_name:'restore-outbound.pdf',p_mime_type:'application/pdf',p_byte_length:original.length});
  checked(await client.storage.from('conversation-attachment-uploads').upload(result.upload.storage_path,original,{contentType:'application/pdf',upsert:false}));
  const stored = checked(await client.storage.from('conversation-attachment-uploads').download(result.upload.storage_path));
  const hash = await verifyConversationAttachmentBytes(stored,{mime_type:'application/pdf',byte_length:original.length});
  assert.equal(hash,result.original.sha256);
  result.upload = await rpc(admin,'verify_conversation_attachment',{p_id:result.upload.id,p_actor_id:result.owner.id,p_byte_length:original.length,p_mime_type:'application/pdf',p_sha256:hash});
  result.prepare = {p_request_id:randomUUID(),p_scope:'restore-communications',p_conversation_id:result.conversation.id,p_recipient:'restore-files@example.test',p_subject:'Synthetic retained attachment',p_body:'Reviewed fixture only; no delivery',p_attachment_ids:[result.upload.id]};
  await rpc(client,'prepare_conversation_email',result.prepare);
  const context = await rpc(admin,'conversation_email_capture_context',{p_request_id:result.prepare.p_request_id,p_actor_id:result.owner.id});
  const payload = await buildConversationEmailPayload(context,{from:'care@example.test',replyTo:'care@example.test'},async path=>checked(await client.storage.from('conversation-attachment-uploads').download(path)));
  await rpc(admin,'capture_conversation_email',{p_request_id:result.prepare.p_request_id,p_actor_id:result.owner.id,p_payload_text:payload.payload_text});
  result.review = await rpc(client,'read_conversation_email_review',{p_request_id:result.prepare.p_request_id});
  assert.equal(result.review.payload_hash,payload.payload_hash);
  result.queued = await rpc(client,'enqueue_conversation_email',{p_request_id:result.prepare.p_request_id,p_reviewed_payload_hash:payload.payload_hash,p_attest:true});
  result.payloadHash = payload.payload_hash;
  result.review = await rpc(client,'read_conversation_email_review',{p_request_id:result.prepare.p_request_id});

  // Synthetic matched inbound metadata substitutes for the provider event only.
  // Claim, actual private Storage write/readback and finalization use production RPCs.
  result.inbound = {id:randomUUID(),message:randomUUID(),event:randomUUID(),email:randomUUID(),attachment:randomUUID()};
  const i=result.inbound; i.metadata={id:i.attachment,filename:'restore-inbound.pdf',content_type:'application/pdf',size:original.length};
  sql(`begin;
    insert into messages(id,conversation_id,type,sender_type,content,is_internal) values(${quote(i.message)},${quote(result.conversation.id)},'EMAIL','CLIENT','Synthetic incoming restore file',false);
    insert into communication_provider_events(id,provider,event_id,resource_id,event_type,payload_hash,metadata,state) values(${quote(i.event)},'resend',${quote(i.event)},${quote(i.email)},'inbound',repeat('a',64),'{}','processed');
    insert into communication_inbound(id,provider,resource_id,event_id,channel,sender,recipient,body,attachment_metadata,occurred_at,client_id,conversation_id,message_id) values(${quote(i.id)},'resend',${quote(i.email)},${quote(i.event)},'EMAIL','restore-files@example.test','care@example.test','Synthetic incoming restore file',${quote(JSON.stringify([i.metadata]))}::jsonb,now(),${quote(result.clientId)},${quote(result.conversation.id)},${quote(i.message)});commit;`);
  const claim = await rpc(admin,'claim_inbound_attachment',{p_inbound_id:i.id,p_attachment_id:i.attachment,p_version:1,p_actor_id:result.owner.id});
  assert.ok(claim.lease && !claim.ready); result.lease=claim.lease;
  await storeIncomingOriginal(admin.storage.from('inbound-attachment-originals'),claim.lease.storage_path,{bytes:original,mimeType:'application/pdf',filename:i.metadata.filename,sha256:hash});
  result.incoming = await rpc(admin,'finalize_inbound_attachment',{p_id:claim.lease.id,p_actor_id:result.owner.id,p_token:claim.lease.token,p_sha256:hash,p_byte_length:original.length,p_mime_type:'application/pdf'});

  // Historical unverified upload is fixture setup (same approach as the existing
  // cleanup Auth harness); its immutable created_at must predate the real grace.
  const abandonedId=randomUUID(), abandonedPath=`${result.owner.id}/${result.conversation.id}/${abandonedId}/original`;
  sql(`insert into conversation_attachment_uploads(id,actor_id,conversation_id,file_name,mime_type,byte_length,storage_path,created_at) values(${quote(abandonedId)},${quote(result.owner.id)},${quote(result.conversation.id)},'restore-cleaned.pdf','application/pdf',${original.length},${quote(abandonedPath)},now()-interval '8 days');`);
  result.abandoned=JSON.parse(sql(`select to_jsonb(u) from conversation_attachment_uploads u where id=${quote(abandonedId)};`));
  checked(await client.storage.from('conversation-attachment-uploads').upload(result.abandoned.storage_path,original,{contentType:'application/pdf',upsert:false}));
  // Explicit fixture-only clock aging; no grace override in cleanup production path.
  sql(`update storage.objects set created_at=now()-interval '8 days' where bucket_id='conversation-attachment-uploads' and name=${quote(result.abandoned.storage_path)};`);
  await rpc(client,'abandon_conversation_attachment',{p_id:result.abandoned.id});
  result.cleanup = await runAbandonedUploadCleanup(admin,result.abandoned.id,168);
  assert.equal(result.cleanup.status,'complete');
  result.cleanupRow=JSON.parse(sql(`select to_jsonb(c) from abandoned_attachment_cleanup c where id=${quote(result.cleanup.id)};`));
  result.rows=communicationsSnapshot(sql); result.security=communicationsSecurity(sql);
  assert.equal(result.rows.communication_outbox.length,1);
  assert.equal(result.rows.communication_outbox[0].id,result.queued.id);
  for (const t of tables.slice(0,5)) assert.ok(result.rows[t].length>0,`${t} must be populated`);
  return result;
}

export async function verifyCommunications({config,admin,sql,evidence}) {
  const e=evidence;
  assert.deepEqual(communicationsSnapshot(sql),e.rows,'Exact populated communications rows restored before access');
  assert.deepEqual(communicationsSecurity(sql),e.security,'Communications constraints, private buckets and Storage policies restored');
  const owner=await session(config,e.owner),other=await session(config,e.other);
  const anonymous=createClient(config.API_URL,config.ANON_KEY,options);
  const assertBytes=async blob=>{const bytes=Buffer.from(await blob.arrayBuffer());assert.equal(bytes.length,e.original.size);assert.equal(digest(bytes),e.original.sha256);};
  await assertBytes(checked(await owner.client.storage.from('conversation-attachment-uploads').download(e.upload.storage_path)));
  for(const client of [other.client,anonymous]) assert.ok((await client.storage.from('conversation-attachment-uploads').download(e.upload.storage_path)).error);
  for(const client of [owner.client,other.client,anonymous]) assert.ok((await client.storage.from('inbound-attachment-originals').download(e.lease.storage_path)).error);
  assert.ok((await owner.client.storage.from('conversation-attachment-uploads').upload(e.upload.storage_path,new Uint8Array([1]),{upsert:true})).error);
  const removed=await owner.client.storage.from('conversation-attachment-uploads').remove([e.upload.storage_path]);
  assert.ok(removed.error || removed.data?.length===0); await assertBytes(checked(await owner.client.storage.from('conversation-attachment-uploads').download(e.upload.storage_path)));
  assert.deepEqual(await rpc(owner.client,'read_conversation_email_review',{p_request_id:e.prepare.p_request_id}),e.review);
  assert.deepEqual(await rpc(owner.client,'enqueue_conversation_email',{p_request_id:e.prepare.p_request_id,p_reviewed_payload_hash:e.payloadHash,p_attest:true}),e.queued);
  for(const client of [other.client,anonymous]) assert.ok((await client.rpc('read_conversation_email_attachment',{p_request_id:e.prepare.p_request_id,p_upload_id:e.upload.id,p_payload_hash:e.payloadHash})).error);
  const fileArgs={p_message_id:e.queued.message_id,p_upload_id:e.upload.id,p_payload_hash:e.payloadHash};
  for(const client of [owner.client,other.client]) {
    const file=await rpc(client,'read_conversation_message_attachment',fileArgs);
    assert.equal(file.message_id,e.queued.message_id);assert.equal(file.payload_hash,e.payloadHash);
    await assertBytes(new Blob([Buffer.from(file.attachment.content,'base64')]));
  }
  assert.ok((await anonymous.rpc('read_conversation_message_attachment',fileArgs)).error);
  assert.ok((await owner.client.rpc('read_conversation_message_attachment',{...fileArgs,p_message_id:randomUUID()})).error);
  let readTrace=[];
  // The production handler deliberately hides internal failures behind404. This
  // fixture records only bounded status/shape facts, never tokens/IDs/paths/SQL.
  const reader=createIncomingAttachmentReadHandler({
    authenticate:async token=>{
      const {data,error}=await admin.auth.getUser(token);
      readTrace.push({stage:'auth',accepted:!error&&Boolean(data.user)});
      return error?null:data.user?.id??null;
    },
    authorize:async(actor,capture,message)=>{
      const result=await admin.rpc('authorize_inbound_attachment_read',{p_actor_id:actor,p_capture_id:capture,p_message_id:message});
      readTrace.push({stage:'authorize',error_code:result.error&&/^[A-Z0-9]{5}$/.test(result.error.code??'')?result.error.code:null,
        accepted:!result.error,id_matches:result.data?.id===capture,message_matches:result.data?.message_id===message,
        expected_mime:result.data?.mime_type==='application/pdf',expected_size:result.data?.byte_length===e.original.size,
        expected_hash:result.data?.sha256===e.original.sha256,filename_valid:result.data?.filename===e.inbound.metadata.filename});
      return checked(result);
    },
    download:async path=>{
      const result=await admin.storage.from('inbound-attachment-originals').download(path);
      const blob=result.data;
      readTrace.push({stage:'download',accepted:!result.error,error_status:/^[0-9]{3}$/.test(String(result.error?.statusCode??''))?Number(result.error.statusCode):null,
        expected_mime:blob?.type==='application/pdf',octet_stream:blob?.type==='application/octet-stream',expected_size:blob?.size===e.original.size,
        expected_hash:blob?digest(Buffer.from(await blob.arrayBuffer()))===e.original.sha256:false});
      return checked(result);
    },
  });
  const request=(token,message=e.inbound.message)=>new Request('http://127.0.0.1/restore-read',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({capture_id:e.incoming.id,message_id:message})});
  for(const user of [owner,other]) {readTrace=[];const response=await reader(request(user.token));assert.equal(response.status,200,'Restored incoming read stages: '+JSON.stringify(readTrace));await assertBytes(await response.blob());}
  assert.equal((await reader(request(owner.token,randomUUID()))).status,404);
  assert.equal((await reader(request('not-a-token'))).status,401);
  const recovered=await rpc(admin,'claim_inbound_attachment',{p_inbound_id:e.inbound.id,p_attachment_id:e.inbound.attachment,p_version:1,p_actor_id:e.owner.id});
  assert.deepEqual(recovered.ready,e.incoming);
  assert.ok((await admin.storage.from('conversation-attachment-uploads').download(e.abandoned.storage_path)).error,'Cleaned object stays absent after restore');
  assert.deepEqual(await rpc(admin,'finalize_abandoned_attachment_cleanup',{p_id:e.cleanupRow.id,p_token:e.cleanupRow.token}),e.cleanup);
  const tombstone = await rpc(owner.client,'prepare_conversation_attachment',{p_id:e.abandoned.id,p_conversation_id:e.conversation.id,p_file_name:'restore-cleaned.pdf',p_mime_type:'application/pdf',p_byte_length:e.original.size});
  assert.equal(tombstone.status,'abandoned','Original UUID recovers terminal abandonment');
  assert.ok((await owner.client.storage.from('conversation-attachment-uploads').upload(e.abandoned.storage_path,new Uint8Array([1]),{contentType:'application/pdf',upsert:false})).error,'Abandoned UUID cannot acquire replacement bytes');
  assert.deepEqual(communicationsSnapshot(sql),e.rows,'Access and exact retries cannot change restored communications evidence or outbox inventory');
  return {populated_tables:tables.slice(0,5),outbox_rows:e.rows.communication_outbox.length,original_bytes_verified:2,reviewed_payload_hash:e.payloadHash,cleanup_completion_recovered:true,access_boundaries_verified:true,provider_requests:0};
}

export function assertExactOutbox(sql, evidence) {
  const actual=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(o) order by to_jsonb(o)::text),'[]') from communication_outbox o;"));
  assert.deepEqual(actual,evidence?.rows.communication_outbox ?? [],'Full outbox must equal the exact reviewed synthetic inventory; no unrelated deliveries');
}
