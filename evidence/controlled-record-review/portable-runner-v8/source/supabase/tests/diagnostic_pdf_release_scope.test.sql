-- Release-scope authorization and binding only. Marker bytes are not PDF admission or transport proof.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('b3400000-0000-4000-8000-000000000800','synthetic-diagnostic-staff@example.test','{}'),('b3400000-0000-4000-8000-000000000801','synthetic-diagnostic-dvm@example.test','{}'),('b3400000-0000-4000-8000-000000000802','synthetic-diagnostic-admin@example.test','{}');
update profiles set is_active=true,full_name='Synthetic diagnostic reviewer' where id::text like 'b3400000-%';
insert into user_roles(user_id,role) values('b3400000-0000-4000-8000-000000000800','STAFF'),('b3400000-0000-4000-8000-000000000801','DVM'),('b3400000-0000-4000-8000-000000000802','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000800","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Diagnostics','+13035550188','synthetic-download@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic diagnostics dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'sibling',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic diagnostics sibling','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into data values('values','{"panel_name":"Synthetic chemistry","category":"laboratory","collected_on":"2026-10-01","reported_on":"2026-10-02","specimen":"Serum","method":"Synthetic device","source":"Manual in-house","interpretation":"Synthetic documentary findings","lab_order_id":null,"lab_order_version":null,"encounter_id":null,"encounter_version":null,"document_id":null,"document_version":null,"observations":[{"id":"b3400000-0000-4000-8000-000000000001","analyte_key":"synthetic-alt","label":"ALT","kind":"numeric","value_number":0,"value_text":null,"unit":"U/L","reference_low":1,"reference_high":100,"reference_text":"As entered","source_flag":"Recorded flag"},{"id":"b3400000-0000-4000-8000-000000000002","analyte_key":"synthetic-screen","label":"Screen","kind":"qualitative","value_number":null,"value_text":"Not detected","unit":null,"reference_low":null,"reference_high":null,"reference_text":"As reported","source_flag":""}]}');
insert into data select 'draft',save_diagnostic_panel('b3400000-0000-4000-8000-000000000050','b3400000-0000-4000-8000-000000000100',(select id from fx where k='pet'),null,'draft',(select v from data where k='values'));

select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000801","role":"authenticated"}',true);
select save_diagnostic_panel('b3400000-0000-4000-8000-000000000052','b3400000-0000-4000-8000-000000000101',(select id from fx where k='pet'),null,'draft',(select v from data where k='values'));
select save_diagnostic_panel('b3400000-0000-4000-8000-000000000053','b3400000-0000-4000-8000-000000000101',(select id from fx where k='pet'),1,'finalize',(select v from data where k='values'),'Synthetic earlier history review');
insert into data select 'final',save_diagnostic_panel('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000100',(select id from fx where k='pet'),1,'finalize',(select v from data where k='values'),'Synthetic exact review');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);









