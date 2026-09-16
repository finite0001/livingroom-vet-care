begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
-- FIXTURE_BEGIN
insert into auth.users(id,email,raw_user_meta_data) values
 ('a5510000-0000-4000-8000-000000000001','native-rx-dvm@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000002','native-rx-staff@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000003','native-rx-uncommissioned@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000004','native-rx-admin@example.test','{}');
update profiles set full_name='Synthetic prescriber' where id='a5510000-0000-4000-8000-000000000001';
insert into user_roles(user_id,role) values('a5510000-0000-4000-8000-000000000001','DVM'),('a5510000-0000-4000-8000-000000000001','ADMIN'),('a5510000-0000-4000-8000-000000000003','DVM'),('a5510000-0000-4000-8000-000000000004','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Native','Household',null,null,'EMAIL','2619 Synthetic Street',null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Native Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'product',id from save_catalog_product(null,null,'Synthetic medication','medication','','tablet',100,true);
insert into fx select k,gen_random_uuid() from unnest(array['config','save','draft','sign','save2','draft2']) k;
insert into data values('config-request',jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31','practice_name','Synthetic practice','practice_address','2619 Synthetic Street','practice_phone',null,'clinical_review_note','Synthetic fixture only')));
insert into data select 'fields',jsonb_build_object('encounter_id',null,'medication',jsonb_build_object('name','Synthetic medication','strength','Synthetic strength','form','Synthetic form','directions','Synthetic directions only','route','Synthetic route'),'quantity_per_fill','30','unit','tablet','refills_authorized',2,'fulfillment_mode','practice_stock','product_id',(select id from fx where k='product'),'starts_on',(now() at time zone 'America/Denver')::date,'expires_on','2099-12-31');
insert into data select 'save-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'expected_version',null,'fields',v) from data where k='fields';
-- FIXTURE_END

insert into fx select k,gen_random_uuid() from unnest(array['refill','create','assign','link','close','refill2','create2']) k;
insert into data select 'create-request',jsonb_build_object('refill_id',(select id from fx where k='refill'),'pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'medication_requested','Client requested synthetic medication','requester_note',null,'channel','phone','reason','Client intake recorded');
insert into data select 'create-receipt',create_native_refill((select id from fx where k='create'),(select v from data where k='create-request'));
select is((select v#>>'{result,after,state}' from data where k='create-receipt'),'open','Intake begins open without approval');
select is((select v#>'{result,after,authorization_id}' from data where k='create-receipt'),'null'::jsonb,'Intake starts unlinked');
select is(create_native_refill((select id from fx where k='create'),(select v from data where k='create-request')),(select v from data where k='create-receipt'),'Create exact retry');
select is(recover_native_refill_operation((select id from fx where k='create')),(select v from data where k='create-receipt'),'Create exact recovery');
select throws_ok($$select create_native_refill((select id from fx where k='create'),(select v||'{"reason":"Substitution"}' from data where k='create-request'))$$,'23514','Refill operation identity cannot change','No request substitution');
select throws_ok($$select create_native_refill(gen_random_uuid(),(select v from data where k='create-request'))$$,'40001','Refill changed','Different create UUID cannot overwrite');
select throws_ok($$select create_native_refill(gen_random_uuid(),(select v||'{"status":"APPROVED"}' from data where k='create-request'))$$,'23514','Exact prescription fields required','No clinical state fields accepted');
select is(read_native_refill((select id from fx where k='refill'),gen_random_uuid()),null::jsonb,'Wrong patient read absent');
insert into data select 'assign-request',jsonb_build_object('refill_id',(select id from fx where k='refill'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'action','assign','reason','Assign operational follow up','assigned_to','a5510000-0000-4000-8000-000000000002','authorization_id',null,'expected_link_context_hash',null);
insert into data select 'assign-receipt',transition_native_refill((select id from fx where k='assign'),(select v from data where k='assign-request'));
select is((select v#>>'{result,after,version}' from data where k='assign-receipt'),'2','Assignment increments version');
select is((select v#>>'{result,prior_event_id}' from data where k='assign-receipt'),(select id::text from fx where k='create'),'Immutable transition chains predecessor');
select throws_ok($$select transition_native_refill(gen_random_uuid(),(select v from data where k='assign-request'))$$,'40001','Refill changed','Stale assignment denied');
select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(recover_native_refill_operation((select id from fx where k='create')),null::jsonb,'Foreign actor cannot recover');
select throws_ok($$select create_native_refill((select id from fx where k='create'),(select v from data where k='create-request'))$$,'23514','Refill operation identity cannot change','Foreign actor cannot reuse operation UUID');
select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select configure_native_prescriber((select id from fx where k='config'),(select v from data where k='config-request'));
select save_native_prescription_draft((select id from fx where k='save'),(select v from data where k='save-request'));
select sign_native_prescription((select id from fx where k='sign'),jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign((select id from fx where k='draft'),1)->>'context_hash','signature_name','Synthetic prescriber','attest_review',true));
insert into data select 'link-request',jsonb_build_object('refill_id',(select id from fx where k='refill'),'pet_id',(select id from fx where k='pet'),'expected_version',2,'action','link','reason','Exact signed order reviewed for operational association','assigned_to',null,'authorization_id',(select id from fx where k='sign'),'expected_link_context_hash',preview_native_refill_link((select id from fx where k='refill'),(select id from fx where k='pet'),(select id from fx where k='sign'))->>'context_hash');
select throws_ok($$select transition_native_refill(gen_random_uuid(),(select v||jsonb_build_object('expected_link_context_hash',repeat('0',64)) from data where k='link-request'))$$,'40001','Refill authorization context changed','Stale link evidence denied');
insert into data select 'link-receipt',transition_native_refill((select id from fx where k='link'),(select v from data where k='link-request'));
select is(read_native_refill((select id from fx where k='refill'),(select id from fx where k='pet'))#>>'{authorization_status,state}','active','Linked authorization current state disclosed');
reset role;
select is((select provolatile::text from pg_proc where oid='public.native_refill_authorization_observation(uuid,text,uuid)'::regprocedure),'s','Authorization observation uses one stable MVCC snapshot');
select ok(not has_function_privilege('authenticated','native_refill_authorization_observation(uuid,text,uuid)','execute'),'Private lock-free observation is not a public authority bypass');
set local role authenticated;

select is(read_native_refill((select id from fx where k='refill'),(select id from fx where k='pet'))->>'head_id',(select id::text from fx where k='link'),'Read head bound to exact refill revision');
select cancel_native_prescription(gen_random_uuid(),jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'expected_event_id',null,'expected_context_hash',preview_native_prescription_cancel((select id from fx where k='sign'),(select id from fx where k='pet'))->>'context_hash','reason','Synthetic later cancellation','attest_review',true));
select is(read_native_refill((select id from fx where k='refill'),(select id from fx where k='pet'))#>>'{authorization_status,state}','cancelled','Later cancellation immediately disclosed');
select is(read_native_refill((select id from fx where k='refill'),(select id from fx where k='pet'))#>>'{refill,authorization_id}',(select id::text from fx where k='sign'),'Terminal link identity retained');
select is(transition_native_refill((select id from fx where k='link'),(select v from data where k='link-request')),(select v from data where k='link-receipt'),'Historical link receipt preserved after cancellation');
insert into data select 'terminal-link',v||jsonb_build_object('expected_version',3,'expected_link_context_hash',preview_native_refill_link((select id from fx where k='refill'),(select id from fx where k='pet'),(select id from fx where k='sign'))->>'context_hash') from data where k='link-request';
select throws_ok($$select transition_native_refill(gen_random_uuid(),(select v from data where k='terminal-link'))$$,'23514','Active authorization required for new refill link','Cannot create a new terminal authorization link');
insert into data select 'page',list_native_refill_events((select id from fx where k='refill'),(select id from fx where k='pet'),null,null,2);
select ok((select(v->>'has_more')::boolean from data where k='page'),'History sentinel exposes older event');
select is((select jsonb_array_length(list_native_refill_events((select id from fx where k='refill'),(select id from fx where k='pet'),(v#>>'{next_cursor,before_at}')::timestamptz,(v#>>'{next_cursor,before_id}')::uuid,2)->'events') from data where k='page'),1,'History cursor retains exact oldest event');
select throws_ok($$select list_native_refills(null,now(),null,20)$$,'23514','Invalid refill cursor','Half queue cursor denied');
select throws_ok($$select list_legacy_refills(null,null,101)$$,'23514','Invalid refill cursor','Legacy list bounded');

-- Independent open intake for deny, queue and relationship eligibility cases.
select create_native_refill((select id from fx where k='create2'),(select v||jsonb_build_object('refill_id',(select id from fx where k='refill2')) from data where k='create-request'));
insert into data select 'queue-page',list_native_refills((select id from fx where k='pet'),null,null,1);
select ok((select(v->>'has_more')::boolean from data where k='queue-page'),'Native queue sentinel exposes next intake');
select is((select jsonb_array_length(list_native_refills((select id from fx where k='pet'),(v#>>'{next_cursor,before_at}')::timestamptz,(v#>>'{next_cursor,before_id}')::uuid,1)->'refills') from data where k='queue-page'),1,'Native queue keyset retains older intake');
insert into data select 'assign2',v||jsonb_build_object('refill_id',(select id from fx where k='refill2')) from data where k='assign-request';
reset role;update profiles set is_active=false where id='a5510000-0000-4000-8000-000000000002';set local role authenticated;
select throws_ok($$select transition_native_refill(gen_random_uuid(),(select v from data where k='assign2'))$$,'23514','Active staff assignee required','Inactive staff cannot receive assignment');
reset role;update profiles set is_active=true where id='a5510000-0000-4000-8000-000000000002';delete from user_roles where user_id='a5510000-0000-4000-8000-000000000002';set local role authenticated;
select throws_ok($$select transition_native_refill(gen_random_uuid(),(select v from data where k='assign2'))$$,'23514','Active staff assignee required','Active profile without staff role cannot receive assignment');
reset role;insert into user_roles(user_id,role) values('a5510000-0000-4000-8000-000000000002','STAFF');set local role authenticated;
insert into fx select 'other-client',id from save_client(auth.uid(),null,null,'Other','Household',null,null,'EMAIL','Synthetic other street',null);
-- Rollback-only synthetic historical drift; production ownership guard remains unchanged.
reset role;alter table public.pets disable trigger pets_version;
update pets set client_id=(select id from fx where k='other-client') where id=(select id from fx where k='pet');
alter table public.pets enable trigger pets_version;
select is((select tgenabled::text from pg_trigger where tgrelid='public.pets'::regclass and tgname='pets_version'),'O','Patient ownership guard restored before assertions');
set local role authenticated;
select throws_ok($$select preview_native_refill_link((select id from fx where k='refill2'),(select id from fx where k='pet'),(select id from fx where k='sign'))$$,'23514','Current open refill patient and household required','Moved household cannot link historical household authorization');
select is(read_native_refill((select id from fx where k='refill2'),(select id from fx where k='pet'))->>'household_matches','false','Read explicitly discloses household mismatch');
insert into data select 'deny2',v||jsonb_build_object('action','deny','assigned_to',null,'reason','Operational duplicate declined; no clinical decision') from data where k='assign2';
insert into data select 'deny2-receipt',transition_native_refill(gen_random_uuid(),(select v from data where k='deny2'));
select is((select v#>>'{result,after,state}' from data where k='deny2-receipt'),'denied','Operational deny succeeds even after household moved');
select is((select v#>>'{result,actor_id}' from data where k='deny2-receipt'),'a5510000-0000-4000-8000-000000000001','Operational denial records actual staff actor');
-- Rollback-only synthetic historical drift; production ownership guard remains unchanged.
reset role;alter table public.pets disable trigger pets_version;
update pets set client_id=(select id from fx where k='client') where id=(select id from fx where k='pet');
alter table public.pets enable trigger pets_version;
select is((select tgenabled::text from pg_trigger where tgrelid='public.pets'::regclass and tgname='pets_version'),'O','Patient ownership guard restored before assertions');
set local role authenticated;

reset role;update pets set archived_at=clock_timestamp(),deceased_at=current_date where id=(select id from fx where k='pet');set local role authenticated;
insert into data select 'close-request',jsonb_build_object('refill_id',(select id from fx where k='refill'),'pet_id',(select id from fx where k='pet'),'expected_version',3,'action','close','reason','Operational duplicate closed; not clinical approval','assigned_to',null,'authorization_id',null,'expected_link_context_hash',null);
insert into data select 'close-receipt',transition_native_refill((select id from fx where k='close'),(select v from data where k='close-request'));
select is(read_native_refill((select id from fx where k='refill'),(select id from fx where k='pet'))#>>'{refill,state}','closed','Historical archived deceased request can close');
select throws_ok($$select transition_native_refill(gen_random_uuid(),(select v||'{"expected_version":4,"action":"deny"}' from data where k='close-request'))$$,'23514','Refill is already terminal','Closed cannot transition again');
select is(create_native_refill((select id from fx where k='create'),(select v from data where k='create-request')),(select v from data where k='create-receipt'),'Original intake receipt survives closure');
select throws_ok($$insert into refill_requests(client_id) values((select id from fx where k='client'))$$,'42501',null,'Staff cannot create legacy refill');
select throws_ok($$update refill_requests set status='APPROVED'$$,'42501',null,'Staff cannot approve legacy rows');
reset role;set local role service_role;
select throws_ok($$insert into refill_requests(client_id) values('00000000-0000-4000-8000-000000000001')$$,'42501',null,'Worker cannot create legacy refill');
select throws_ok($$truncate refill_requests$$,'42501',null,'Worker cannot truncate legacy history');
reset role;
select throws_ok($$insert into refill_requests(client_id) values((select id from fx where k='client'))$$,'23514','Legacy refill history is read-only and unverified','Definer/privileged writes also refused');
select throws_ok($$update native_refill_events set reason='Changed' where refill_id=(select id from fx where k='refill')$$,'23514',null,'Immutable transition history');
select is((select count(*) from native_refill_events where refill_id=(select id from fx where k='refill')),4::bigint,'Exactly intended four transitions');
select is((select count(*) from inventory_movements where created_by='a5510000-0000-4000-8000-000000000001'),0::bigint,'No stock effects');
select is((select count(*) from billing_invoice_items where created_by='a5510000-0000-4000-8000-000000000001'),0::bigint,'No charge effects');
select is((select count(*) from patient_treatments where pet_id=(select id from fx where k='pet')),0::bigint,'No administration effects');
select ok(not has_function_privilege('authenticated','native_refill_finish(uuid,text,jsonb,jsonb,native_refills,text,jsonb)','execute'),'Private event writer denied');
update profiles set is_active=false where id='a5510000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select recover_native_refill_operation((select id from fx where k='create'))$$,'42501','Active staff access required','Inactive actor cannot recover');
reset role;select * from finish();rollback;
