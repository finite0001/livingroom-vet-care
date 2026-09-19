begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();


insert into auth.users(id,email,raw_user_meta_data) values('db700000-0000-4000-8000-000000000001','attachment-admin@example.test','{}'),('db700000-0000-4000-8000-000000000002','attachment-other@example.test','{}');
insert into user_roles(user_id,role) values('db700000-0000-4000-8000-000000000001','ADMIN'),('db700000-0000-4000-8000-000000000002','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Attachment','Owner','+13035550196','attachment@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Metadata dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select k,gen_random_uuid() from unnest(array['mapping','animal-run','run','run2','other-run']) k;
reset role;
insert into data select 'animal',to_jsonb(claim_ezyvet_import((select id from fx where k='animal-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','animal','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='animal-run'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='animal'),1,true,'[{"external_id":"77","payload":{"id":77}}]');
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select (select id from fx where k='mapping'),gen_random_uuid(),'synthetic-approved-mapping',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,(select id from fx where k='client'),(select id from fx where k='pet'),1,'link','Synthetic reviewed mapping','db700000-0000-4000-8000-000000000001' from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.resource='animal' and s.source_site_uid='attachment-test-site';

insert into fx select k,gen_random_uuid() from unnest(array['migration','scope','binding','contact-run','contact-mapping','contact-migration','contact-scope','contact-binding','new-run','new-binding']) k;
set local role authenticated;
select prepare_ezyvet_migration_run((select id from fx where k='migration'),'https://api.trial.ezyvet.com','attachment-test-site',(select jsonb_build_array(jsonb_build_object('id',(select id from fx where k='scope'),'mapping_id',id,'resource','animal','parent_type','animal','parent_snapshot_id',snapshot_id,'parent_head_version',head_version,'disposition','required','reason','Synthetic identity evidence')) from ezyvet_record_links where id=(select id from fx where k='mapping')));
select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='animal-run'),'Synthetic identity observation');
insert into data select 'item',list_ezyvet_migration_items((select id from fx where k='binding'))->'items'->0;
create function pg_temp.receipt(binding text default 'binding',item text default 'item') returns jsonb language sql as $$select read_ezyvet_migration_identity_evidence((select id from fx where k=binding),(v->>'page')::integer,(v->>'snapshot_id')::uuid,v->>'evidence_hash') from data where k=item;$$;
select is(pg_temp.receipt()->>'resource','animal','Patient mapping resource preserved');
select is(pg_temp.receipt()#>>'{approval,id}',(select id::text from fx where k='mapping'),'Exact declared mapping receipt');
select is(pg_temp.receipt()#>>'{approval,action}','link','Link action preserved');
select is(pg_temp.receipt()#>>'{approval,relationship}','same_snapshot_unknown_observed_head','Snapshot agreement is not an observed-version match');
select is(pg_temp.receipt()->>'observation_head_available','false','Missing observation head stays explicit');
select is(pg_temp.receipt()->>'exact_source_version_verified','false','No inferred exact version');
select is(pg_temp.receipt()->>'complete_coverage_verified','false','No inferred complete coverage');
select is(pg_temp.receipt()#>>'{approval,source_current}','true','Approved source version is current');
select is(pg_temp.receipt()#>>'{approval,local_record_unchanged}','true','Approved local version is unchanged');
select is(pg_temp.receipt()#>>'{approval,household_current}','true','Approved household association is current');
select ok(not pg_temp.receipt()::text ~ 'Synthetic reviewed|request_hash|payload_hash|reason|Metadata dog|attachment@example','No source or review prose exposed');
select throws_ok($$select read_ezyvet_migration_identity_evidence((select id from fx where k='binding'),1,(v->>'snapshot_id')::uuid,repeat('f',64)) from data where k='item'$$,'42501','Exact owned identity observation required','Forged evidence hash denied');
select throws_ok($$select read_ezyvet_migration_identity_evidence((select id from fx where k='binding'),2,(v->>'snapshot_id')::uuid,v->>'evidence_hash') from data where k='item'$$,'42501','Exact owned identity observation required','Wrong page denied');
select throws_ok($$select read_ezyvet_migration_identity_evidence((select id from fx where k='binding'),0,(v->>'snapshot_id')::uuid,v->>'evidence_hash') from data where k='item'$$,'23514','Invalid identity evidence observation','Invalid page denied');
reset role;
update ezyvet_identity_heads set version=version+2 where resource='animal' and source_site_uid='attachment-test-site';
update pets set version=version+1 where id=(select id from fx where k='pet');
set local role authenticated;
select is(pg_temp.receipt()#>>'{approval,source_current}','false','A to B to A invalidates approved source currentness');
select is(pg_temp.receipt()#>>'{approval,relationship}','same_snapshot_unknown_observed_head','Recurring payload still cannot establish observed head');
select is(pg_temp.receipt()#>>'{approval,local_record_unchanged}','false','Local edits remain separate from source snapshot agreement');
insert into fx select 'second-client',id from save_client(auth.uid(),null,null,'Second','Household','+13035550197','second@example.test','EMAIL',null,null);
reset role;
select throws_ok($$update pets set client_id=(select id from fx where k='second-client') where id=(select id from fx where k='pet')$$,'23514','Patient ownership transfer requires a separate workflow','Normal writes retain ownership transfer guard');
-- Synthetic historical drift only: restore the trigger immediately; outer transaction rolls back.
alter table pets disable trigger pets_version;
update pets set client_id=(select id from fx where k='second-client') where id=(select id from fx where k='pet');
alter table pets enable trigger pets_version;
set local role authenticated;
select is(pg_temp.receipt()#>>'{approval,household_current}','false','Patient household reassignment remains visible without rewriting mapping');
reset role;
-- A fresh generic run observes a different payload for the manifest-selected identity.
update ezyvet_import_runs set retry_after=null where resource='animal';
insert into data select 'new-claim',to_jsonb(claim_ezyvet_import((select id from fx where k='new-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','animal','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='new-run'),'db700000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='new-claim'),1,true,'[{"external_id":"77","payload":{"id":77,"name":"Changed outside name"}},{"external_id":"88","payload":{"id":88,"name":"Unrelated patient"}}]');
set local role authenticated;
select bind_ezyvet_migration_child((select id from fx where k='new-binding'),(select id from fx where k='scope'),(select id from fx where k='new-run'),'Observe changed source without changing identity approval',(select id from fx where k='binding'));
insert into data select 'new-item',list_ezyvet_migration_items((select id from fx where k='new-binding'))->'items'->0;
select is(jsonb_array_length(list_ezyvet_migration_items((select id from fx where k='new-binding'))->'items'),1,'Unrelated patient excluded from shared scan');
select is(pg_temp.receipt('new-binding','new-item')#>>'{approval,relationship}','different_snapshot','Changed source observation does not replace approved mapping');
select is(pg_temp.receipt('new-binding','new-item')#>>'{approval,id}',(select id::text from fx where k='mapping'),'Original approved mapping retained after changed scan');
reset role;
-- Contact identity has a household-only approved mapping.
insert into data select 'contact-claim',to_jsonb(claim_ezyvet_import((select id from fx where k='contact-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','contact','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='contact-run'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='contact-claim'),1,true,'[{"external_id":"55","payload":{"id":55}}]');
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select (select id from fx where k='contact-mapping'),gen_random_uuid(),'synthetic-contact',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,(select id from fx where k='client'),null,1,'create','Synthetic contact approval','db700000-0000-4000-8000-000000000001' from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.resource='contact' and s.source_site_uid='attachment-test-site';
set local role authenticated;
select prepare_ezyvet_migration_run((select id from fx where k='contact-migration'),'https://api.trial.ezyvet.com','attachment-test-site',(select jsonb_build_array(jsonb_build_object('id',(select id from fx where k='contact-scope'),'mapping_id',id,'resource','contact','parent_type','contact','parent_snapshot_id',snapshot_id,'parent_head_version',head_version,'disposition','required','reason','Synthetic contact evidence')) from ezyvet_record_links where id=(select id from fx where k='contact-mapping')));
select bind_ezyvet_migration_child((select id from fx where k='contact-binding'),(select id from fx where k='contact-scope'),(select id from fx where k='contact-run'),'Synthetic contact observation');
insert into data select 'contact-item',list_ezyvet_migration_items((select id from fx where k='contact-binding'))->'items'->0;
select is(pg_temp.receipt('contact-binding','contact-item')->>'resource','contact','Household mapping resource preserved');
select is(pg_temp.receipt('contact-binding','contact-item')#>>'{approval,action}','create','Create receipt remains distinct from link');
select is(pg_temp.receipt('contact-binding','contact-item')#>>'{approval,local_record_unchanged}','true','Household version comparison uses client record');
select is(pg_temp.receipt('contact-binding','contact-item')#>>'{approval,household_current}','true','Household-only mapping requires no patient');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.receipt()$$,'42501','Exact owned identity observation required','Other administrator cannot use binding evidence');
reset role;update profiles set is_active=false where id='db700000-0000-4000-8000-000000000001';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select pg_temp.receipt()$$,'42501','Active administrator required','Inactive administrator denied');
reset role;
select ok(not has_function_privilege('anon','public.read_ezyvet_migration_identity_evidence(uuid,integer,uuid,text)','execute'),'Anonymous execution denied');
select ok(not has_function_privilege('service_role','public.read_ezyvet_migration_identity_evidence(uuid,integer,uuid,text)','execute'),'Worker execution denied');

-- Internal invoker-only projection is exercised as database owner, with explicit actor claims.
reset role;
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
update profiles set is_active=true where id='db700000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from ezyvet_migration_terminal_observations((select id from fx where k='migration'))),1::bigint,'Only selected identity in terminal binding is counted');
select is((select binding_id from ezyvet_migration_terminal_observations((select id from fx where k='migration'))),(select id from fx where k='new-binding'),'Replacement binding excludes predecessor observations');
select is((select evidence_hash from ezyvet_migration_terminal_observations((select id from fx where k='migration'))),(select v->>'evidence_hash' from data where k='new-item'),'Internal hash equals canonical drill-down hash');
select ok((select observed_head_version is null from ezyvet_migration_terminal_observations((select id from fx where k='migration'))),'Unavailable observed head stays null');
select is((select count(*) from ezyvet_migration_terminal_observations((select id from fx where k='contact-migration'))),1::bigint,'Contact-only manifest is independently projected');
select is((select count(*) from ezyvet_migration_terminal_observations(gen_random_uuid())),0::bigint,'Unknown manifest returns no internal observations');
select is(ezyvet_migration_source_totals((select id from fx where k='migration'))#>>'{resources,0,observed_occurrences}','1','Current source total excludes predecessor and unrelated identity');
select is(ezyvet_migration_source_totals((select id from fx where k='migration'))#>>'{resources,0,occurrences_without_observed_head}','1','Unknown observed version explicitly counted');
select is(ezyvet_migration_source_totals((select id from fx where k='migration'))->>'historical_bindings','1','Historical attempt retained separately');
select is(ezyvet_migration_source_totals((select id from fx where k='migration'))#>'{resources,0,provider_total}','null'::jsonb,'Provider total remains unknown');
select is(ezyvet_migration_source_totals((select id from fx where k='migration'))->>'cutover_accepted','false','Source totals cannot accept cutover');
select is(ezyvet_migration_source_totals(gen_random_uuid()),null::jsonb,'Unknown manifest is not an empty successful summary');
select is((select receipt_kind from ezyvet_migration_terminal_standard_receipts((select id from fx where k='migration'))),'identity_mapping','Terminal patient observation uses declared identity approval');
select is((select native_id from ezyvet_migration_terminal_standard_receipts((select id from fx where k='migration'))),(select id from fx where k='pet'),'Native patient identity kept separate from approval identity');
select is((select relationship from ezyvet_migration_terminal_standard_receipts((select id from fx where k='migration'))),'different_snapshot','Changed observation does not receive original approval version credit');
select ok((select local_changed from ezyvet_migration_terminal_standard_receipts((select id from fx where k='migration'))),'Local edit remains visible in standard receipt');
select ok(not has_function_privilege('authenticated','public.ezyvet_migration_terminal_standard_receipts(uuid)','execute'),'Standard receipt helper remains internal');

select ok(not has_function_privilege('authenticated','public.ezyvet_migration_source_totals(uuid)','execute'),'Unfinished summary remains internal');
select is((select evidence_hash from ezyvet_migration_observation_chunk((select id from fx where k='migration'),(select id from fx where k='new-binding'),1,1)),(select v->>'evidence_hash' from data where k='new-item'),'Chunk preserves canonical occurrence hash');
select is((select count(*) from ezyvet_migration_observation_chunk((select id from fx where k='migration'),(select id from fx where k='new-binding'),2,1)),0::bigint,'Page window never replays earlier observations');
select is((select count(*) from ezyvet_migration_observation_chunk((select id from fx where k='migration'),(select id from fx where k='binding'),1,1)),0::bigint,'Chunk excludes replaced binding');
select throws_ok($$select * from ezyvet_migration_observation_chunk((select id from fx where k='migration'),(select id from fx where k='new-binding'),1,21)$$,'23514','Invalid migration observation chunk','Chunk rejects unbounded page request');
select throws_ok($$select * from ezyvet_migration_observation_chunk((select id from fx where k='migration'),(select id from fx where k='new-binding'),1000,2)$$,'23514','Invalid migration observation chunk','Chunk cannot exceed source page limit');
select ok(not has_function_privilege('authenticated','public.ezyvet_migration_observation_chunk(uuid,uuid,integer,integer)','execute'),'Chunk reader remains internal');

select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))#>>'{scans,distinct_child_runs}','1','Only terminal required child contributes scan progress');
select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))#>>'{scans,traversal_ended}','1','Ended traversal remains separate from accepted coverage');
select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))->>'complete_coverage_verified','false','Ended scan cannot imply complete coverage');
select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))->>'pages_observed','1','Predecessor pages are not counted in current scan');
select is(ezyvet_migration_scan_totals(gen_random_uuid()),null::jsonb,'Unknown scan manifest denied');
select ok(not has_function_privilege('authenticated','public.ezyvet_migration_scan_totals(uuid)','execute'),'Scan summary stays internal');
update ezyvet_import_runs set status='page_limit_reached',retry_after=now()+interval '1 hour' where id=(select child_run_id from ezyvet_migration_bindings where id=(select id from fx where k='new-binding'));
select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))#>>'{scans,page_limited}','1','Page-limited traversal cannot be presented as ended');
select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))#>>'{scans,traversal_ended}','0','Page limit removes ended-traversal credit');
select is(ezyvet_migration_scan_totals((select id from fx where k='migration'))#>>'{scans,cooling_down}','1','Cooldown remains visible independently of page limit');


insert into fx values('preparation',gen_random_uuid());
insert into data select 'preparation',prepare_ezyvet_migration_projection((select id from fx where k='preparation'),(select id from fx where k='migration'));
select is(prepare_ezyvet_migration_projection((select id from fx where k='preparation'),(select id from fx where k='migration')),(select v from data where k='preparation'),'Preparation retry recovers exact saved identity');
select is((select v->>'planned_scope_pages' from data where k='preparation'),'1','Preparation captures terminal page inventory');
select is((select v->>'report_ready' from data where k='preparation'),'false','Preparation does not claim assembled report');
select throws_ok($$select prepare_ezyvet_migration_projection((select id from fx where k='preparation'),(select id from fx where k='contact-migration'))$$,'42501','Preparation identity cannot change','Preparation ID cannot be repurposed');
insert into fx values('unprocessed-preparation',gen_random_uuid());
select prepare_ezyvet_migration_projection((select id from fx where k='unprocessed-preparation'),(select id from fx where k='migration'));
insert into data select 'saved-chunk',prepare_ezyvet_migration_source_chunk((select id from fx where k='preparation'),(select id from fx where k='new-binding'),1);
select is(prepare_ezyvet_migration_source_chunk((select id from fx where k='preparation'),(select id from fx where k='new-binding'),1),(select v from data where k='saved-chunk'),'Chunk replay returns exact persisted receipt');
select is((select v->>'observations' from data where k='saved-chunk'),'1','Persisted chunk contains selected source observation');
select is((select entries#>>'{0,evidence_hash}' from ezyvet_migration_source_chunks where preparation_id=(select id from fx where k='preparation')),(select v->>'evidence_hash' from data where k='new-item'),'Persisted source evidence retains canonical hash');
select throws_ok($$select prepare_ezyvet_migration_source_chunk((select id from fx where k='preparation'),(select id from fx where k='new-binding'),2)$$,'23514','Invalid preparation chunk identity','Chunk ranges cannot overlap by shifting start page');
select throws_ok($$select prepare_ezyvet_migration_source_chunk((select id from fx where k='preparation'),(select id from fx where k='new-binding'),21)$$,'23514','Chunk outside prepared inventory','Chunk cannot extend saved source inventory');
update patient_problems set version=version where false;
select throws_ok($$select prepare_ezyvet_migration_source_chunk((select id from fx where k='unprocessed-preparation'),(select id from fx where k='new-binding'),1)$$,'40001','Prepared dependencies changed; create a new preparation','New source chunk rejects changed dependencies even with unchanged page inventory');
insert into ezyvet_import_pages(run_id,page,item_count) values((select id from fx where k='new-run'),2,0);
select is(prepare_ezyvet_migration_source_chunk((select id from fx where k='preparation'),(select id from fx where k='new-binding'),1),(select v from data where k='saved-chunk'),'Historical chunk recovery remains exact after source pages change');
select throws_ok($$select prepare_ezyvet_migration_source_chunk((select id from fx where k='unprocessed-preparation'),(select id from fx where k='new-binding'),1)$$,'40001','Prepared source inventory changed','New chunk rejects stale prepared inventory');
select is((select count(*) from ezyvet_migration_source_chunks where preparation_id=(select id from fx where k='unprocessed-preparation')),0::bigint,'Rejected stale preparation saves no partial chunk');
select ok(not has_table_privilege('authenticated','public.ezyvet_migration_source_chunks','select'),'Source chunks stay private');
select ok(not has_function_privilege('authenticated','public.prepare_ezyvet_migration_source_chunk(uuid,uuid,integer)','execute'),'Incomplete chunk workflow stays internal');

select is(prepare_ezyvet_migration_projection((select id from fx where k='preparation'),(select id from fx where k='migration')),(select v from data where k='preparation'),'Replay preserves original plan after more source pages arrive');
insert into data select 'new-preparation',prepare_ezyvet_migration_projection(gen_random_uuid(),(select id from fx where k='migration'));
select is((select v->>'planned_scope_pages' from data where k='new-preparation'),'2','New preparation captures expanded inventory');
select isnt((select v->>'plan_hash' from data where k='new-preparation'),(select v->>'plan_hash' from data where k='preparation'),'Changed page inventory changes preparation digest');
select ok(not has_table_privilege('authenticated','public.ezyvet_migration_preparations','select'),'Preparation plans are not directly exposed');
select ok(not has_function_privilege('authenticated','public.prepare_ezyvet_migration_projection(uuid,uuid)','execute'),'Incomplete preparation workflow stays private');
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='preparation'))->>'stored_source_chunks','1','Progress recovers saved source chunk after reload');
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='preparation'))->>'source_chunks_saved','true','Original preparation has its complete saved chunk set');
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='preparation'))->>'changed_source_inventories','1','Saved chunk completeness does not hide later inventory drift');
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='preparation'))->>'report_ready','false','Source chunk completeness is not completed report');
select is(read_ezyvet_migration_preparation_progress((select (v->>'id')::uuid from data where k='new-preparation'))#>>'{scopes,0,next_missing_page}','1','Fresh preparation resumes at first missing chunk');
select is(read_ezyvet_migration_preparation_progress((select (v->>'id')::uuid from data where k='new-preparation'))->>'changed_source_inventories','0','Fresh inventory agrees with source pages');
select prepare_ezyvet_migration_source_chunk((select (v->>'id')::uuid from data where k='new-preparation'),(select id from fx where k='new-binding'),1);
select is(read_ezyvet_migration_preparation_progress((select (v->>'id')::uuid from data where k='new-preparation'))#>'{scopes,0,next_missing_page}','null'::jsonb,'Saved final chunk clears continuation cursor');
select is(read_ezyvet_migration_preparation_progress((select (v->>'id')::uuid from data where k='new-preparation'))#>>'{scopes,0,stored_scope_observations}','1','Progress counts observations without counting empty source page as a record');
select ok(not has_function_privilege('authenticated','public.read_ezyvet_migration_preparation_progress(uuid)','execute'),'Progress remains internal until complete workflow');
insert into ezyvet_import_pages(run_id,page,item_count) select (select id from fx where k='new-run'),n,0 from generate_series(3,41) n;
insert into fx values('progress-preparation',gen_random_uuid());
select prepare_ezyvet_migration_projection((select id from fx where k='progress-preparation'),(select id from fx where k='migration'));
select prepare_ezyvet_migration_source_chunk((select id from fx where k='progress-preparation'),(select id from fx where k='new-binding'),1);
select prepare_ezyvet_migration_source_chunk((select id from fx where k='progress-preparation'),(select id from fx where k='new-binding'),41);
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='progress-preparation'))#>>'{scopes,0,next_missing_page}','21','Saved first and last chunks do not hide missing middle range');
select is(read_ezyvet_migration_report_progress((select id from fx where k='progress-preparation'))->>'missing_source_chunks','1','Report progress detects missing middle source range');
select is(read_ezyvet_migration_report_progress((select id from fx where k='progress-preparation'))->>'missing_review_chunks','3','Source chunks alone never satisfy review completion');
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='progress-preparation'))->>'source_chunks_saved','false','Out-of-order completion cannot claim full source collection');
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='progress-preparation'))->>'expected_source_chunks','3','Page inventory determines exact expected chunk count');
select prepare_ezyvet_migration_source_chunk((select id from fx where k='progress-preparation'),(select id from fx where k='new-binding'),21);
select is(read_ezyvet_migration_preparation_progress((select id from fx where k='progress-preparation'))->>'source_chunks_saved','true','Completing middle range closes the source collection gap');
-- Same-time immutable fixture headers exercise the ID tiebreaker without mutating saved preparations.
insert into ezyvet_migration_preparations(id,actor_id,migration_run_id,request_hash,intent_hash,plan_hash,plan,created_at,dependency_snapshot,dependency_transaction,dependency_boundary)
select id,p.actor_id,p.migration_run_id,p.request_hash,p.intent_hash,p.plan_hash,p.plan,'2050-01-01T00:00:00Z',p.dependency_snapshot,p.dependency_transaction,p.dependency_boundary
from (values('dc980000-0000-4000-8000-000000000001'::uuid),('dc980000-0000-4000-8000-000000000002'::uuid)) ids(id)
cross join lateral (select actor_id,migration_run_id,request_hash,intent_hash,plan_hash,plan,dependency_snapshot,dependency_transaction,dependency_boundary from ezyvet_migration_preparations where id=(select id from fx where k='preparation')) p;
insert into data select 'preparation-page',list_ezyvet_migration_preparations((select id from fx where k='migration'),null,null,1);
select is((select v#>>'{preparations,0,id}' from data where k='preparation-page'),'dc980000-0000-4000-8000-000000000002','History deterministically orders equal creation times by ID');
select is((select v->>'has_more' from data where k='preparation-page'),'true','Preparation history uses a bounded sentinel');
insert into data select 'preparation-page2',list_ezyvet_migration_preparations((select id from fx where k='migration'),(v#>>'{next_cursor,before_at}')::timestamptz,(v#>>'{next_cursor,before_id}')::uuid,1) from data where k='preparation-page';
select is((select v#>>'{preparations,0,id}' from data where k='preparation-page2'),'dc980000-0000-4000-8000-000000000001','Cursor recovers tied predecessor without skipping or repeating');
select is(jsonb_array_length(list_ezyvet_migration_preparations((select id from fx where k='migration'),'2000-01-01T00:00:00Z',gen_random_uuid(),1)->'preparations'),0,'History terminates with no older preparations');
select is(list_ezyvet_migration_preparations((select id from fx where k='migration'),'2000-01-01T00:00:00Z',gen_random_uuid(),1)->'next_cursor','null'::jsonb,'Terminal history page has no continuation cursor');
select throws_ok($$select list_ezyvet_migration_preparations((select id from fx where k='migration'),now(),null,20)$$,'23514','Invalid preparation history cursor','Partial cursor rejected');
select throws_ok($$select list_ezyvet_migration_preparations((select id from fx where k='migration'),null,null,101)$$,'23514','Invalid preparation history cursor','Unbounded history request rejected');
select ok(not (select v#>'{preparations,0}' ? 'plan' from data where k='preparation-page'),'History omits stored source plan');
select ok(not has_function_privilege('authenticated','public.list_ezyvet_migration_preparations(uuid,timestamptz,uuid,integer)','execute'),'Preparation history stays private');



select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from ezyvet_migration_terminal_observations((select id from fx where k='migration'))),0::bigint,'Other active admin excluded by ownership even as invoker test owner');
select throws_ok($$select prepare_ezyvet_migration_projection((select id from fx where k='preparation'),(select id from fx where k='migration'))$$,'42501','Owned migration manifest required','Other administrator cannot recover preparation');
select throws_ok($$select prepare_ezyvet_migration_source_chunk((select id from fx where k='preparation'),(select id from fx where k='new-binding'),1)$$,'42501','Owned preparation required','Other administrator cannot recover saved chunk');
select throws_ok($$select read_ezyvet_migration_preparation_progress((select id from fx where k='preparation'))$$,'42501','Owned preparation required','Foreign administrator cannot read preparation progress');
select throws_ok($$select list_ezyvet_migration_preparations((select id from fx where k='migration'))$$,'42501','Owned migration manifest required','Foreign administrator cannot discover preparations');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update profiles set is_active=false where id=auth.uid();
select is((select count(*) from ezyvet_migration_terminal_observations((select id from fx where k='migration'))),0::bigint,'Inactive owner excluded');
select throws_ok($$select read_ezyvet_migration_preparation_progress((select id from fx where k='preparation'))$$,'42501','Active administrator required','Inactive owner cannot read progress');
select throws_ok($$select list_ezyvet_migration_preparations((select id from fx where k='migration'))$$,'42501','Active administrator required','Inactive owner cannot list preparations');
select ok(not has_function_privilege('authenticated','public.ezyvet_migration_terminal_observations(uuid)','execute'),'Internal projection not exposed to authenticated');
select ok(not has_function_privilege('anon','public.ezyvet_migration_terminal_observations(uuid)','execute'),'Internal projection not exposed to anonymous');
select ok(not has_function_privilege('service_role','public.ezyvet_migration_terminal_observations(uuid)','execute'),'Internal projection not exposed to workers');
select * from finish();rollback;
