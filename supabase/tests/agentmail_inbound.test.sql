begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- AgentMail inbound (migration 20260928180000): receipts, canonical completion,
-- RFC reply threading and attachment capture leases.
insert into auth.users(id,email,raw_user_meta_data) values('a9100000-0000-4000-8000-000000000001','agentmail-staff@example.test','{}');
update public.profiles set is_active=true where id='a9100000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('a9100000-0000-4000-8000-000000000001','STAFF');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from public.save_client(auth.uid(),null,null,'AgentMail','Family','+13035551275','agentmail-family@example.test','EMAIL',null,null);
select throws_ok($$select public.receive_communication_event('agentmail','msg_forged','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718293','inbound',repeat('a',64),'{"from":"a@example.test","to":"b@example.test","inbox_id":"inbox_x","message_id":"<m@example.test>"}')$$,'42501',null,'Staff cannot forge AgentMail receipts');
reset role;
select ok(not has_function_privilege('anon','public.receive_communication_event(text,text,text,text,text,jsonb)','execute'),'Anonymous callers cannot record provider events');
select ok(not has_function_privilege('authenticated','public.complete_inbound_communication(uuid,uuid,text,text,text,text,text,text,text[],jsonb,timestamptz,text)','execute'),'Staff cannot complete inbound processing');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Two active household threads: only RFC threading can choose between them.
reset role;
insert into fx values('thread_a',gen_random_uuid()),('thread_b',gen_random_uuid());
insert into public.conversations(id,client_id) values((select id from fx where k='thread_a'),(select id from fx where k='client'));
set local role service_role;
select throws_ok($$select public.receive_communication_event('agentmail','msg_status','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718293','delivered',repeat('a',64),'{"from":"a@example.test","to":"b@example.test","inbox_id":"inbox_x","message_id":"<m@example.test>"}')$$,'23514',null,'AgentMail is receive-only for the app');
select throws_ok($$select public.receive_communication_event('agentmail','msg_bad_resource','<m@example.test>','inbound',repeat('a',64),'{"from":"a@example.test","to":"b@example.test","inbox_id":"inbox_x","message_id":"<m@example.test>"}')$$,'23514',null,'AgentMail resource must be the derived UUID');
select throws_ok($$select public.receive_communication_event('agentmail','msg_no_identity','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718293','inbound',repeat('a',64),'{"from":"a@example.test","to":"b@example.test"}')$$,'23514',null,'AgentMail receipt must carry the signed provider identity');
select throws_ok($$select public.receive_communication_event('gmail','msg_x','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718293','inbound',repeat('a',64),'{}')$$,'23514',null,'Unknown providers stay rejected');

insert into data values('meta1','{"from":"agentmail-family@example.test","to":"care@reply.example.test","inbox_id":"inbox_x","message_id":"<first@mail.example.test>","thread_id":"thd_1","event_id":"evt_1","created_at":"2026-09-27T18:00:00Z"}');
insert into fx select 'event1',id from public.receive_communication_event('agentmail','msg_1','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718291','inbound',repeat('a',64),(select v from data where k='meta1'));
select is((public.receive_communication_event('agentmail','msg_1','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718291','inbound',repeat('a',64),(select v from data where k='meta1'))).id,(select id from fx where k='event1'),'Replayed signed delivery is idempotent');
select throws_ok($$select public.receive_communication_event('agentmail','msg_1','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718291','inbound',repeat('b',64),(select v from data where k='meta1'))$$,'23505',null,'Reused delivery id with changed payload is rejected');

insert into data select 'claim1',to_jsonb(c) from public.claim_communication_event() c;
select is((select v->>'id' from data where k='claim1'),(select id::text from fx where k='event1'),'Worker claims the AgentMail receipt');
insert into fx select 'inbound1',id from public.complete_inbound_communication((select id from fx where k='event1'),(select (v->>'lease_token')::uuid from data where k='claim1'),
 'agentmail-family@example.test','care@reply.example.test','First','First reply',null,'<first@mail.example.test>','{}',
 jsonb_build_array(jsonb_build_object('id','9a0e0c4e-1c1f-8a2b-9c3d-4e5f60718291','filename','labs.pdf','content_type','application/pdf','size',5)),'2026-09-27T18:00:00Z',null);
select is((select channel from public.communication_inbound where id=(select id from fx where k='inbound1')),'EMAIL','AgentMail completes as an EMAIL inbound original');
select is((select client_id from public.communication_inbound where id=(select id from fx where k='inbound1')),(select id from fx where k='client'),'AgentMail sender links the unique household');
select is((select conversation_id from public.communication_inbound where id=(select id from fx where k='inbound1')),(select id from fx where k='thread_a'),'Single active household thread is reused');
select is((select type::text from public.messages where id=(select message_id from public.communication_inbound where id=(select id from fx where k='inbound1'))),'EMAIL','Thread entry is a client email');
select is((select state from public.communication_provider_events where id=(select id from fx where k='event1')),'processed','Receipt is processed exactly once');

-- The first thread is archived and a new one is active; the reply's References still select the original thread.
reset role;
update public.conversations set status='ARCHIVED' where id=(select id from fx where k='thread_a');
insert into public.conversations(id,client_id) values((select id from fx where k='thread_b'),(select id from fx where k='client'));
set local role service_role;
insert into data values('meta2','{"from":"agentmail-family@example.test","to":"care@reply.example.test","inbox_id":"inbox_x","message_id":"<second@mail.example.test>","created_at":"2026-09-27T18:05:00Z"}');
insert into fx select 'event2',id from public.receive_communication_event('agentmail','msg_2','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718292','inbound',repeat('c',64),(select v from data where k='meta2'));
insert into data select 'claim2',to_jsonb(c) from public.claim_communication_event() c;
insert into fx select 'inbound2',id from public.complete_inbound_communication((select id from fx where k='event2'),(select (v->>'lease_token')::uuid from data where k='claim2'),
 'agentmail-family@example.test','care@reply.example.test','Re: First','Second reply',null,'<second@mail.example.test>',array['<outbound@send.example.test>','<first@mail.example.test>'],'[]','2026-09-27T18:05:00Z',null);
