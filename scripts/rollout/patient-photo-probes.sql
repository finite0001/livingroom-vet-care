-- Hosted role/metadata probes. No actual image bytes or HTTP session are claimed.
-- All synthetic records, Storage metadata and audit writes roll back in the inner block.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $probe$
declare
 actor uuid; household public.clients; patient public.pets; other public.pets;
 doc uuid:=gen_random_uuid(); object_id uuid:=gen_random_uuid(); action_id uuid:=gen_random_uuid();
 receipt jsonb; checks integer:=0; deleted bigint;
 before_clients bigint; before_pets bigint; before_docs bigint; before_objects bigint;
 before_states bigint; before_uploads bigint; before_actions bigint;
begin
 select count(*) into before_clients from public.clients;
 select count(*) into before_pets from public.pets;
 select count(*) into before_docs from public.patient_documents;
 select count(*) into before_objects from storage.objects;
 select count(*) into before_states from public.patient_photo_state;
 select count(*) into before_uploads from public.patient_photo_uploads;
 select count(*) into before_actions from public.patient_photo_actions;
 select p.id into actor from public.profiles p join public.user_roles r on r.user_id=p.id
 where p.is_active and r.role='ADMIN' order by p.id limit 1;
 if actor is null then raise exception 'Active administrator required for role simulation';end if;
 if exists(select 1 from public.clients where primary_phone='+12025550128') then raise exception 'Probe phone already used';end if;
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  household:=save_client(actor,null,null,'ROLLOUT PHOTO','PROBE','+12025550128','photo-probe@example.test','EMAIL',null,null);
  patient:=save_patient(null,household.id,null,'ROLLOUT PHOTO 1','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
  other:=save_patient(null,household.id,null,'ROLLOUT PHOTO 2','Cat',null,null,'unknown',null,'unknown','unknown',null,null,null);
  if (read_patient_photo(patient.id)->>'version')::integer<>0 then raise exception 'Initial version is not zero';end if;checks:=checks+1;
  begin perform prepare_patient_photo(doc,patient.id,0,repeat('a',64),100,'image/jpeg');raise exception 'Raw JPEG accepted';exception when check_violation then checks:=checks+1;end;
  begin perform prepare_patient_photo(doc,patient.id,0,'invalid',100,'image/png');raise exception 'Malformed digest accepted';exception when check_violation then checks:=checks+1;end;
  begin perform prepare_patient_photo(doc,patient.id,0,repeat('a',64),5242881,'image/png');raise exception 'Oversize photo accepted';exception when check_violation then checks:=checks+1;end;
  receipt:=prepare_patient_photo(doc,patient.id,0,repeat('a',64),100,'image/png');
  if receipt->'document'->>'file_path'<>actor::text||'/'||patient.id::text||'/'||doc::text||'/original'
   or receipt->'document'->>'visibility'<>'internal' then raise exception 'Private path/visibility changed';end if;checks:=checks+1;
  perform prepare_patient_photo(doc,patient.id,0,repeat('a',64),100,'image/png');checks:=checks+1;
  begin perform prepare_patient_photo(doc,patient.id,0,repeat('b',64),100,'image/png');raise exception 'Changed intent accepted';exception when check_violation then checks:=checks+1;end;
  begin perform set_patient_photo(action_id,patient.id,doc,0);raise exception 'Unverified image selected';exception when check_violation then checks:=checks+1;end;
  insert into storage.objects(id,bucket_id,name,metadata) values(object_id,'patient-documents',receipt->'document'->>'file_path','{"size":100,"mimetype":"image/png"}');
  begin perform verify_patient_photo_bytes(doc,actor,object_id,repeat('a',64),1,1);raise exception 'Browser forged proof';exception when insufficient_privilege then checks:=checks+1;end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
  begin perform verify_patient_photo_bytes(doc,actor,gen_random_uuid(),repeat('a',64),1,1);raise exception 'Replaced object accepted';exception when check_violation then checks:=checks+1;end;
  begin perform verify_patient_photo_bytes(doc,actor,object_id,repeat('b',64),1,1);raise exception 'Wrong hash accepted';exception when check_violation then checks:=checks+1;end;
  begin perform verify_patient_photo_bytes(doc,actor,object_id,repeat('a',64),1025,1);raise exception 'Oversize dimensions accepted';exception when check_violation then checks:=checks+1;end;
  perform verify_patient_photo_bytes(doc,actor,object_id,repeat('a',64),1,1);checks:=checks+1;
  perform verify_patient_photo_bytes(doc,actor,object_id,repeat('a',64),1,1);checks:=checks+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);set local role authenticated;
  perform set_config('storage.allow_delete_query','true',true);
  delete from storage.objects where id=object_id;get diagnostics deleted=row_count;
  if deleted<>0 then raise exception 'Verified pending bytes deleted';end if;checks:=checks+1;
  perform finalize_patient_document(doc);perform finalize_patient_document(doc);checks:=checks+1;
  begin perform set_patient_photo(gen_random_uuid(),other.id,doc,0);raise exception 'Cross-patient image accepted';exception when check_violation then checks:=checks+1;end;
  receipt:=set_patient_photo(action_id,patient.id,doc,0);
  if (receipt->>'version')::int<>1 or read_patient_photo(patient.id)->>'document_id'<>doc::text then raise exception 'Selection failed';end if;checks:=checks+1;
  if (select updated_by from patient_photo_state where pet_id=patient.id)<>actor then raise exception 'Actor not stamped';end if;checks:=checks+1;
  receipt:=set_patient_photo(action_id,patient.id,doc,0);if (receipt->>'version')::int<>1 then raise exception 'Retry changed action';end if;checks:=checks+1;
  begin perform set_patient_photo(action_id,patient.id,null,1);raise exception 'Changed action key accepted';exception when unique_violation then checks:=checks+1;end;
  begin perform set_patient_photo(gen_random_uuid(),patient.id,null,0);raise exception 'Stale removal accepted';exception when sqlstate 'PT409' then checks:=checks+1;end;
  begin update patient_photo_state set document_id=null where pet_id=patient.id;raise exception 'Direct pointer write allowed';exception when insufficient_privilege then checks:=checks+1;end;
  perform void_patient_document(doc,2,'Synthetic rollout metadata probe');
  if read_patient_photo(patient.id)->'document'<>'null'::jsonb then raise exception 'Voided image displayed';end if;checks:=checks+1;
  receipt:=set_patient_photo(gen_random_uuid(),patient.id,null,1);if (receipt->>'version')::int<>2 then raise exception 'Removal failed';end if;checks:=checks+1;
  perform set_patient_photo(action_id,patient.id,doc,0);
  if (read_patient_photo(patient.id)->>'version')::int<>2 then raise exception 'Historical replay restored old photo';end if;checks:=checks+1;
  if not exists(select 1 from patient_documents where id=doc and status='void') then raise exception 'History lost';end if;checks:=checks+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin perform read_patient_photo(patient.id);raise exception 'Unassigned actor can read';exception when insufficient_privilege then checks:=checks+1;end;
  set local role anon;
  begin perform read_patient_photo(patient.id);raise exception 'Anonymous read allowed';exception when insufficient_privilege then checks:=checks+1;end;
  raise exception 'ROLLBACK_SYNTHETIC_PHOTO_PROBES' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 if checks<>29 then raise exception 'Incomplete photo probe count: %',checks;end if;
 if (select count(*) from clients)<>before_clients or (select count(*) from pets)<>before_pets
  or (select count(*) from patient_documents)<>before_docs or (select count(*) from storage.objects)<>before_objects
  or (select count(*) from patient_photo_state)<>before_states or (select count(*) from patient_photo_uploads)<>before_uploads
  or (select count(*) from patient_photo_actions)<>before_actions then raise exception 'Probe writes did not roll back';end if;
 perform set_config('lrv.photo_rollout_proof',jsonb_build_object('checks',checks,'synthetic_writes_rolled_back',true,
  'clients_unchanged',before_clients,'pets_unchanged',before_pets,'documents_unchanged',before_docs,'objects_unchanged',before_objects)::text,true);
end $probe$;
select current_setting('lrv.photo_rollout_proof')::jsonb as photo_rollout_proof;
commit;
