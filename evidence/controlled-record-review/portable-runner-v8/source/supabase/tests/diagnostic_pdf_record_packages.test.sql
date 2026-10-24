-- Release-scope authorization and binding only. Marker bytes are not PDF admission or transport proof.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('b3500000-0000-4000-8000-000000000800','synthetic-diagnostic-staff@example.test','{}'),('b3500000-0000-4000-8000-000000000801','synthetic-diagnostic-dvm@example.test','{}'),('b3500000-0000-4000-8000-000000000802','synthetic-diagnostic-admin@example.test','{}');
update profiles set is_active=true,full_name='Synthetic diagnostic reviewer' where id::text like 'b3500000-%';
insert into user_roles(user_id,role) values('b3500000-0000-4000-8000-000000000800','STAFF'),('b3500000-0000-4000-8000-000000000801','DVM'),('b3500000-0000-4000-8000-000000000802','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Diagnostics','+13035550188','synthetic-download@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic diagnostics dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'sibling',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic diagnostics sibling','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into data values('values','{"panel_name":"Synthetic chemistry","category":"laboratory","collected_on":"2026-10-01","reported_on":"2026-10-02","specimen":"Serum","method":"Synthetic device","source":"Manual in-house","interpretation":"Synthetic documentary findings","lab_order_id":null,"lab_order_version":null,"encounter_id":null,"encounter_version":null,"document_id":null,"document_version":null,"observations":[{"id":"b3500000-0000-4000-8000-000000000001","analyte_key":"synthetic-alt","label":"ALT","kind":"numeric","value_number":0,"value_text":null,"unit":"U/L","reference_low":1,"reference_high":100,"reference_text":"As entered","source_flag":"Recorded flag"},{"id":"b3500000-0000-4000-8000-000000000002","analyte_key":"synthetic-screen","label":"Screen","kind":"qualitative","value_number":null,"value_text":"Not detected","unit":null,"reference_low":null,"reference_high":null,"reference_text":"As reported","source_flag":""}]}');
insert into data select 'draft',save_diagnostic_panel('b3500000-0000-4000-8000-000000000050','b3500000-0000-4000-8000-000000000100',(select id from fx where k='pet'),null,'draft',(select v from data where k='values'));

select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000801","role":"authenticated"}',true);
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000052','b3500000-0000-4000-8000-000000000101',(select id from fx where k='pet'),null,'draft',(select v from data where k='values'));
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000053','b3500000-0000-4000-8000-000000000101',(select id from fx where k='pet'),1,'finalize',(select v from data where k='values'),'Synthetic earlier history review');
insert into data select 'final',save_diagnostic_panel('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000100',(select id from fx where k='pet'),1,'finalize',(select v from data where k='values'),'Synthetic exact review');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);









insert into diagnostic_pdf_runtime_policy(enabled,image,provenance,accepted_by) values(true,'lrv-diagnostic-pdf@sha256:'||repeat('a',64),'{"settings":{"format":"Letter"}}','b3500000-0000-4000-8000-000000000801');
insert into diagnostic_pdf_worker_policy(enabled,renderer_sha,settings_sha,accepted_by) values(true,repeat('a',64),encode(sha256(convert_to('{"format": "Letter"}','UTF8')),'hex'),'b3500000-0000-4000-8000-000000000801');
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into data select 'claim',claim_diagnostic_pdf_job('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000061');
insert into data select 'source',read_diagnostic_pdf_render_source('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000061',1,'b3500000-0000-4000-8000-000000000801');
insert into data select 'input',jsonb_build_object('version',1,'job_id',v->>'job_id','source_hash',v->>'source_hash','snapshot_hash',v->>'snapshot_hash','html','<p>contract</p>','html_sha256',encode(sha256(convert_to('<p>contract</p>','UTF8')),'hex'),'html_bytes',15,'expected_texts',jsonb_build_array('contract')) from data where k='claim';
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.prepare(s jsonb,i jsonb) returns jsonb language sql as $$ select prepare_diagnostic_pdf_manifest('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000061',1,'b3500000-0000-4000-8000-000000000801',s,i) $$;
create function pg_temp.validate(r jsonb) returns jsonb language sql as $$ select validate_diagnostic_pdf_capture('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000071',1,'b3500000-0000-4000-8000-000000000801',r) $$;
create function pg_temp.reserve() returns jsonb language sql as $$ select reserve_diagnostic_pdf_upload('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000071',1,'b3500000-0000-4000-8000-000000000801') $$;
create function pg_temp.register(obj uuid,created timestamptz,b text) returns jsonb language sql as $$ select register_diagnostic_pdf_artifact('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000071',1,'b3500000-0000-4000-8000-000000000801',obj,created,(select (v->>'updated_at')::timestamptz from data where k='object'),(select v->>'version' from data where k='object'),b) $$;
set local role service_role;




