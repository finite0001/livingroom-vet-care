begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('ee200000-0000-4000-8000-000000000001','email-owner@example.test','{}'),
 ('ee200000-0000-4000-8000-000000000002','email-other@example.test','{}');
update public.profiles set is_active = true where id in ('ee200000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('ee200000-0000-4000-8000-000000000001','STAFF'),('ee200000-0000-4000-8000-000000000002','STAFF');

insert into user_roles(user_id,role) values('ee200000-0000-4000-8000-000000000001','ADMIN'),('ee200000-0000-4000-8000-000000000002','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Email','Fixture',null,'client@example.test','EMAIL',null,null);
insert into conversations(client_id) values((select id from fx where k='client')) returning id as conversation_id \gset
insert into fx values('conversation',:'conversation_id');
insert into fx select k,gen_random_uuid() from unnest(array['upload','request','abandoned']) k;
set local role authenticated;
select prepare_conversation_attachment((select id from fx where k='upload'),(select id from fx where k='conversation'),'report.pdf','application/pdf',5);
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'conversation-attachment-uploads',storage_path,'{"size":5,"mimetype":"application/pdf"}' from conversation_attachment_uploads where id=(select id from fx where k='upload');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select verify_conversation_attachment((select id from fx where k='upload'),'ee200000-0000-4000-8000-000000000001',5,'application/pdf',encode(sha256(convert_to('%PDF-','UTF8')),'hex'));
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create function pg_temp.prepare_email(p_id uuid,p_scope text default 'email:test') returns jsonb language sql as $$
 select prepare_conversation_email(p_id,p_scope,(select id from fx where k='conversation'),'client@example.test','Your file','Please review',array[(select id from fx where k='upload')])
$$;
insert into data values('prepared',pg_temp.prepare_email((select id from fx where k='request')));
select is(pg_temp.prepare_email((select id from fx where k='request')),(select v from data where k='prepared'),'Exact prepare replay returns same request');
select throws_ok($$select pg_temp.prepare_email(gen_random_uuid())$$,'23505',null,'Competing prepared request rejected');
select throws_ok($$select prepare_conversation_email((select id from fx where k='request'),'email:test',(select id from fx where k='conversation'),'client@example.test','Changed','Please review',array[(select id from fx where k='upload')])$$,'23505',null,'Saved content immutable');
select throws_ok($$select prepare_conversation_email(gen_random_uuid(),'different',(select id from fx where k='conversation'),'client@example.test','Your file','Please review',array[(select id from fx where k='upload'),(select id from fx where k='upload')])$$,'23514',null,'Duplicate attachment IDs rejected');
select throws_ok($$select prepare_conversation_email(gen_random_uuid(),'different',(select id from fx where k='conversation'),'other@example.test','Your file','Please review',array[(select id from fx where k='upload')])$$,'42501',null,'Arbitrary recipient rejected');
select throws_ok($$select enqueue_conversation_email((select id from fx where k='request'),null,true)$$,'42501',null,'Uncaptured request cannot queue');
select throws_ok($$select capture_conversation_email((select id from fx where k='request'),auth.uid(),'{}')$$,'42501',null,'Staff cannot capture bytes directly');
select throws_ok($$select * from conversation_email_artifacts$$,'42501',null,'Raw payload table denied to staff');
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select read_conversation_email_review((select id from fx where k='request'))$$,'42501',null,'Other staff cannot read draft');
select throws_ok($$select pg_temp.prepare_email(gen_random_uuid(),'foreign')$$,'42501',null,'Other staff cannot use owner uploads');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into data values('payload',jsonb_build_object('from','care@example.test','reply_to','care@example.test','to',jsonb_build_array('client@example.test'),'subject','Your file','text','Please review','attachments',jsonb_build_array(jsonb_build_object('filename','report.pdf','content_type','application/pdf','content','JVBERi0='))));
select throws_ok($$select conversation_email_capture_context((select id from fx where k='request'),'ee200000-0000-4000-8000-000000000002')$$,'42501',null,'Service context still requires original actor');
select throws_ok($$select capture_conversation_email((select id from fx where k='request'),'ee200000-0000-4000-8000-000000000001',(select jsonb_set(v,'{attachments,0,content}','"JVBERng="')::text from data where k='payload'))$$,'23514',null,'Same-size changed bytes rejected');
select lives_ok($$select capture_conversation_email((select id from fx where k='request'),'ee200000-0000-4000-8000-000000000001',(select v::text from data where k='payload'))$$,'Verified bytes captured');
select lives_ok($$select capture_conversation_email((select id from fx where k='request'),'ee200000-0000-4000-8000-000000000001',(select v::text from data where k='payload'))$$,'Lost capture reply safely retried');
select throws_ok($$select capture_conversation_email((select id from fx where k='request'),'ee200000-0000-4000-8000-000000000001',(select (v||'{"text":"Changed"}')::text from data where k='payload'))$$,'23505',null,'Captured payload immutable');
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data values('review',read_conversation_email_review((select id from fx where k='request')));
select is((select v->>'captured' from data where k='review'),'true','Review reports captured bytes');
select is(read_conversation_email_attachment((select id from fx where k='request'),(select id from fx where k='upload'),(select v->>'payload_hash' from data where k='review'))#>>'{attachment,content}','JVBERi0=','Owner inspects exact captured bytes');
select throws_ok($$select read_conversation_email_attachment((select id from fx where k='request'),gen_random_uuid(),(select v->>'payload_hash' from data where k='review'))$$,'42501',null,'Unrelated attachment denied');
select throws_ok($$select read_conversation_email_attachment((select id from fx where k='request'),(select id from fx where k='upload'),repeat('b',64))$$,'42501',null,'Changed review hash denied');
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select read_conversation_email_attachment((select id from fx where k='request'),(select id from fx where k='upload'),(select v->>'payload_hash' from data where k='review'))$$,'42501',null,'Other staff cannot inspect private draft');
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select throws_ok($$select enqueue_conversation_email((select id from fx where k='request'),(select v->>'payload_hash' from data where k='review'),false)$$,'23514',null,'Explicit review required');
select throws_ok($$select enqueue_conversation_email((select id from fx where k='request'),repeat('a',64),true)$$,'42501',null,'Wrong review hash rejected');
select throws_ok($$select enqueue_communication(auth.uid(),(select id from fx where k='request'),(select id from fx where k='conversation'),'EMAIL','client@example.test','Your file','Please review',array[(select id from fx where k='upload')])$$,'23514',null,'Ordinary enqueue cannot bypass attachment review');
insert into fx select 'outbox',id from enqueue_conversation_email((select id from fx where k='request'),(select v->>'payload_hash' from data where k='review'),true);
select is((enqueue_conversation_email((select id from fx where k='request'),(select v->>'payload_hash' from data where k='review'),true)).id,(select id from fx where k='outbox'),'Queue retry returns one outbox');
select is((select count(*) from communication_outbox),1::bigint,'Exactly one message queued');
select is((select jsonb_array_length(files) from list_conversation_message_attachments(array[(select message_id from communication_outbox where id=(select id from fx where k='outbox'))])),1,'Queued message exposes one file in shared history');
select ok((select not (files->0 ? 'storage_path') from list_conversation_message_attachments(array[(select message_id from communication_outbox where id=(select id from fx where k='outbox'))])),'History omits private Storage paths');
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(read_conversation_message_attachment((select message_id from communication_outbox where id=(select id from fx where k='outbox')),(select id from fx where k='upload'),(select v->>'payload_hash' from data where k='review'))#>>'{attachment,content}','JVBERi0=','Other active staff can inspect queued message bytes');
select throws_ok($$select read_conversation_message_attachment(gen_random_uuid(),(select id from fx where k='upload'),(select v->>'payload_hash' from data where k='review'))$$,'42501',null,'Unrelated message cannot expose draft bytes');
select throws_ok($$select read_conversation_message_attachment((select message_id from communication_outbox where id=(select id from fx where k='outbox')),gen_random_uuid(),(select v->>'payload_hash' from data where k='review'))$$,'42501',null,'Unrelated upload cannot be read through queued message');
select throws_ok($$select list_conversation_message_attachments(array_fill(gen_random_uuid(),array[101]))$$,'23514',null,'History lookup is bounded');
select set_config('request.jwt.claims','{"sub":"ee200000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select resolve_message_request(auth.uid(),(select id from fx where k='request'),'email:test',false);
select pg_temp.prepare_email((select id from fx where k='abandoned'));
select resolve_message_request(auth.uid(),(select id from fx where k='abandoned'),'email:test',true);
select throws_ok($$select pg_temp.prepare_email((select id from fx where k='abandoned'))$$,'23505',null,'Abandoned request cannot be revived');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into fx select 'lease',lease_token from claim_communication();
select is(read_frozen_email_payload((select id from fx where k='outbox'),(select id from fx where k='lease'))->>'payload_text',(select v::text from data where k='payload'),'Dispatcher reads exact captured payload');
select is(read_frozen_email_payload((select id from fx where k='outbox'),(select id from fx where k='lease'))->>'artifact_kind','conversation','Dispatcher receives conversation proof requirement');
select throws_ok($$select read_frozen_email_payload((select id from fx where k='outbox'),gen_random_uuid())$$,'40001',null,'Wrong lease rejected');
-- Roll back each negative attempt so the final positive attempt uses the same real lease.
reset role;
create function pg_temp.attempt_probe(config jsonb) returns text language plpgsql security definer as $$
declare result text;begin
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  result:=(start_communication_attempt((select id from fx where k='outbox'),(select id from fx where k='lease'),config)).state;
  raise exception 'probe rollback';
 exception when raise_exception then return result;end;
end $$;
select is(pg_temp.attempt_probe('{"from":"care@example.test","reply_to":"care@example.test"}'),'failed','Missing conversation proof prevents provider attempt');
select is(pg_temp.attempt_probe(jsonb_build_object('from','changed@example.test','reply_to','care@example.test','conversation_payload_hash',(select v->>'payload_hash' from data where k='review'))),'failed','Changed sender prevents attempt');
set local role service_role;
select is((start_communication_attempt((select id from fx where k='outbox'),(select id from fx where k='lease'),jsonb_build_object('from','care@example.test','reply_to','care@example.test','conversation_payload_hash',(select v->>'payload_hash' from data where k='review')))).state,'claimed','Exact reviewed payload passes existing guard chain');
reset role;
select ok(not has_function_privilege('anon','prepare_conversation_email(uuid,text,uuid,text,text,text,uuid[])','execute'),'Anonymous preparation denied');
select ok(not has_function_privilege('authenticated','capture_conversation_email(uuid,uuid,text)','execute'),'Staff capture execution denied');
select ok(not has_function_privilege('service_role','start_communication_attempt_without_conversation(uuid,uuid,jsonb)','execute'),'Service cannot bypass new guard');
select * from finish();rollback;
