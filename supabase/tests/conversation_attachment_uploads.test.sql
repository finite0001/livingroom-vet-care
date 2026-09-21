begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('ee100000-0000-4000-8000-000000000001','upload-owner@example.test','{}'),
 ('ee100000-0000-4000-8000-000000000002','upload-other@example.test','{}');
update public.profiles set is_active = true where id in ('ee100000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('ee100000-0000-4000-8000-000000000001','STAFF'),('ee100000-0000-4000-8000-000000000002','STAFF');

insert into user_roles(user_id,role) values('ee100000-0000-4000-8000-000000000001','ADMIN'),('ee100000-0000-4000-8000-000000000002','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Upload','Fixture',null,null,'EMAIL',null,null);
insert into conversations(client_id) values((select id from fx where k='client')) returning id as conversation_id \gset
insert into fx values('conversation',:'conversation_id');
insert into fx select k,gen_random_uuid() from unnest(array['upload','abandon']) k;
set local role authenticated;
select lives_ok($$select prepare_conversation_attachment((select id from fx where k='upload'),(select id from fx where k='conversation'),'report.pdf','application/pdf',10)$$,'Owner reserves upload');
select is((select status from prepare_conversation_attachment((select id from fx where k='upload'),(select id from fx where k='conversation'),'report.pdf','application/pdf',10)),'uploading','Retry recovers exact reservation');
select throws_ok($$select prepare_conversation_attachment((select id from fx where k='upload'),(select id from fx where k='conversation'),'changed.pdf','application/pdf',10)$$,'23505','Upload identity already used with different metadata','Changed request cannot reuse upload ID');
select ok(conversation_attachment_storage_write((select storage_path from conversation_attachment_uploads where id=(select id from fx where k='upload'))),'Owner may upload only to reserved path');
select is(conversation_attachment_storage_write('arbitrary/path'),false,'Unreserved object denied');
select throws_ok($$select verify_conversation_attachment((select id from fx where k='upload'),auth.uid(),10,'application/pdf',repeat('a',64))$$,'42501',null,'Staff cannot assert byte verification');
select throws_ok($$update conversation_attachment_uploads set status='ready'$$,'42501',null,'Direct metadata write denied');
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from conversation_attachment_uploads),0::bigint,'Other staff cannot read draft reservation');
select throws_ok($$select prepare_conversation_attachment((select id from fx where k='upload'),(select id from fx where k='conversation'),'report.pdf','application/pdf',10)$$,'42501','Owned upload required','Other actor cannot recover upload ID');
reset role;
-- Metadata-only storage fixture. HTTP/Storage byte acceptance is a separate test.
insert into storage.objects(bucket_id,name,metadata) select 'conversation-attachment-uploads',storage_path,'{"size":10,"mimetype":"application/pdf"}' from conversation_attachment_uploads;
set local role service_role;
select is((select status from verify_conversation_attachment((select id from fx where k='upload'),'ee100000-0000-4000-8000-000000000001',10,'application/pdf',repeat('a',64))),'ready','Trusted verifier saves immutable hash');
select is((select sha256 from verify_conversation_attachment((select id from fx where k='upload'),'ee100000-0000-4000-8000-000000000001',10,'application/pdf',repeat('a',64))),repeat('a',64),'Verification retry returns same evidence');
select throws_ok($$select verify_conversation_attachment((select id from fx where k='upload'),'ee100000-0000-4000-8000-000000000001',10,'application/pdf',repeat('b',64))$$,'23514','Attachment bytes changed','Changed verified bytes rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(conversation_attachment_storage_write((select storage_path from conversation_attachment_uploads where id=(select id from fx where k='upload'))),false,'Ready upload cannot be overwritten');
select ok(conversation_attachment_storage_read((select storage_path from conversation_attachment_uploads where id=(select id from fx where k='upload'))),'Owner can read verified bytes');
select lives_ok($$select prepare_conversation_attachment((select id from fx where k='abandon'),(select id from fx where k='conversation'),'pending.png','image/png',20)$$,'Separate pending file reserved');
select is((select status from abandon_conversation_attachment((select id from fx where k='abandon'))),'abandoned','Owner abandons pending upload');
select is((select status from abandon_conversation_attachment((select id from fx where k='abandon'))),'abandoned','Abandon retry is idempotent');
select is(conversation_attachment_storage_write((select storage_path from conversation_attachment_uploads where id=(select id from fx where k='abandon'))),false,'Abandoned upload rejects late writes');
select throws_ok($$select abandon_conversation_attachment((select id from fx where k='upload'))$$,'23514','Verified attachment evidence is retained','Verified file cannot be silently discarded');
reset role;
select is((select public from storage.buckets where id='conversation-attachment-uploads'),false,'Upload bucket private');
select ok(not has_function_privilege('anon','prepare_conversation_attachment(uuid,uuid,text,text,bigint)','execute'),'Anonymous cannot reserve');
select ok(not has_function_privilege('authenticated','verify_conversation_attachment(uuid,uuid,bigint,text,text)','execute'),'Verification has no staff execution grant');
select * from finish();rollback;
