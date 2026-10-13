begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('48000000-0000-4000-8000-000000000001','catalog-dvm@example.test','{"first_name":"Catalog","last_name":"Vet"}'),
 ('48000000-0000-4000-8000-000000000002','catalog-staff@example.test','{"first_name":"Catalog","last_name":"Staff"}');
update profiles set is_active=true where id::text like '48000000%';
insert into user_roles(user_id,role) values('48000000-0000-4000-8000-000000000001','DVM'),('48000000-0000-4000-8000-000000000002','STAFF') on conflict do nothing;
insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email,preferred_channel) values
 ('48100000-0000-4000-8000-000000000001','Catalog','Client','Catalog Client','+13035550155','catalog-client@example.test','SMS');
insert into pets(id,client_id,name,species,breed) values
 ('48200000-0000-4000-8000-000000000001','48100000-0000-4000-8000-000000000001','Catalog Dog','Dog','Mixed'),
 ('48200000-0000-4000-8000-000000000002','48100000-0000-4000-8000-000000000001','Catalog Cat','Cat','Mixed');
create temp table fixture(key text primary key,value jsonb);grant all on fixture to authenticated;
insert into fixture values ('type', '{"name":"Reviewed wellness","category":"well","species":["Dog"],"visit_types":["clinic","housecall"],"duration_minutes":30,"travel_before_minutes":0,"travel_after_minutes":0,"resource_kind":"exam","staffing":"dvm","allow_override":true}'),
 ('resource','{"name":"Exam One","resource_kind":"exam","visit_types":["clinic","housecall"],"aliases":["Room One"]}');
create function pg_temp.catalog(k text,action text,id uuid,expected integer,actionid uuid,definition jsonb,attest boolean default false) returns jsonb language sql as $$
 select public.save_appointment_catalog(auth.uid(),actionid,id,expected,k,action,jsonb_build_object('definition',definition,'review_note','Synthetic scheduling review','attest_review',attest)) $$;
create function pg_temp.book(actionid uuid,payload jsonb,id uuid default null,expected integer default null) returns jsonb language sql as $$
 select public.save_catalog_appointment(auth.uid(),actionid,id,expected,payload) $$;