insert into data select 'manifest',pg_temp.prepare((select v from data where k='source'),(select v from data where k='input'));


insert into data select 'capture',capture_manifest_diagnostic_pdf('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000061',1,'b3500000-0000-4000-8000-000000000801','JVBERi0xLjQKJSVFT0YK');
insert into data select 'processing',claim_diagnostic_pdf_processing('b3500000-0000-4000-8000-000000000051','b3500000-0000-4000-8000-000000000071');



insert into data select 'attestation',jsonb_build_object('sha256',v->>'sha256','byte_length',15,'page_count',1,'object_count',1,'stream_count',0,'inflated_bytes',0,'admission','chromium-classic-pdf1.4-v1','qpdf_clean',true) from data where k='capture';





insert into data select 'validation',pg_temp.validate((select v from data where k='attestation'));

insert into data select 'intent',pg_temp.reserve();



reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into storage.objects(id,bucket_id,name,metadata,version) select 'b3500000-0000-4000-8000-000000000099','diagnostic-pdfs',v->>'object_path','{"size":15,"mimetype":"application/pdf"}'::jsonb,'synthetic-object-v1' from data where k='intent';
insert into data select 'object',to_jsonb(o) from storage.objects o where id='b3500000-0000-4000-8000-000000000099';
update profiles set is_active=false where id='b3500000-0000-4000-8000-000000000801';set local role service_role;

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);update profiles set is_active=true where id='b3500000-0000-4000-8000-000000000801';
delete from user_roles where user_id='b3500000-0000-4000-8000-000000000801';set local role service_role;

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);insert into user_roles(user_id,role) values('b3500000-0000-4000-8000-000000000801','DVM');set local role service_role;


insert into data select 'registered',pg_temp.register('b3500000-0000-4000-8000-000000000099',(select (v->>'created_at')::timestamptz from data where k='object'),'JVBERi0xLjQKJSVFT0YK');



reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);

reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);

