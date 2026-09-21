begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('ee300000-0000-4000-8000-000000000001','inbound-capture@example.test','{}');
update public.profiles set is_active = true where id in ('ee300000-0000-4000-8000-000000000001');
insert into public.user_roles (user_id, role) values ('ee300000-0000-4000-8000-000000000001','STAFF');

insert into user_roles(user_id,role) values('ee300000-0000-4000-8000-000000000001','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
select set_config('request.jwt.claims','{"sub":"ee300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Incoming','Fixture',null,'client@example.test','EMAIL',null,null);
insert into fx select k,gen_random_uuid() from unnest(array['conversation','message','inbound','event','email','attachment']) k;
insert into conversations(id,client_id) values((select id from fx where k='conversation'),(select id from fx where k='client'));
insert into messages(id,conversation_id,type,sender_type,content,is_internal) values((select id from fx where k='message'),(select id from fx where k='conversation'),'EMAIL','CLIENT','File attached',false);
insert into communication_provider_events(id,provider,event_id,resource_id,event_type,payload_hash,metadata,state)
 values((select id from fx where k='event'),'resend','synthetic-incoming-capture',(select id::text from fx where k='email'),'inbound',repeat('a',64),'{}','processed');
insert into communication_inbound(id,provider,resource_id,event_id,channel,sender,recipient,body,attachment_metadata,occurred_at,client_id,conversation_id,message_id)
 values((select id from fx where k='inbound'),'resend',(select id::text from fx where k='email'),(select id from fx where k='event'),'EMAIL','client@example.test','care@example.test','File attached',
 jsonb_build_array(jsonb_build_object('id',(select id from fx where k='attachment'),'filename','file.pdf','content_type','application/pdf','size',5)),now(),
 (select id from fx where k='client'),(select id from fx where k='conversation'),(select id from fx where k='message'));
set local role authenticated;
select throws_ok($$select claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),1,auth.uid())$$,'42501',null,'Staff cannot invoke privileged claim directly');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),2,'ee300000-0000-4000-8000-000000000001')$$,'42501',null,'Stale inbound version rejected');
select throws_ok($$select claim_inbound_attachment((select id from fx where k='inbound'),gen_random_uuid(),1,'ee300000-0000-4000-8000-000000000001')$$,'23514',null,'Unlisted attachment rejected');
insert into data values('claim',claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),1,'ee300000-0000-4000-8000-000000000001'));
select is((select v#>>'{lease,message_id}' from data where k='claim'),(select id::text from fx where k='message'),'Claim binds current reviewed message');
select throws_ok($$select claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),1,'ee300000-0000-4000-8000-000000000001')$$,'40001',null,'Live lease prevents competing capture');
select throws_ok($$select finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='claim'),'ee300000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('b',64),5,'application/pdf')$$,'42501',null,'Wrong lease cannot finalize');
select throws_ok($$select finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='claim'),'ee300000-0000-4000-8000-000000000001',(select (v#>>'{lease,token}')::uuid from data where k='claim'),repeat('b',64),5,'application/pdf')$$,'23514',null,'No artifact published without stored object');
-- Reclaim a stalled attempt without allowing its old worker to publish.
reset role;
update inbound_attachment_captures set lease_expires_at=clock_timestamp()-interval '1 second'
 where id=(select (v#>>'{lease,id}')::uuid from data where k='claim');
set local role service_role;
select throws_ok($$select finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='claim'),'ee300000-0000-4000-8000-000000000001',(select (v#>>'{lease,token}')::uuid from data where k='claim'),repeat('b',64),5,'application/pdf')$$,'40001',null,'Expired worker cannot finalize');
insert into data values('expired-claim',(select v from data where k='claim'));
update data set v=claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),1,'ee300000-0000-4000-8000-000000000001') where k='claim';
select is((select v#>>'{lease,id}' from data where k='claim'),(select v#>>'{lease,id}' from data where k='expired-claim'),'Reclaim retains the capture identity');
select isnt((select v#>>'{lease,token}' from data where k='claim'),(select v#>>'{lease,token}' from data where k='expired-claim'),'Reclaim issues a fresh attempt token');
select isnt((select v#>>'{lease,storage_path}' from data where k='claim'),(select v#>>'{lease,storage_path}' from data where k='expired-claim'),'Reclaim isolates the replacement object path');
select throws_ok($$select finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='expired-claim'),'ee300000-0000-4000-8000-000000000001',(select (v#>>'{lease,token}')::uuid from data where k='expired-claim'),repeat('b',64),5,'application/pdf')$$,'42501',null,'Replaced worker cannot finalize under the old token');
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'inbound-attachment-originals',v#>>'{lease,storage_path}','{"size":5,"mimetype":"application/pdf"}' from data where k='claim';
set local role service_role;
insert into data values('ready',finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='claim'),'ee300000-0000-4000-8000-000000000001',(select (v#>>'{lease,token}')::uuid from data where k='claim'),repeat('b',64),5,'application/pdf'));
select is((select v->>'status' from data where k='ready'),'ready','Verified stored object finalized');
select is(claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),1,'ee300000-0000-4000-8000-000000000001')->'ready',(select v from data where k='ready'),'Lost receipt recovers same capture');
select throws_ok($$select finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='claim'),'ee300000-0000-4000-8000-000000000001',(select (v#>>'{lease,token}')::uuid from data where k='claim'),repeat('c',64),5,'application/pdf')$$,'23514',null,'Ready hash cannot change');
select is(authorize_inbound_attachment_read('ee300000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from data where k='ready'),(select id from fx where k='message'))->>'sha256',repeat('b',64),'Authorized read binds saved original hash');
select throws_ok($$select authorize_inbound_attachment_read('ee300000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from data where k='ready'),gen_random_uuid())$$,'42501',null,'Wrong message cannot read original');
reset role;
select ok(not has_function_privilege('authenticated','authorize_inbound_attachment_read(uuid,uuid,uuid)','execute'),'Staff cannot obtain privileged original path directly');
select throws_ok($$update inbound_attachment_captures set sha256=repeat('d',64)$$,'23514',null,'Ready evidence is immutable');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ee300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(list_inbound_message_attachments(array[(select id from fx where k='message')])->0->>'status','ready','Staff listing distinguishes verified originals');
select ok(not (list_inbound_message_attachments(array[(select id from fx where k='message')])->0 ? 'storage_path'),'Staff listing never exposes private Storage path');
select is(list_inbound_message_attachments(array[gen_random_uuid()]),'[]'::jsonb,'Unrelated message returns no attachment');
select throws_ok($$select list_inbound_message_attachments(array_fill(gen_random_uuid(),array[101]))$$,'23514',null,'Staff listing is bounded to 100 messages');
reset role;
update profiles set is_active=false where id='ee300000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select claim_inbound_attachment((select id from fx where k='inbound'),(select id from fx where k='attachment'),1,'ee300000-0000-4000-8000-000000000001')$$,'42501',null,'Inactive staff cannot recover original');
select throws_ok($$select authorize_inbound_attachment_read('ee300000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from data where k='ready'),(select id from fx where k='message'))$$,'42501',null,'Inactive staff cannot obtain private read context');
reset role;
select is((select public from storage.buckets where id='inbound-attachment-originals'),false,'Incoming originals bucket is private');
select ok(not has_function_privilege('authenticated','finalize_inbound_attachment(uuid,uuid,uuid,text,bigint,text)','execute'),'Staff cannot fabricate finalization');
set local role authenticated;
select throws_ok($$select list_inbound_message_attachments(array[(select id from fx where k='message')])$$,'42501',null,'Inactive staff cannot list incoming files');
reset role;
select * from finish();rollback;