select is((select conversation_id from public.communication_inbound where id=(select id from fx where k='inbound2')),(select id from fx where k='thread_a'),'RFC reply threading maps the reply to its existing conversation');
insert into data values('meta3','{"from":"agentmail-family@example.test","to":"care@reply.example.test","inbox_id":"inbox_x","message_id":"<third@mail.example.test>","created_at":"2026-09-27T18:10:00Z"}');
insert into fx select 'event3',id from public.receive_communication_event('agentmail','msg_3','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718293','inbound',repeat('d',64),(select v from data where k='meta3'));
insert into data select 'claim3',to_jsonb(c) from public.claim_communication_event() c;
insert into fx select 'inbound3',id from public.complete_inbound_communication((select id from fx where k='event3'),(select (v->>'lease_token')::uuid from data where k='claim3'),
 'agentmail-family@example.test','care@reply.example.test','New topic','Unthreaded',null,'<third@mail.example.test>','{}','[]','2026-09-27T18:10:00Z',null);
select is((select conversation_id from public.communication_inbound where id=(select id from fx where k='inbound3')),(select id from fx where k='thread_b'),'Unthreaded mail lands in the household''s active conversation');
-- Unknown sender stays in review with no household.
insert into data values('meta4','{"from":"stranger@example.test","to":"care@reply.example.test","inbox_id":"inbox_x","message_id":"<fourth@mail.example.test>","created_at":"2026-09-27T18:15:00Z"}');
insert into fx select 'event4',id from public.receive_communication_event('agentmail','msg_4','8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718294','inbound',repeat('f',64),(select v from data where k='meta4'));
insert into data select 'claim4',to_jsonb(c) from public.claim_communication_event() c;
insert into fx select 'inbound4',id from public.complete_inbound_communication((select id from fx where k='event4'),(select (v->>'lease_token')::uuid from data where k='claim4'),
 'stranger@example.test','care@reply.example.test','Hello','Who is this',null,'<fourth@mail.example.test>',array['<first@mail.example.test>'],'[]','2026-09-27T18:15:00Z',null);
select is((select client_id from public.communication_inbound where id=(select id from fx where k='inbound4')),null::uuid,'Unknown AgentMail sender is not linked, even when quoting a known thread');
select is((select review_reason from public.communication_inbound where id=(select id from fx where k='inbound4')),'Unknown or shared sender','Unknown AgentMail sender waits in the review queue');

-- Attachment capture lease carries the signed provider identity from the durable receipt.
select throws_ok($$select claim_inbound_attachment((select id from fx where k='inbound1'),'9a0e0c4e-1c1f-8a2b-9c3d-4e5f60718299',1,'a9100000-0000-4000-8000-000000000001')$$,'23514',null,'Unlisted AgentMail attachment rejected');
insert into data values('lease',claim_inbound_attachment((select id from fx where k='inbound1'),'9a0e0c4e-1c1f-8a2b-9c3d-4e5f60718291',1,'a9100000-0000-4000-8000-000000000001'));
select is((select v#>>'{lease,provider}' from data where k='lease'),'agentmail','Lease names the provider');
select is((select v#>>'{lease,provider_message_id}' from data where k='lease'),'<first@mail.example.test>','Lease carries the signed AgentMail message id');
select is((select v#>>'{lease,provider_inbox_id}' from data where k='lease'),'inbox_x','Lease carries the signed AgentMail inbox id');
select is((select v#>>'{lease,email_id}' from data where k='lease'),'8f0e0c4e-1c1f-8a2b-9c3d-4e5f60718291','Capture identity is the derived resource UUID');
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'inbound-attachment-originals',v#>>'{lease,storage_path}','{"size":5,"mimetype":"application/pdf"}' from data where k='lease';
set local role service_role;
insert into data values('ready',finalize_inbound_attachment((select (v#>>'{lease,id}')::uuid from data where k='lease'),'a9100000-0000-4000-8000-000000000001',(select (v#>>'{lease,token}')::uuid from data where k='lease'),repeat('e',64),5,'application/pdf'));
select is((select v->>'status' from data where k='ready'),'ready','AgentMail original finalizes after verified storage');
select is(authorize_inbound_attachment_read('a9100000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from data where k='ready'),(select message_id from public.communication_inbound where id=(select id from fx where k='inbound1')))->>'sha256',repeat('e',64),'Authorized read binds the AgentMail original hash');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(list_inbound_message_attachments(array[(select message_id from public.communication_inbound where id=(select id from fx where k='inbound1'))])->0->>'status','ready','Staff listing shows the captured AgentMail original');
reset role;

-- Resend receipts and Twilio remain valid providers for existing and status traffic.
select ok(exists(select 1 from pg_constraint where conname='communication_provider_events_provider_check' and pg_get_constraintdef(oid) like '%agentmail%' and pg_get_constraintdef(oid) like '%resend%' and pg_get_constraintdef(oid) like '%twilio%'),'Provider constraint lists resend, twilio and agentmail');
select * from finish();rollback;
