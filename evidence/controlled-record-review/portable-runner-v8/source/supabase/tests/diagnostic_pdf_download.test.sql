-- Authorization/serialization only. Marker bytes are not parser or HTTP proof.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('b3300000-0000-4000-8000-000000000800','synthetic-diagnostic-staff@example.test','{}'),('b3300000-0000-4000-8000-000000000801','synthetic-diagnostic-dvm@example.test','{}'),('b3300000-0000-4000-8000-000000000802','synthetic-diagnostic-admin@example.test','{}');
update profiles set is_active=true,full_name='Synthetic diagnostic reviewer' where id::text like 'b3300000-%';
insert into user_roles(user_id,role) values('b3300000-0000-4000-8000-000000000800','STAFF'),('b3300000-0000-4000-8000-000000000801','DVM'),('b3300000-0000-4000-8000-000000000802','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Diagnostics','+13035550188','synthetic-download@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic diagnostics dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'sibling',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic diagnostics sibling','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into data values('values','{"panel_name":"Synthetic chemistry","category":"laboratory","collected_on":"2026-10-01","reported_on":"2026-10-02","specimen":"Serum","method":"Synthetic device","source":"Manual in-house","interpretation":"Synthetic documentary findings","lab_order_id":null,"lab_order_version":null,"encounter_id":null,"encounter_version":null,"document_id":null,"document_version":null,"observations":[{"id":"b3300000-0000-4000-8000-000000000001","analyte_key":"synthetic-alt","label":"ALT","kind":"numeric","value_number":0,"value_text":null,"unit":"U/L","reference_low":1,"reference_high":100,"reference_text":"As entered","source_flag":"Recorded flag"},{"id":"b3300000-0000-4000-8000-000000000002","analyte_key":"synthetic-screen","label":"Screen","kind":"qualitative","value_number":null,"value_text":"Not detected","unit":null,"reference_low":null,"reference_high":null,"reference_text":"As reported","source_flag":""}]}');
insert into data select 'draft',save_diagnostic_panel('b3300000-0000-4000-8000-000000000050','b3300000-0000-4000-8000-000000000100',(select id from fx where k='pet'),null,'draft',(select v from data where k='values'));

select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000801","role":"authenticated"}',true);
insert into data select 'final',save_diagnostic_panel('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000100',(select id from fx where k='pet'),1,'finalize',(select v from data where k='values'),'Synthetic exact review');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);









insert into diagnostic_pdf_runtime_policy(enabled,image,provenance,accepted_by) values(true,'lrv-diagnostic-pdf@sha256:'||repeat('a',64),'{"settings":{"format":"Letter"}}','b3300000-0000-4000-8000-000000000801');
insert into diagnostic_pdf_worker_policy(enabled,renderer_sha,settings_sha,accepted_by) values(true,repeat('a',64),encode(sha256(convert_to('{"format": "Letter"}','UTF8')),'hex'),'b3300000-0000-4000-8000-000000000801');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into data select 'claim',claim_diagnostic_pdf_job('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000061');
insert into data select 'source',read_diagnostic_pdf_render_source('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000061',1,'b3300000-0000-4000-8000-000000000801');
insert into data select 'input',jsonb_build_object('version',1,'job_id',v->>'job_id','source_hash',v->>'source_hash','snapshot_hash',v->>'snapshot_hash','html','<p>contract</p>','html_sha256',encode(sha256(convert_to('<p>contract</p>','UTF8')),'hex'),'html_bytes',15,'expected_texts',jsonb_build_array('contract')) from data where k='claim';
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.prepare(s jsonb,i jsonb) returns jsonb language sql as $$ select prepare_diagnostic_pdf_manifest('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000061',1,'b3300000-0000-4000-8000-000000000801',s,i) $$;
create function pg_temp.validate(r jsonb) returns jsonb language sql as $$ select validate_diagnostic_pdf_capture('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000071',1,'b3300000-0000-4000-8000-000000000801',r) $$;
create function pg_temp.reserve() returns jsonb language sql as $$ select reserve_diagnostic_pdf_upload('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000071',1,'b3300000-0000-4000-8000-000000000801') $$;
create function pg_temp.register(obj uuid,created timestamptz,b text) returns jsonb language sql as $$ select register_diagnostic_pdf_artifact('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000071',1,'b3300000-0000-4000-8000-000000000801',obj,created,(select (v->>'updated_at')::timestamptz from data where k='object'),(select v->>'version' from data where k='object'),b) $$;
set local role service_role;




insert into data select 'manifest',pg_temp.prepare((select v from data where k='source'),(select v from data where k='input'));


insert into data select 'capture',capture_manifest_diagnostic_pdf('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000061',1,'b3300000-0000-4000-8000-000000000801','JVBERi0xLjQKJSVFT0YK');
insert into data select 'processing',claim_diagnostic_pdf_processing('b3300000-0000-4000-8000-000000000051','b3300000-0000-4000-8000-000000000071');