insert into diagnostic_pdf_runtime_policy(enabled,image,provenance,accepted_by) values(true,'lrv-diagnostic-pdf@sha256:'||repeat('a',64),'{"settings":{"format":"Letter"}}','b3400000-0000-4000-8000-000000000801');
insert into diagnostic_pdf_worker_policy(enabled,renderer_sha,settings_sha,accepted_by) values(true,repeat('a',64),encode(sha256(convert_to('{"format": "Letter"}','UTF8')),'hex'),'b3400000-0000-4000-8000-000000000801');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into data select 'claim',claim_diagnostic_pdf_job('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000061');
insert into data select 'source',read_diagnostic_pdf_render_source('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000061',1,'b3400000-0000-4000-8000-000000000801');
insert into data select 'input',jsonb_build_object('version',1,'job_id',v->>'job_id','source_hash',v->>'source_hash','snapshot_hash',v->>'snapshot_hash','html','<p>contract</p>','html_sha256',encode(sha256(convert_to('<p>contract</p>','UTF8')),'hex'),'html_bytes',15,'expected_texts',jsonb_build_array('contract')) from data where k='claim';
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.prepare(s jsonb,i jsonb) returns jsonb language sql as $$ select prepare_diagnostic_pdf_manifest('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000061',1,'b3400000-0000-4000-8000-000000000801',s,i) $$;
create function pg_temp.validate(r jsonb) returns jsonb language sql as $$ select validate_diagnostic_pdf_capture('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000071',1,'b3400000-0000-4000-8000-000000000801',r) $$;
create function pg_temp.reserve() returns jsonb language sql as $$ select reserve_diagnostic_pdf_upload('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000071',1,'b3400000-0000-4000-8000-000000000801') $$;
create function pg_temp.register(obj uuid,created timestamptz,b text) returns jsonb language sql as $$ select register_diagnostic_pdf_artifact('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000071',1,'b3400000-0000-4000-8000-000000000801',obj,created,(select (v->>'updated_at')::timestamptz from data where k='object'),(select v->>'version' from data where k='object'),b) $$;
set local role service_role;




insert into data select 'manifest',pg_temp.prepare((select v from data where k='source'),(select v from data where k='input'));


insert into data select 'capture',capture_manifest_diagnostic_pdf('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000061',1,'b3400000-0000-4000-8000-000000000801','JVBERi0xLjQKJSVFT0YK');
insert into data select 'processing',claim_diagnostic_pdf_processing('b3400000-0000-4000-8000-000000000051','b3400000-0000-4000-8000-000000000071');



insert into data select 'attestation',jsonb_build_object('sha256',v->>'sha256','byte_length',15,'page_count',1,'object_count',1,'stream_count',0,'inflated_bytes',0,'admission','chromium-classic-pdf1.4-v1','qpdf_clean',true) from data where k='capture';





insert into data select 'validation',pg_temp.validate((select v from data where k='attestation'));

insert into data select 'intent',pg_temp.reserve();



reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into storage.objects(id,bucket_id,name,metadata,version) select 'b3400000-0000-4000-8000-000000000099','diagnostic-pdfs',v->>'object_path','{"size":15,"mimetype":"application/pdf"}'::jsonb,'synthetic-object-v1' from data where k='intent';
insert into data select 'object',to_jsonb(o) from storage.objects o where id='b3400000-0000-4000-8000-000000000099';
update profiles set is_active=false where id='b3400000-0000-4000-8000-000000000801';set local role service_role;

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update profiles set is_active=true where id='b3400000-0000-4000-8000-000000000801';
delete from user_roles where user_id='b3400000-0000-4000-8000-000000000801';set local role service_role;

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);insert into user_roles(user_id,role) values('b3400000-0000-4000-8000-000000000801','DVM');set local role service_role;


insert into data select 'registered',pg_temp.register('b3400000-0000-4000-8000-000000000099',(select (v->>'created_at')::timestamptz from data where k='object'),'JVBERi0xLjQKJSVFT0YK');



reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000800","role":"authenticated"}',true);select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000800","role":"authenticated"}',true);

