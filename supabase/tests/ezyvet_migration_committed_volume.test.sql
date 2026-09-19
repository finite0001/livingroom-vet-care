begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- Synthetic scale fixture only, in its own disposable database.
-- Seed commits and each bounded operation commits independently, matching RPC requests.
-- Run with the sql-only disposable fixture; database teardown removes committed rows.
insert into auth.users(id,email,raw_user_meta_data) values('dc990000-0000-4000-8000-000000000001','maximum-summary@example.test','{}');
insert into user_roles(user_id,role) values('dc990000-0000-4000-8000-000000000001','ADMIN');
select set_config('request.jwt.claims','{"sub":"dc990000-0000-4000-8000-000000000001","role":"authenticated"}',false);
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
commit;
select is((select count(*) from ezyvet_import_page_items),5000000::bigint,'Fixture contains five million physical observations');
set statement_timeout='10s';
select is((select count(*) from ezyvet_migration_observation_chunk((select id from max_ids where k='manifest'),(select b.id from ezyvet_migration_bindings b join max_scopes s on s.scope=b.scope_id where s.n=1),1,20)),1000::bigint,'First bounded chunk reads all twenty pages within ten seconds amid five million observations');
select is((select count(*) from ezyvet_migration_observation_chunk((select id from max_ids where k='manifest'),(select b.id from ezyvet_migration_bindings b join max_scopes s on s.scope=b.scope_id where s.n=100),981,20)),1000::bigint,'Last bounded chunk reaches final pages without scanning previous pages');
insert into max_ids values('preparation',gen_random_uuid());
select prepare_ezyvet_migration_projection((select id from max_ids where k='preparation'),(select id from max_ids where k='manifest'));
create temp table max_timings(binding_id uuid,first_page integer,prepare_ms numeric,aggregate_ms numeric,primary key(binding_id,first_page));
-- Two result columns cause psql to execute each DO independently in autocommit.
-- Do not combine both operations in one SQL string: that would share a transaction.
select format($query$do $window$ declare started timestamptz:=clock_timestamp();begin
 perform prepare_ezyvet_migration_source_chunk(%L,%L,%s);
 insert into max_timings values(%L,%s,extract(epoch from clock_timestamp()-started)*1000,null);
end $window$; /* LRV_SCALE_PREPARE %s */$query$,
 p.id,b.id,g.first_page,b.id,g.first_page,row_number() over(order by s.n,g.first_page)),
format($query$do $window$ declare started timestamptz:=clock_timestamp();begin
 perform aggregate_ezyvet_migration_source_chunk(%L,%L,%s);
 update max_timings set aggregate_ms=extract(epoch from clock_timestamp()-started)*1000 where binding_id=%L and first_page=%s;
end $window$; /* LRV_SCALE_AGGREGATE %s */$query$,
 p.id,b.id,g.first_page,b.id,g.first_page,row_number() over(order by s.n,g.first_page))
from max_ids p cross join max_scopes s join ezyvet_migration_bindings b on b.scope_id=s.scope
cross join generate_series(1,981,20) g(first_page) where p.k='preparation' order by s.n,g.first_page
\gexec
select is((select count(*) from max_timings where prepare_ms is not null and aggregate_ms is not null),5000::bigint,'Every source chunk completed both separately committed operations');
select is((select count(*) from max_timings),5000::bigint,'All five thousand source chunks were saved and aggregated');
select is((select sum(observation_count) from ezyvet_migration_source_chunks where preparation_id=(select id from max_ids where k='preparation')),5000000::bigint,'Persisted source chunks retain all five million observations');
select is((select records from ezyvet_migration_source_counts where preparation_id=(select id from max_ids where k='preparation') and metric='observed_occurrences'),5000000::bigint,'Complete aggregation retains five million physical occurrences');
select is((select records from ezyvet_migration_source_counts where preparation_id=(select id from max_ids where k='preparation') and metric='source_identities'),5000::bigint,'Repeated observations deduplicate to five thousand source identities');
select is((select records from ezyvet_migration_source_counts where preparation_id=(select id from max_ids where k='preparation') and metric='source_snapshots'),5000::bigint,'Repeated observations deduplicate to five thousand snapshots');
select is((select records from ezyvet_migration_source_counts where preparation_id=(select id from max_ids where k='preparation') and metric='occurrences_without_observed_head'),5000000::bigint,'Full traversal preserves unknown observation versions');
select is((select records from ezyvet_migration_coverage_counts where preparation_id=(select id from max_ids where k='preparation') and metric='observed_occurrences'),5000000::bigint,'Review denominator retains every source occurrence');
select is(read_ezyvet_migration_report_progress((select id from max_ids where k='preparation'))->>'missing_source_aggregations','0','No planned source calculation remains');
select is(read_ezyvet_migration_report_progress((select id from max_ids where k='preparation'))->>'report_ready','false','Complete source traversal alone does not claim report readiness');
select diag(jsonb_build_object('source_windows',count(*),'transaction_mode','independent_operations','total_window_ms',sum(prepare_ms+aggregate_ms),'slowest_prepare_ms',max(prepare_ms),'slowest_aggregate_ms',max(aggregate_ms),'slowest_combined_ms',max(prepare_ms+aggregate_ms),
 'source_chunks_bytes',pg_total_relation_size('ezyvet_migration_source_chunks'),
 'source_keys_bytes',pg_total_relation_size('ezyvet_migration_source_keys'),
 'coverage_keys_bytes',pg_total_relation_size('ezyvet_migration_coverage_keys'),
 'review_requirements_bytes',pg_total_relation_size('ezyvet_migration_review_requirements'))::text) from max_timings;
select * from finish();
-- Cleanup is the owned disposable database teardown, not rollback.