insert into data select 'attestation',jsonb_build_object('sha256',v->>'sha256','byte_length',15,'page_count',1,'object_count',1,'stream_count',0,'inflated_bytes',0,'admission','chromium-classic-pdf1.4-v1','qpdf_clean',true) from data where k='capture';





insert into data select 'validation',pg_temp.validate((select v from data where k='attestation'));

insert into data select 'intent',pg_temp.reserve();



reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into storage.objects(id,bucket_id,name,metadata,version) select 'b3300000-0000-4000-8000-000000000099','diagnostic-pdfs',v->>'object_path','{"size":15,"mimetype":"application/pdf"}'::jsonb,'synthetic-object-v1' from data where k='intent';
insert into data select 'object',to_jsonb(o) from storage.objects o where id='b3300000-0000-4000-8000-000000000099';
update profiles set is_active=false where id='b3300000-0000-4000-8000-000000000801';set local role service_role;

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update profiles set is_active=true where id='b3300000-0000-4000-8000-000000000801';
delete from user_roles where user_id='b3300000-0000-4000-8000-000000000801';set local role service_role;

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);insert into user_roles(user_id,role) values('b3300000-0000-4000-8000-000000000801','DVM');set local role service_role;


insert into data select 'registered',pg_temp.register('b3300000-0000-4000-8000-000000000099',(select (v->>'created_at')::timestamptz from data where k='object'),'JVBERi0xLjQKJSVFT0YK');



reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select is(read_diagnostic_pdf_review('b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet'))->>'download_available','false','Staff disclosure defaults off');
select throws_ok($$select authorize_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet'))$$,'PT409',null,'Off policy denies authorization');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into diagnostic_pdf_staff_disclosure_policy(enabled,accepted_by) values(true,'b3300000-0000-4000-8000-000000000802');
update profiles set is_active=false where id='b3300000-0000-4000-8000-000000000801';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);
insert into data select 'authority',authorize_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet'));
select is(authorize_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet')),(select v from data where k='authority'),'Authorization replay keeps one authority after capture-owner offboarding');
select is(read_diagnostic_pdf_review('b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet'))->>'download_available','true','Alternate active staff may download retained report');
select throws_ok($$select authorize_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000201','b3300000-0000-4000-8000-000000000051',(select id from fx where k='sibling'))$$,'42501',null,'Cross-patient authority denied');
select throws_ok($$select read_diagnostic_pdf_download_context('b3300000-0000-4000-8000-000000000200',auth.uid())$$,'42501',null,'Staff cannot resolve private context');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select read_diagnostic_pdf_download_context('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000802')$$,'42501',null,'Cross-actor service context denied');
select throws_ok($$select complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000800','JVBERi0xLjUKJSVFT0YK')$$,'23514',null,'Different readback bytes denied');
insert into data select 'response',complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000800','JVBERi0xLjQKJSVFT0YK');
select is((select v->>'outcome' from data where k='response'),'response_prepared','Audit reports preparation, not receipt by user');
select is(complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000800','JVBERi0xLjQKJSVFT0YK'),(select v from data where k='response'),'Prepared response replay idempotent');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*)::integer from diagnostic_pdf_download_responses),1,'One response audit');
select throws_ok($$delete from diagnostic_pdf_download_responses$$,'23514',null,'Response audit immutable');
select throws_ok($$update diagnostic_pdf_download_authorities set expires_at=now()$$,'23514',null,'Authority cannot be extended or edited');
update profiles set is_active=false where id='b3300000-0000-4000-8000-000000000800';set local role service_role;
select throws_ok($$select complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000800','JVBERi0xLjQKJSVFT0YK')$$,'42501',null,'Historical response cannot bypass reader offboarding');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update profiles set is_active=true where id='b3300000-0000-4000-8000-000000000800';
update diagnostic_pdf_staff_disclosure_policy set enabled=false;set local role service_role;
select throws_ok($$select complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000800','JVBERi0xLjQKJSVFT0YK')$$,'PT409',null,'Historical response cannot bypass disclosure revocation');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update diagnostic_pdf_staff_disclosure_policy set enabled=true,revision=gen_random_uuid();set local role service_role;
select throws_ok($$select complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000800','JVBERi0xLjQKJSVFT0YK')$$,'PT409',null,'Changed policy invalidates old authority');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select throws_ok($$select authorize_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000200','b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet'))$$,'23505',null,'Stable identity cannot change binding');
insert into data select 'new-authority',authorize_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000202','b3300000-0000-4000-8000-000000000051',(select id from fx where k='pet'));
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update storage.objects set version='replacement' where id='b3300000-0000-4000-8000-000000000099';set local role service_role;
select throws_ok($$select complete_diagnostic_pdf_download('b3300000-0000-4000-8000-000000000202','b3300000-0000-4000-8000-000000000800','JVBERi0xLjQKJSVFT0YK')$$,'PT409',null,'Same-size replacement denies final response');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);select is((select count(*)::integer from communication_outbox),0,'Internal download creates no outbound delivery');
select * from finish();rollback;
