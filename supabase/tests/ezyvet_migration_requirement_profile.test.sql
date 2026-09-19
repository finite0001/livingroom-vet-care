begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic scale fixture only. Every row and temporary trigger change rolls back.
insert into auth.users(id,email,raw_user_meta_data) values('dc990000-0000-4000-8000-000000000001','maximum-summary@example.test','{}');
insert into user_roles(user_id,role) values('dc990000-0000-4000-8000-000000000001','ADMIN');
select set_config('request.jwt.claims','{"sub":"dc990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table max_ids(k text primary key,id uuid);
insert into max_ids select 'client',id from save_client(auth.uid(),null,null,'Maximum','Fixture',null,null,'EMAIL',null,null);
insert into max_ids select 'pet',id from save_patient(null,(select id from max_ids where k='client'),null,'Synthetic scale patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into max_ids values('manifest',gen_random_uuid());
create temp table max_scopes as select n,gen_random_uuid() mapping,gen_random_uuid() parent,gen_random_uuid() run,gen_random_uuid() scope from generate_series(1,100) n;
insert into ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
select parent,'https://api.trial.ezyvet.com','maximum-summary','animal',n::text,jsonb_build_object('id',n),encode(sha256(convert_to(n::text,'UTF8')),'hex'),auth.uid() from max_scopes;
insert into ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id,version)
select 'https://api.trial.ezyvet.com','maximum-summary','animal',n::text,parent,1 from max_scopes;
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select mapping,gen_random_uuid(),'synthetic-link','https://api.trial.ezyvet.com','maximum-summary','animal',n::text,parent,1,(select id from max_ids where k='client'),(select id from max_ids where k='pet'),1,'link','Synthetic scale mapping',auth.uid() from max_scopes;
insert into ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by,status,next_page)
select run,'https://api.trial.ezyvet.com','maximum-summary','healthstatus',auth.uid(),'review_ready',1001 from max_scopes;
insert into ezyvet_weight_runs(run_id,animal_link_id) select run,mapping from max_scopes;
create temp table max_weights as select s.run,s.n,gen_random_uuid() snapshot,w from max_scopes s cross join generate_series(1,50) w;
insert into ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
select snapshot,'https://api.trial.ezyvet.com','maximum-summary','healthstatus',n||'-'||w,jsonb_build_object('id',n||'-'||w,'animal_id',n,'weight',12.3),encode(sha256(convert_to(n||'-'||w,'UTF8')),'hex'),auth.uid() from max_weights;
insert into ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id,version)
select 'https://api.trial.ezyvet.com','maximum-summary','healthstatus',n||'-'||w,snapshot,1 from max_weights;
insert into ezyvet_import_pages(run_id,page,item_count) select run,p,50 from max_scopes cross join generate_series(1,1000) p;
-- Heads above already represent these unchanged repeated snapshots; avoid five million redundant observations during fixture seeding.
alter table ezyvet_import_page_items disable trigger ezyvet_page_observation;
insert into ezyvet_import_page_items(run_id,page,snapshot_id) select run,p,snapshot from max_weights cross join generate_series(1,1000) p;
alter table ezyvet_import_page_items enable trigger ezyvet_page_observation;
select prepare_ezyvet_migration_run((select id from max_ids where k='manifest'),'https://api.trial.ezyvet.com','maximum-summary',
 (select jsonb_agg(jsonb_build_object('id',scope,'mapping_id',mapping,'resource','healthstatus','parent_type','animal','parent_snapshot_id',parent,'parent_head_version',1,'disposition','required','reason','Synthetic full-volume scope')) from max_scopes));
select bind_ezyvet_migration_child(gen_random_uuid(),scope,run,'Synthetic full-volume binding') from max_scopes;
analyze ezyvet_import_page_items;
analyze ezyvet_import_pages;
analyze ezyvet_import_snapshots;
select is((select count(*) from ezyvet_import_page_items),5000000::bigint,'Fixture contains five million physical observations');

-- Diagnostic only: retain the full source fixture, but seed review-index cardinality
-- directly. These synthetic stream IDs do not represent accepted review work.
insert into max_ids values('preparation',gen_random_uuid());
select prepare_ezyvet_migration_projection((select id from max_ids where k='preparation'),(select id from max_ids where k='manifest'));

create temp table profile_chunk as select p.id preparation_id,b.id binding_id from max_ids p
cross join max_scopes s join ezyvet_migration_bindings b on b.scope_id=s.scope where p.k='preparation' and s.n=1;
select prepare_ezyvet_migration_source_chunk(preparation_id,binding_id,1) from profile_chunk;
create temp table profile_metrics(label text,plan jsonb);
-- Measure the same 1000-row requirements insert before and after index growth.
create function pg_temp.profile_requirements(label text) returns void language plpgsql as $$
declare result jsonb;begin
 execute format($q$explain (analyze,buffers,wal,format json)
 insert into ezyvet_migration_review_requirements(stream_hash,actor_id,preparation_id,binding_id,first_page,observation_index,kind)
 select encode(sha256(convert_to(%L||':'||g::text,'UTF8')),'hex'),auth.uid(),p.preparation_id,p.binding_id,1,(g-1)%%1000+1,'timed'
 from profile_chunk p cross join generate_series(1,1000) g$q$,label) into result;
 insert into profile_metrics values(label,result);
end $$;
select pg_temp.profile_requirements('early');
alter table ezyvet_migration_review_requirements disable trigger migration_calculation_freeze;
insert into ezyvet_migration_review_requirements(stream_hash,actor_id,preparation_id,binding_id,first_page,observation_index,kind)
select encode(sha256(convert_to('cardinality:'||g::text,'UTF8')),'hex'),auth.uid(),p.preparation_id,p.binding_id,1,(g-1)%1000+1,'timed'
from profile_chunk p cross join generate_series(1,3000000) g;
alter table ezyvet_migration_review_requirements enable trigger migration_calculation_freeze;
analyze ezyvet_migration_review_requirements;
select is((select count(*) from ezyvet_migration_review_requirements),3002000::bigint,'Diagnostic index contains three million synthetic requirements plus two measured batches');
set local statement_timeout='10s';
select pg_temp.profile_requirements('late');
-- Isolate guard cost only within this disposable rollback fixture.
alter table ezyvet_migration_review_requirements disable trigger migration_calculation_freeze;
select pg_temp.profile_requirements('late_without_freeze_guard');
alter table ezyvet_migration_review_requirements enable trigger migration_calculation_freeze;
select is((select count(*) from profile_metrics),3::bigint,'All three diagnostic measurements completed');
select diag(jsonb_build_object('diagnostic','requirements_insert_profile','measurements',jsonb_agg(to_jsonb(m)))::text) from profile_metrics m;
select * from finish();
rollback;