reset role;
select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);
insert into data select 'inventory',record_request_inventory((select id from fx where k='pet'));
select is((select jsonb_array_length(v#>'{nodes,diagnostic_pdf_ids:b3500000-0000-4000-8000-000000000051,diagnostic_pdf,binding,embedded_versions}') from data where k='inventory'),2,'Inventory discloses exact embedded census');
select is((select v#>>'{nodes,diagnostic_pdf_ids:b3500000-0000-4000-8000-000000000051,scope_expansion}' from data where k='inventory'),'true','Custom source explicitly carries broader history');
select ok(not exists(select 1 from data,jsonb_array_elements(v->'exclusions') e where k='inventory' and e->>'family'='diagnostic_pdf_ids' and e->>'id'='b3500000-0000-4000-8000-000000000100'),'No bogus lesion fallback in diagnostics discovery');
select ok(exists(select 1 from data,jsonb_array_elements(v->'exclusions') e where k='inventory' and e->>'id'='b3500000-0000-4000-8000-000000000053'),'Unregistered second panel precisely excluded');
-- Another registered PDF is documentary non-laboratory diagnostics. Labs must not silently select it.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000801","role":"authenticated"}',true);
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000080','b3500000-0000-4000-8000-000000000081',(select id from fx where k='pet'),null,'draft',(select jsonb_set(v,'{category}','"other"') from data where k='values'));
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000081',(select id from fx where k='pet'),1,'finalize',(select jsonb_set(v,'{category}','"other"') from data where k='values'),'Synthetic non-laboratory review');
reset role;set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into data select 'other_claim',claim_diagnostic_pdf_job('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000086');
insert into data select 'other_source',read_diagnostic_pdf_render_source('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000086',1,'b3500000-0000-4000-8000-000000000801');
insert into data select 'other_manifest',prepare_diagnostic_pdf_manifest('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000086',1,'b3500000-0000-4000-8000-000000000801',(select v from data where k='other_source'),(select i.v||jsonb_build_object('job_id',c.v->'job_id','source_hash',c.v->'source_hash','snapshot_hash',c.v->'snapshot_hash') from data i,data c where i.k='input' and c.k='other_claim'));
select capture_manifest_diagnostic_pdf('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000086',1,'b3500000-0000-4000-8000-000000000801','JVBERi0xLjQKJSVFT0YK');
select claim_diagnostic_pdf_processing('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000087');
select validate_diagnostic_pdf_capture('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000087',1,'b3500000-0000-4000-8000-000000000801',(select v from data where k='attestation'));
insert into data select 'other_intent',reserve_diagnostic_pdf_upload('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000087',1,'b3500000-0000-4000-8000-000000000801');
reset role;insert into storage.objects(id,bucket_id,name,metadata,version) select 'b3500000-0000-4000-8000-000000000089','diagnostic-pdfs',v->>'object_path','{"size":15,"mimetype":"application/pdf"}'::jsonb,'synthetic-other-v1' from data where k='other_intent';
insert into data select 'other_object',to_jsonb(o) from storage.objects o where id='b3500000-0000-4000-8000-000000000089';
set local role service_role;
select register_diagnostic_pdf_artifact('b3500000-0000-4000-8000-000000000085','b3500000-0000-4000-8000-000000000087',1,'b3500000-0000-4000-8000-000000000801','b3500000-0000-4000-8000-000000000089',(select (v->>'created_at')::timestamptz from data where k='other_object'),(select (v->>'updated_at')::timestamptz from data where k='other_object'),'synthetic-other-v1','JVBERi0xLjQKJSVFT0YK');
reset role;select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);
insert into data values('save',jsonb_build_object('pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'direction','outgoing','subset','custom','channel','EMAIL','recipient_kind','client','requester_name','Synthetic client','request_note','Synthetic diagnostic request','requested_on',(now() at time zone 'America/Denver')::date,'assigned_to','b3500000-0000-4000-8000-000000000800'));
set local role authenticated;
select save_record_request(gen_random_uuid(),'b3500000-0000-4000-8000-000000000200',null,(select v from data where k='save'));
insert into data select 'package-manifest',prepare_record_request_manifest(gen_random_uuid(),'b3500000-0000-4000-8000-000000000200',1,jsonb_build_object('manifest_id','b3500000-0000-4000-8000-000000000201','selection',jsonb_build_object('diagnostic_pdf_ids',jsonb_build_array('b3500000-0000-4000-8000-000000000051')),'review_note','Synthetic complete embedded scope review'));
insert into data select 'package',read_record_request_package('b3500000-0000-4000-8000-000000000200',(list_record_request_packages('b3500000-0000-4000-8000-000000000200','b3500000-0000-4000-8000-000000000201')#>>'{items,0,id}')::uuid);
select is((select v#>>'{preview,snapshot,schema_version}' from data where k='package'),'14','Diagnostic-only package uses schema14 without placeholder sources');
select is((select jsonb_array_length(v#>'{preview,snapshot,attachments}') from data where k='package'),1,'One PDF is indivisible despite two embedded panels');
select is((select v->>'scope_expansion' from data where k='package'),'true','Custom package requires scope expansion');
select throws_ok($$select confirm_record_request_package(gen_random_uuid(),'b3500000-0000-4000-8000-000000000200',2,jsonb_build_object('package_id',(select v->'id' from data where k='package'),'manifest_hash',(select v->'fingerprint' from data where k='package-manifest'),'attest_review',true,'attest_scope_expansion',false))$$,'23514',null,'Declined embedded expansion cannot confirm');
select throws_ok($$select confirm_record_release(gen_random_uuid(),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','synthetic-download@example.test',(select v->'selection' from data where k='package'),(select v#>'{preview,snapshot}' from data where k='package'),(select v#>>'{preview,source_hash}' from data where k='package'),true)$$,'42501',null,'Unnumbered client release cannot bypass diagnostic workflow');
select throws_ok($$select confirm_record_request_package(gen_random_uuid(),'b3500000-0000-4000-8000-000000000200',2,jsonb_build_object('package_id',(select v->'id' from data where k='package'),'manifest_hash',(select v->'fingerprint' from data where k='package-manifest'),'attest_review',true,'attest_scope_expansion',true))$$,'42501',null,'Schema14 clinical acceptance remains off');
reset role;
insert into data select 'original',v#>'{preview,snapshot,attachments,0}' from data where k='package';
select lives_ok($$select verify_release_source_original_v5((select v#>'{preview,snapshot}' from data where k='package'),(select v from data where k='original'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'Exact selected diagnostic marker verifies source contract');
select throws_ok($$select verify_release_source_original_v5((select v#>'{preview,snapshot}' from data where k='package'),(select v from data where k='original'),decode('JVBERi0xLjUKJSVFT0YK','base64'))$$,'23514',null,'Same-size byte change denied');
select throws_ok($$select verify_release_source_original_v5((select jsonb_set(v#>'{preview,snapshot}','{diagnostic_pdfs}','[]') from data where k='package'),(select v from data where k='original'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'23514',null,'Missing diagnostic source cannot downgrade attachment');
select throws_ok($$select verify_release_source_original_v5((select jsonb_set(v#>'{preview,snapshot}','{selection,diagnostic_pdf_ids}','[]') from data where k='package'),(select v from data where k='original'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'23514',null,'Mode selection is exact');
select throws_ok($$select verify_release_source_original_v5((select jsonb_set(v#>'{preview,snapshot}','{schema_version}','13') from data where k='package'),(select v from data where k='original'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'23514',null,'Old schema cannot accept diagnostic bucket');
select throws_ok($$select release_preview_v14_internal((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','synthetic-download@example.test','{"diagnostic_pdf_ids":["b3500000-0000-4000-8000-000000000051"],"diagnostic_pdf_historical_ids":["b3500000-0000-4000-8000-000000000051"]}')$$,'23514',null,'Overlapping current and historical selection denied');
insert into record_release_policy(id,enabled,accepted_at,accepted_by,acceptance_reference,accepted_schema_version) values(true,true,now(),'b3500000-0000-4000-8000-000000000800','Synthetic local schema14 review',14);
set local role authenticated;
insert into data select 'confirmed',confirm_record_request_package('b3500000-0000-4000-8000-000000000202','b3500000-0000-4000-8000-000000000200',2,jsonb_build_object('package_id',(select v->'id' from data where k='package'),'manifest_hash',(select v->'fingerprint' from data where k='package-manifest'),'attest_review',true,'attest_scope_expansion',true));
select is(read_record_release((select (v->>'release_id')::uuid from data where k='package'))->>'eligible','true','Numbered client diagnostic package confirms under explicit acceptance');
select lives_ok($$select confirm_record_request_package('b3500000-0000-4000-8000-000000000202','b3500000-0000-4000-8000-000000000200',2,jsonb_build_object('package_id',(select v->'id' from data where k='package'),'manifest_hash',(select v->'fingerprint' from data where k='package-manifest'),'attest_review',true,'attest_scope_expansion',true))$$,'Uncertain confirmation recovers exact receipt');
select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000801","role":"authenticated"}',true);
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000054','b3500000-0000-4000-8000-000000000101',(select id from fx where k='pet'),2,'draft',(select jsonb_set(v,'{interpretation}','"Synthetic embedded correction"') from data where k='values'));
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000055','b3500000-0000-4000-8000-000000000101',(select id from fx where k='pet'),3,'finalize',(select jsonb_set(v,'{interpretation}','"Synthetic embedded correction"') from data where k='values'),'Synthetic corrected embedded review','Synthetic correction');
select is(read_record_release((select (v->>'release_id')::uuid from data where k='package'))->>'eligible','false','Correction of embedded panel invalidates confirmed disclosure');
reset role;
select throws_ok($$select verify_release_source_original_v5((select v#>'{preview,snapshot}' from data where k='package'),(select v from data where k='original'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'PT409',null,'Embedded correction changes frozen review context');
select is((select count(*)::integer from record_release_events where release_id=(select (v->>'release_id')::uuid from data where k='package')),1,'Correction appends one immutable invalidation event');
select is((select count(*)::integer from communication_outbox),0,'No provider queue created');
select is((select count(*)::integer from diagnostic_pdf_staff_disclosure_policy),0,'Recipient workflow does not activate internal staff download');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000800","role":"authenticated"}',true);
select lives_ok($$select confirm_record_request_package('b3500000-0000-4000-8000-000000000202','b3500000-0000-4000-8000-000000000200',2,jsonb_build_object('package_id',(select v->'id' from data where k='package'),'manifest_hash',(select v->'fingerprint' from data where k='package-manifest'),'attest_review',true,'attest_scope_expansion',true))$$,'Original receipt recovery survives correction without reauthorizing delivery');
reset role;
select ok(not has_function_privilege('authenticated','public.release_preview_v14_internal(uuid,uuid,text,text,jsonb)','EXECUTE'),'Private schema14 helper unavailable through staff API');
select ok(not has_function_privilege('service_role','public.verify_release_source_original_v5(jsonb,jsonb,bytea)','EXECUTE'),'Private central byte check is not a service endpoint');
set local role authenticated;
select save_record_request(gen_random_uuid(),'b3500000-0000-4000-8000-000000000220',null,(select v||'{"subset":"labs"}' from data where k='save'));
select prepare_record_request_manifest(gen_random_uuid(),'b3500000-0000-4000-8000-000000000220',1,'{"manifest_id":"b3500000-0000-4000-8000-000000000221","selection":{},"review_note":"Synthetic laboratory-only current PDFs"}');
reset role;
select ok(exists(select 1 from record_request_packages where manifest_id='b3500000-0000-4000-8000-000000000221' and selection->'diagnostic_pdf_ids' @> '["b3500000-0000-4000-8000-000000000051"]'),'Labs preset includes registered current laboratory PDF');
select ok(not exists(select 1 from record_request_packages where manifest_id='b3500000-0000-4000-8000-000000000221' and selection->'diagnostic_pdf_ids' @> '["b3500000-0000-4000-8000-000000000085"]'),'Labs preset excludes registered non-laboratory PDF');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b3500000-0000-4000-8000-000000000801","role":"authenticated"}',true);
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000056','b3500000-0000-4000-8000-000000000100',(select id from fx where k='pet'),2,'draft',(select jsonb_set(v,'{interpretation}','"Synthetic main corrected findings"') from data where k='values'));
select save_diagnostic_panel('b3500000-0000-4000-8000-000000000057','b3500000-0000-4000-8000-000000000100',(select id from fx where k='pet'),3,'finalize',(select jsonb_set(v,'{interpretation}','"Synthetic main corrected findings"') from data where k='values'),'Synthetic main corrected review','Synthetic main correction');
reset role;
select throws_ok($$select release_preview_v14_internal((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','synthetic-download@example.test','{"diagnostic_pdf_ids":["b3500000-0000-4000-8000-000000000051"]}')$$,'PT409',null,'Current selection never substitutes an older registered PDF');
insert into data select 'historical',release_preview_v14_internal((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','synthetic-download@example.test','{"diagnostic_pdf_historical_ids":["b3500000-0000-4000-8000-000000000051"]}');
select is((select v#>>'{snapshot,diagnostic_pdfs,0,binding,version}' from data where k='historical'),'1','Explicit historical preview retains actual reviewed version');
select is((select v#>>'{snapshot,attachments,0,content_sha256}' from data where k='historical'),(select v->>'content_sha256' from data where k='original'),'Historical preview retains exact immutable byte fingerprint');
select lives_ok($$select verify_release_source_original_v5((select v->'snapshot' from data where k='historical'),(select v#>'{snapshot,attachments,0}' from data where k='historical'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'Fresh historical disclosure can verify unchanged original bytes');
update storage.objects set version='synthetic-same-size-replacement' where id='b3500000-0000-4000-8000-000000000099';
select throws_ok($$select verify_release_source_original_v5((select v->'snapshot' from data where k='historical'),(select v#>'{snapshot,attachments,0}' from data where k='historical'),decode('JVBERi0xLjQKJSVFT0YK','base64'))$$,'PT409',null,'Same-size object generation change blocks package capture');
update storage.objects set version='synthetic-object-v1' where id='b3500000-0000-4000-8000-000000000099';
set local role authenticated;
insert into fx select 'weight',id from record_patient_weight((select id from fx where k='pet'),10,'kg','2026-10-01');
select save_record_request(gen_random_uuid(),'b3500000-0000-4000-8000-000000000210',null,(select v||'{"subset":"full"}' from data where k='save'));
select prepare_record_request_manifest(gen_random_uuid(),'b3500000-0000-4000-8000-000000000210',1,'{"manifest_id":"b3500000-0000-4000-8000-000000000211","selection":{},"review_note":"Synthetic full-current scope"}');
reset role;
select ok(not exists(select 1 from record_request_packages p where p.manifest_id='b3500000-0000-4000-8000-000000000211' and jsonb_array_length(coalesce(p.selection->'diagnostic_pdf_historical_ids','[]'))>0),'Full preset never silently selects historical PDF');
select ok(exists(select 1 from jsonb_array_elements(record_request_inventory((select id from fx where k='pet'))->'exclusions') e where e->>'id'='b3500000-0000-4000-8000-000000000057' and e->>'family'='diagnostic_pdf_ids'),'Unavailable corrected current PDF remains a precise exclusion');
insert into data select 'mixed',release_preview_v14_internal((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','synthetic-download@example.test',jsonb_build_object('diagnostic_pdf_historical_ids',jsonb_build_array('b3500000-0000-4000-8000-000000000051'),'weight_ids',jsonb_build_array((select id from fx where k='weight'))));
select is((select jsonb_array_length(v#>'{snapshot,weights}') from data where k='mixed'),1,'Mixed schema14 preserves selected inherited clinical sources');
select is((select jsonb_array_length(v#>'{snapshot,attachments}') from data where k='mixed'),1,'Embedded history is not duplicated as extra attachments');
select throws_ok($$select release_preview_v14_internal((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','synthetic-download@example.test',jsonb_build_object('diagnostic_pdf_ids',(select jsonb_agg(gen_random_uuid()) from generate_series(1,24)),'document_ids',jsonb_build_array(gen_random_uuid())))$$,'23514','Distinct originals within24-file limit required','Budget counts diagnostic and ordinary originals together');
select * from finish();rollback;