select ok(not has_table_privilege('authenticated','public.appointment_catalog_entries','SELECT'),'Browser cannot read private appointment_catalog_entries');
select ok(not has_table_privilege('service_role','public.appointment_catalog_entries','INSERT'),'Service cannot insert private appointment_catalog_entries');
select ok(not has_table_privilege('authenticated','public.appointment_catalog_versions','SELECT'),'Browser cannot read private appointment_catalog_versions');
select ok(not has_table_privilege('service_role','public.appointment_catalog_versions','INSERT'),'Service cannot insert private appointment_catalog_versions');
select ok(not has_table_privilege('authenticated','public.appointment_resource_aliases','SELECT'),'Browser cannot read private appointment_resource_aliases');
select ok(not has_table_privilege('service_role','public.appointment_resource_aliases','INSERT'),'Service cannot insert private appointment_resource_aliases');
select ok(not has_table_privilege('authenticated','public.appointment_catalog_actions','SELECT'),'Browser cannot read private appointment_catalog_actions');
select ok(not has_table_privilege('service_role','public.appointment_catalog_actions','INSERT'),'Service cannot insert private appointment_catalog_actions');
select ok(not has_table_privilege('authenticated','public.appointment_catalog_bindings','SELECT'),'Browser cannot read private appointment_catalog_bindings');
select ok(not has_table_privilege('service_role','public.appointment_catalog_bindings','INSERT'),'Service cannot insert private appointment_catalog_bindings');
select ok(not has_table_privilege('authenticated','public.appointment_booking_actions','SELECT'),'Browser cannot read private appointment_booking_actions');
select ok(not has_table_privilege('service_role','public.appointment_booking_actions','INSERT'),'Service cannot insert private appointment_booking_actions');
select ok(not has_table_privilege('service_role','appointments','UPDATE'),'Direct service updates cannot reverse schedule lock order');
select ok(not has_function_privilege('authenticated','public.save_appointment_before_catalog(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,appointment_status,uuid,text,text,integer,integer,text,text,integer[])','EXECUTE'),'Private managed core cannot be called by browser');
select ok(not has_function_privilege('anon','public.save_catalog_appointment(uuid,uuid,uuid,integer,jsonb)','EXECUTE'),'Anonymous catalog booking is denied');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000001',null,'48400000-0000-4000-8000-000000000001',(select value from fixture where key='type'))$$,'42501',null,'Staff cannot configure catalog');
select is(jsonb_array_length(public.list_appointment_catalog('type')->'items'),0,'Empty catalog has no clinical seed');
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fixture select 'draft',pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000001',null,'48400000-0000-4000-8000-000000000001',(select value from fixture where key='type'));
select is((select value->>'version' from fixture where key='draft'),'1','Draft begins at revision one');
select is((select value->'published' from fixture where key='draft'),'null'::jsonb,'Draft is not bookable');
select throws_ok($$select pg_temp.catalog('type','publish','48300000-0000-4000-8000-000000000001',1,'48400000-0000-4000-8000-000000000002',(select value from fixture where key='type'))$$,'23514',null,'Publication needs explicit review attestation');
select throws_ok($$select pg_temp.catalog('type','publish','48300000-0000-4000-8000-000000000001',1,'48400000-0000-4000-8000-000000000002',jsonb_set((select value from fixture where key='type'),'{duration_minutes}','45'),true)$$,'23514',null,'Publication cannot change the saved draft');
insert into fixture select 'published',pg_temp.catalog('type','publish','48300000-0000-4000-8000-000000000001',1,'48400000-0000-4000-8000-000000000002',(select value from fixture where key='type'),true);
select is((select value#>>'{published,state}' from fixture where key='published'),'published','Exact reviewed draft publishes');
select is(pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000001',null,'48400000-0000-4000-8000-000000000001',(select value from fixture where key='type')),(select value from fixture where key='draft'),'Exact old action retry returns original draft after publication');
select throws_ok($$select pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000001',null,'48400000-0000-4000-8000-000000000001',jsonb_set((select value from fixture where key='type'),'{duration_minutes}','60'))$$,'23505',null,'Changed action payload cannot reuse receipt');
select throws_ok($$select pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000001',1,'48400000-0000-4000-8000-000000000003',(select value from fixture where key='type'))$$,'PT409',null,'Stale catalog edit rejected');
select lives_ok($$select pg_temp.catalog('resource','draft','48300000-0000-4000-8000-000000000002',null,'48400000-0000-4000-8000-000000000004',(select value from fixture where key='resource'))$$,'Resource draft saved');
insert into fixture select 'resource-published',pg_temp.catalog('resource','publish','48300000-0000-4000-8000-000000000002',1,'48400000-0000-4000-8000-000000000005',(select value from fixture where key='resource'),true);
insert into fixture select 'booking-values',jsonb_build_object('type_version_id',(select value#>>'{published,id}' from fixture where key='published'),'resource_version_id',(select value#>>'{published,id}' from fixture where key='resource-published'),'client_id','48100000-0000-4000-8000-000000000001','pet_id','48200000-0000-4000-8000-000000000001','scheduled_at','2026-12-01T16:00:00Z','duration_minutes',30,'status','SCHEDULED','assigned_dvm_id','48000000-0000-4000-8000-000000000001','visit_type','housecall','address_snapshot','Synthetic housecall address','travel_before_minutes',0,'travel_after_minutes',0,'notes','Synthetic booking','reminder_offsets',jsonb_build_array(48,24),'override_note','');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set((select value from fixture where key='booking-values'),'{pet_id}','"48200000-0000-4000-8000-000000000002"'))$$,'23514',null,'Species mismatch rejected');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set((select value from fixture where key='booking-values'),'{assigned_dvm_id}','"48000000-0000-4000-8000-000000000002"'))$$,'23514',null,'Vet-required type staffed by non-vet rejected');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set((select value from fixture where key='booking-values'),'{duration_minutes}','45'))$$,'23514',null,'Override without review note rejected');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set((select value from fixture where key='booking-values'),'{resource_version_id}','null'))$$,'23514',null,'Missing required room rejected');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set((select value from fixture where key='booking-values'),'{scheduled_at}','"tomorrow"'))$$,'23514',null,'Ambiguous time rejected');
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(jsonb_array_length(public.list_appointment_catalog('type')->'items'),1,'Staff can select reviewed publication');
insert into fixture select 'booking',pg_temp.book('48500000-0000-4000-8000-000000000001',(select value from fixture where key='booking-values'));
select is((select value#>>'{appointment,version}' from fixture where key='booking'),'1','Managed booking saves version one');
select is((select value#>>'{binding,type,id}' from fixture where key='booking'),(select value#>>'{published,id}' from fixture where key='published'),'Booking freezes exact type revision');
select is((select count(*) from appointment_reminders where appointment_id=(select (value#>>'{appointment,id}')::uuid from fixture where key='booking') and status='PENDING'),2::bigint,'Managed booking retains existing reminder lifecycle');
select is(pg_temp.book('48500000-0000-4000-8000-000000000001',(select value from fixture where key='booking-values')),(select value from fixture where key='booking'),'Duplicate booking retry returns same receipt');
select throws_ok($$select pg_temp.book('48500000-0000-4000-8000-000000000001',jsonb_set((select value from fixture where key='booking-values'),'{notes}','"Changed"'))$$,'23505',null,'Changed booking payload cannot reuse action');
select is(public.read_appointment_catalog_binding((select (value#>>'{appointment,id}')::uuid from fixture where key='booking')),(select value->'binding' from fixture where key='booking'),'Read binding returns frozen settings');
select throws_ok($$select save_appointment(null,null,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-02T16:00:00Z',30,'Reviewed wellness','SCHEDULED','48000000-0000-4000-8000-000000000001',null)$$,'23514',null,'Legacy new booking cannot impersonate published type');
select throws_ok($$select save_appointment(auth.uid(),null,null,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-02T16:00:00Z',30,'Custom','SCHEDULED','48000000-0000-4000-8000-000000000001','clinic','Synthetic address',0,0,'Room One',null,array[24])$$,'23514',null,'Legacy new booking cannot impersonate mapped room');
select throws_ok($$select save_appointment((select (value#>>'{appointment,id}')::uuid from fixture where key='booking'),1,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-01T16:00:00Z',60,'Reviewed wellness','SCHEDULED','48000000-0000-4000-8000-000000000001',null)$$,'23514',null,'Legacy edit cannot change frozen duration');
select lives_ok($$select save_appointment((select (value#>>'{appointment,id}')::uuid from fixture where key='booking'),1,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-01T16:00:00Z',30,'Reviewed wellness','CONFIRMED','48000000-0000-4000-8000-000000000001','Only notes and status changed')$$,'Slim status edit preserves frozen fields');
select is((select visit_type from appointments where id=(select (value#>>'{appointment,id}')::uuid from fixture where key='booking')),'housecall','Slim wrapper preserves housecall mode');
select is((select resource_name from appointments where id=(select (value#>>'{appointment,id}')::uuid from fixture where key='booking')),'Exam One','Slim wrapper preserves mapped room');
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000001',2,'48400000-0000-4000-8000-000000000006',jsonb_set((select value from fixture where key='type'),'{duration_minutes}','45'))$$,'Editing a publication makes a separate draft');
select is(public.list_appointment_catalog('type')->'items'->0->'published',(select value->'published' from fixture where key='published'),'Draft change preserves old publication');
select lives_ok($$select pg_temp.catalog('type','retire','48300000-0000-4000-8000-000000000001',3,'48400000-0000-4000-8000-000000000007',jsonb_set((select value from fixture where key='type'),'{duration_minutes}','45'),true)$$,'Type retires after review');
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(pg_temp.book('48500000-0000-4000-8000-000000000001',(select value from fixture where key='booking-values')),(select value from fixture where key='booking'),'Receipt retry succeeds after template retirement');
select is(public.recover_catalog_appointment(auth.uid(),'48500000-0000-4000-8000-000000000001',null,null,(select value from fixture where key='booking-values')),(select value from fixture where key='booking'),'Read-only recovery retains original saved receipt');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set((select value from fixture where key='booking-values'),'{scheduled_at}','"2026-12-03T16:00:00Z"'))$$,'PT409',null,'Retired publication cannot make new booking');
select lives_ok($$select save_appointment((select (value#>>'{appointment,id}')::uuid from fixture where key='booking'),2,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-01T16:00:00Z',30,'Reviewed wellness','COMPLETED','48000000-0000-4000-8000-000000000001','Completed after retirement')$$,'Retired template does not block unchanged completion');
select is(public.read_appointment_catalog_binding((select (value#>>'{appointment,id}')::uuid from fixture where key='booking')),(select value->'binding' from fixture where key='booking'),'Completion still retains original snapshot');
select lives_ok($$select cancel_appointment((select (value#>>'{appointment,id}')::uuid from fixture where key='booking'),3)$$,'Cancel shares canonical locking and preserves snapshot');
select throws_ok($$select save_appointment(auth.uid(),'48600000-0000-4000-8000-000000000099',null,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-03T16:00:00Z',30,'Custom','SCHEDULED','48000000-0000-4000-8000-000000000001','clinic','Synthetic address',0,0,null,null,array[24])$$,'PT409',null,'Public core cannot insert caller-preassigned appointment');
reset role;
select throws_ok($$update appointment_catalog_versions set review_note='Changed'$$,'23514',null,'Version history is immutable');
select throws_ok($$delete from appointment_catalog_bindings$$,'23514',null,'Binding history cannot be deleted');
select is((select count(*) from appointment_booking_actions),1::bigint,'Only one action receipt was saved');
select is((select count(*) from appointment_catalog_bindings),1::bigint,'Rejected reviews left no partial bindings');
-- Legacy resource aliases must resolve on the existing side too.
insert into appointments(id,client_id,pet_id,scheduled_at,duration_minutes,appointment_type,status,assigned_dvm_id,visit_type,address_snapshot,resource_name,created_by,updated_by) values
 ('48600000-0000-4000-8000-000000000001','48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-05T16:00:00Z',30,'Historical custom','SCHEDULED','48000000-0000-4000-8000-000000000001','clinic','Synthetic','Unmapped A','48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001'),
 ('48600000-0000-4000-8000-000000000002','48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-05T16:00:00Z',30,'Historical custom','SCHEDULED','48000000-0000-4000-8000-000000000002','clinic','Synthetic','Unmapped B','48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fixture values('merge-resource','{"name":"Unmapped A","resource_kind":"exam","visit_types":["clinic"],"aliases":["Unmapped B"]}');
select lives_ok($$select pg_temp.catalog('resource','draft','48300000-0000-4000-8000-000000000003',null,gen_random_uuid(),(select value from fixture where key='merge-resource'))$$,'Alias draft has no collision effects');
select throws_ok($$select pg_temp.catalog('resource','publish','48300000-0000-4000-8000-000000000003',1,gen_random_uuid(),(select value from fixture where key='merge-resource'),true)$$,'23P01',null,'Publishing aliases cannot merge overlapping historical bookings');
select lives_ok($$select cancel_appointment('48600000-0000-4000-8000-000000000002',1)$$,'Conflicting historical booking canceled');
select lives_ok($$select pg_temp.catalog('resource','publish','48300000-0000-4000-8000-000000000003',1,gen_random_uuid(),(select value from fixture where key='merge-resource'),true)$$,'Reviewed alias publication succeeds when conflict resolved');
select throws_ok($$select save_appointment(auth.uid(),'48600000-0000-4000-8000-000000000002',2,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-05T16:00:00Z',30,'Historical custom','CONFIRMED','48000000-0000-4000-8000-000000000002','clinic','Synthetic',0,0,'Unmapped A',null,array[24])$$,'23P01',null,'Stable alias collision is checked before closed-reactivation guard');
-- Unbound historical edits cannot adopt a known type or mapped alias.
select throws_ok($$select save_appointment(auth.uid(),'48600000-0000-4000-8000-000000000001',1,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-06T16:00:00Z',30,'Historical custom','SCHEDULED','48000000-0000-4000-8000-000000000001','clinic','Synthetic',0,0,'Room One',null,array[24])$$,'23514',null,'Legacy update cannot adopt mapped alias without binding');
select lives_ok($$select save_appointment(auth.uid(),'48600000-0000-4000-8000-000000000001',1,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-06T16:00:00Z',30,'Historical custom','SCHEDULED','48000000-0000-4000-8000-000000000001','clinic','Synthetic',0,0,'Unmapped A','Historical spelling retained',array[24])$$,'Unchanged historical mapped alias can be rescheduled');
select lives_ok($$select save_appointment(null,null,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-07T16:00:00Z',30,'Legacy nullable status',null,'48000000-0000-4000-8000-000000000001',null)$$,'Slim null status retains compatibility default');
select is((select status::text from appointments where appointment_type='Legacy nullable status'),'SCHEDULED','Slim nullable status defaults to booked');
select lives_ok($$select pg_temp.catalog('type','draft','48300000-0000-4000-8000-000000000004',null,gen_random_uuid(),jsonb_set(jsonb_set((select value from fixture where key='type'),'{name}','"Case-specific visit"'),'{duration_minutes}','null'))$$,'Case-specific draft saved');
insert into fixture select 'case-specific',pg_temp.catalog('type','publish','48300000-0000-4000-8000-000000000004',1,gen_random_uuid(),jsonb_set(jsonb_set((select value from fixture where key='type'),'{name}','"Case-specific visit"'),'{duration_minutes}','null'),true);
select throws_ok($$select save_appointment('48600000-0000-4000-8000-000000000001',2,'48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001','2026-12-06T16:00:00Z',30,'Case-specific visit','SCHEDULED','48000000-0000-4000-8000-000000000001',null)$$,'23514',null,'Slim update cannot adopt known type without binding');
select throws_ok($$select pg_temp.book(gen_random_uuid(),jsonb_set(jsonb_set((select value from fixture where key='booking-values'),'{type_version_id}',(select value#>'{published,id}' from fixture where key='case-specific')),'{scheduled_at}','"2026-12-08T16:00:00Z"'))$$,'23514',null,'Case-specific duration always needs review note');
insert into fixture select 'case-booking',pg_temp.book('48500000-0000-4000-8000-000000000003',jsonb_set(jsonb_set(jsonb_set((select value from fixture where key='booking-values'),'{type_version_id}',(select value#>'{published,id}' from fixture where key='case-specific')),'{scheduled_at}','"2026-12-08T16:00:00Z"'),'{override_note}','"Synthetic time reviewed for this case"'));
select is((select value#>>'{binding,override_note}' from fixture where key='case-booking'),'Synthetic time reviewed for this case','Case duration rationale is frozen');
reset role;
delete from user_roles where user_id='48000000-0000-4000-8000-000000000001' and role='DVM';
insert into user_roles(user_id,role) values('48000000-0000-4000-8000-000000000001','STAFF') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select cancel_appointment((select (value#>>'{appointment,id}')::uuid from fixture where key='case-booking'),1)$$,'Unchanged clinician role removal does not block cancellation');
select * from finish();
rollback;
