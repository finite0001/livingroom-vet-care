-- A single hosted SQL request has one statement timestamp. Search-after-save is verified through separate real HTTP requests.
-- Hosted role simulation, not a substitute for genuine Auth/PostgREST acceptance.
-- Every synthetic record and audit entry rolls back inside the exception block.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $probe$
declare
 actor uuid; household public.clients; patient public.pets; other public.pets;
 product public.catalog_products; encounter public.clinical_encounters;
 event_id uuid:=gen_random_uuid(); correction_id uuid:=gen_random_uuid();
 request jsonb; receipt jsonb; page jsonb; checks integer:=0;
 before_counts jsonb; after_counts jsonb;
begin
 select jsonb_build_object('clients',(select count(*) from clients),'pets',(select count(*) from pets),
  'products',(select count(*) from catalog_products),'encounters',(select count(*) from clinical_encounters),
  'services',(select count(*) from patient_service_events),'corrections',(select count(*) from patient_service_corrections),
  'audits',(select count(*) from audit_logs),'outbox',(select count(*) from communication_outbox),
  'invoices',(select count(*) from billing_invoices),
  'profiles',(select jsonb_agg(jsonb_build_array(id,full_name,is_active) order by id) from profiles)) into before_counts;
 select p.id into actor from profiles p join user_roles r on r.user_id=p.id
 where p.is_active and r.role='ADMIN' order by p.id limit 1;
 if actor is null then raise exception 'Active administrator required';end if;
 if exists(select 1 from clients where primary_phone='+12025550129') then raise exception 'Probe phone already used';end if;
 begin
  update profiles set full_name='Synthetic rolled-back performing clinician' where id=actor;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  household:=save_client(actor,null,null,'SYNTHETIC WHOGOT','ROLLBACK PROBE','+12025550129','whogot-probe@example.test','EMAIL',null,null);
  patient:=save_patient(null,household.id,null,'SYNTHETIC WHOGOT DOG','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
  other:=save_patient(null,household.id,null,'SYNTHETIC WHOGOT CAT','Cat',null,null,'unknown',null,'unknown','unknown',null,null,null);
  product:=save_catalog_product(null,null,'SYNTHETIC WHOGOT SERVICE','service','','visit',1000,true);
  encounter:=save_clinical_encounter(null,patient.id,null,now()-interval '1 hour','clinic','','','','','');
  if jsonb_array_length(search_whogot(p_product_id=>product.id)->'rows')<>0 then raise exception 'Catalog alone counted as performance';end if;checks:=checks+1;
  request:=jsonb_build_object('pet_id',patient.id,'encounter_id',encounter.id,'product_id',product.id,
   'clinician_id',actor,'performed_at',now()-interval '1 minute','notes','Synthetic completed service','invoice_id',null);
  receipt:=record_patient_service(event_id,request);
  if receipt->>'id'<>event_id::text then raise exception 'Wrong service receipt';end if;checks:=checks+1;
  if record_patient_service(event_id,request)<>receipt then raise exception 'Retry changed receipt';end if;checks:=checks+1;
  if (select count(*) from patient_service_events where id=event_id)<>1 then raise exception 'Duplicate service';end if;checks:=checks+1;
  if (select created_by from patient_service_events where id=event_id)<>actor then raise exception 'Actor not stamped';end if;checks:=checks+1;
  begin perform record_patient_service(event_id,request||'{"notes":"Changed"}');raise exception 'Changed retry accepted';exception when unique_violation then checks:=checks+1;end;
  begin perform record_patient_service(gen_random_uuid(),request||jsonb_build_object('pet_id',other.id));raise exception 'Wrong-patient encounter accepted';exception when check_violation then checks:=checks+1;end;
  begin perform record_patient_service(gen_random_uuid(),request||jsonb_build_object('performed_at',now()+interval '1 day'));raise exception 'Future service accepted';exception when check_violation then checks:=checks+1;end;
  if read_whogot_source(other.id,'performed',event_id) is not null then raise exception 'Cross-patient source leaked';end if;checks:=checks+1;
  if read_whogot_source(patient.id,'performed',event_id)#>>'{record,id}'<>event_id::text then raise exception 'Source failed';end if;checks:=checks+1;
  if jsonb_array_length(list_patient_services(patient.id))<>1 then raise exception 'Patient history failed';end if;checks:=checks+1;
  begin update patient_service_events set notes='Rewrite' where id=event_id;raise exception 'Direct rewrite allowed';exception when insufficient_privilege then checks:=checks+1;end;
  begin delete from patient_service_events where id=event_id;raise exception 'Direct deletion allowed';exception when insufficient_privilege then checks:=checks+1;end;
  receipt:=correct_patient_service(correction_id,patient.id,event_id,'Synthetic entered-in-error',null);
  if correct_patient_service(correction_id,patient.id,event_id,'Synthetic entered-in-error',null)<>receipt then raise exception 'Correction retry changed';end if;checks:=checks+1;
  if read_whogot_source(patient.id,'performed',event_id)#>>'{corrections,0,reason}'<>'Synthetic entered-in-error' then raise exception 'Current correction absent';end if;checks:=checks+1;
  begin perform search_whogot(p_from=>'2026-02-02',p_to=>'2026-02-01');raise exception 'Reversed dates accepted';exception when check_violation then checks:=checks+1;end;
  begin perform search_whogot(p_limit=>201);raise exception 'Unbounded query accepted';exception when check_violation then checks:=checks+1;end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin perform search_whogot();raise exception 'Unassigned identity accepted';exception when insufficient_privilege then checks:=checks+1;end;
  begin perform list_patient_services(patient.id);raise exception 'Unassigned history accepted';exception when insufficient_privilege then checks:=checks+1;end;
  set local role anon;
  begin perform search_whogot();raise exception 'Anonymous search accepted';exception when insufficient_privilege then checks:=checks+1;end;
  raise exception 'ROLLBACK_SYNTHETIC_WHOGOT' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 if checks<>20 then raise exception 'Incomplete probe count: %',checks;end if;
 select jsonb_build_object('clients',(select count(*) from clients),'pets',(select count(*) from pets),
  'products',(select count(*) from catalog_products),'encounters',(select count(*) from clinical_encounters),
  'services',(select count(*) from patient_service_events),'corrections',(select count(*) from patient_service_corrections),
  'audits',(select count(*) from audit_logs),'outbox',(select count(*) from communication_outbox),
  'invoices',(select count(*) from billing_invoices),
  'profiles',(select jsonb_agg(jsonb_build_array(id,full_name,is_active) order by id) from profiles)) into after_counts;
 if before_counts<>after_counts then raise exception 'Synthetic writes did not roll back';end if;
 perform set_config('lrv.whogot_rollout_proof',jsonb_build_object('checks',checks,'synthetic_writes_rolled_back',true,'unchanged_counts',after_counts)::text,true);
end $probe$;
select current_setting('lrv.whogot_rollout_proof')::jsonb as whogot_rollout_proof;
commit;