select throws_ok($$select diagnostic_pdf_release_binding('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'current')$$,'42501',null,'Private release binding is not a staff endpoint');
select throws_ok($$select verify_diagnostic_pdf_release_bytes('{}',decode('00','hex'))$$,'42501',null,'Private byte verifier is not a staff endpoint');
insert into data select 'scope',read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'current');
select is((select v->>'export_available' from data where k='scope'),'false','Metadata review never grants export');
select is((select v->>'mode' from data where k='scope'),'current','Current mode explicit');
select is((select jsonb_array_length(v->'embedded_versions') from data where k='scope'),2,'All embedded reviewed versions are disclosed');
select is((select v->>'scope_expansion_required' from data where k='scope'),'true','Embedded history requires expanded scope review');
select ok(not (select v ?| array['object_path','bucket','object_id','object_version'] from data where k='scope'),'Staff projection omits private object references');
select throws_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='sibling'),'current')$$,'42501',null,'Cross-patient scope denied');
select throws_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'latest')$$,'23514',null,'Implicit latest mode denied');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into data select 'binding',diagnostic_pdf_release_binding('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'current');
select lives_ok($$select verify_diagnostic_pdf_release_bytes((select v from data where k='binding'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'Exact captured bytes verify');
select throws_ok($$select verify_diagnostic_pdf_release_bytes((select v from data where k='binding'),decode('JVBERi0xLjUKJSVFT0YK','base64'))$$,'23514',null,'Same-size byte substitution denied');
select throws_ok($$select verify_diagnostic_pdf_release_bytes(jsonb_set((select v from data where k='binding'),'{embedded_versions}','[]'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'PT409',null,'Census removal invalidates binding');
select throws_ok($$select verify_diagnostic_pdf_release_bytes((select v from data where k='binding'),null)$$,'23514',null,'Missing readback denied');
update profiles set is_active=false where id='b3400000-0000-4000-8000-000000000801';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select lives_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'current')$$,'Historical processing owner is not current-reader authority');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update profiles set is_active=true where id='b3400000-0000-4000-8000-000000000801';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000801","role":"authenticated"}',true);
select save_diagnostic_panel('b3400000-0000-4000-8000-000000000054','b3400000-0000-4000-8000-000000000100',(select id from fx where k='pet'),2,'draft',(select jsonb_set(v,'{interpretation}','"Synthetic correction"') from data where k='values'));
select save_diagnostic_panel('b3400000-0000-4000-8000-000000000055','b3400000-0000-4000-8000-000000000100',(select id from fx where k='pet'),3,'finalize',(select jsonb_set(v,'{interpretation}','"Synthetic correction"') from data where k='values'),'Synthetic corrected review','Synthetic correction');
select throws_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'current')$$,'PT409',null,'Corrected source cannot silently substitute old PDF');
select lives_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'historical')$$,'Explicit historical PDF retains actual version');
select throws_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000055',(select id from fx where k='pet'),'current')$$,'PT409',null,'Unregistered current PDF excluded');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select verify_diagnostic_pdf_release_bytes((select v from data where k='binding'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'PT409',null,'Correction invalidates previously prepared current binding');
insert into data select 'historical-binding',diagnostic_pdf_release_binding('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'historical');
select lives_ok($$select verify_diagnostic_pdf_release_bytes((select v from data where k='historical-binding'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'Historical bytes remain unchanged');
update storage.objects set version='same-size-replacement' where id='b3400000-0000-4000-8000-000000000099';
select throws_ok($$select verify_diagnostic_pdf_release_bytes((select v from data where k='historical-binding'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'PT409',null,'Object body generation replacement denies byte verification');
update storage.objects set version='synthetic-object-v1' where id='b3400000-0000-4000-8000-000000000099';
update profiles set is_active=false where id='b3400000-0000-4000-8000-000000000800';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3400000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select throws_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'historical')$$,'42501',null,'Inactive current reader denied');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select throws_ok($$select diagnostic_pdf_release_binding('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'historical')$$,'42501',null,'Service Data API cannot call private helper');
reset role;select set_config('request.jwt.claims','{}',true);set local role anon;
select throws_ok($$select read_diagnostic_pdf_release_scope('b3400000-0000-4000-8000-000000000051',(select id from fx where k='pet'),'historical')$$,'42501',null,'Anonymous scope denied');
reset role;select set_config('request.jwt.claims','{}',true);
select is((select count(*)::integer from record_releases),0,'No outgoing release created');
select is((select count(*)::integer from communication_outbox),0,'No provider queue created');
select is((select count(*)::integer from diagnostic_pdf_staff_disclosure_policy),0,'Download policy remains off');
select * from finish();rollback;
