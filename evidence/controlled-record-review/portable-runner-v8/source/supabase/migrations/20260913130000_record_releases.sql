-- Explicitly selected, reviewed medical-record packages; transport is intentionally separate.
create table public.record_release_policy (
 id boolean primary key default true check(id), enabled boolean not null default false,
 accepted_by text not null check(length(trim(accepted_by)) between 1 and 200),
 accepted_at timestamptz not null check(isfinite(accepted_at)), acceptance_reference text not null check(length(trim(acceptance_reference)) between 1 and 2000)
);
create table public.record_releases (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict, channel text not null check(channel in ('EMAIL','SMS')), recipient text not null,
 selection jsonb not null, snapshot jsonb not null, source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'), request jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.record_release_sources (
 id uuid primary key default gen_random_uuid(), release_id uuid not null references public.record_releases(id) on delete restrict,
 source_kind text not null check(source_kind in ('encounter','certificate','lab','document')), source_id uuid not null,
 unique(release_id,source_kind,source_id)
);
create table public.record_release_events (
 id uuid primary key, release_id uuid not null references public.record_releases(id) on delete restrict,
 kind text not null check(kind in ('withdrawn','source_changed')), reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index record_releases_patient_idx on public.record_releases(pet_id,created_at desc,id);
create index record_release_sources_lookup_idx on public.record_release_sources(source_kind,source_id);
create index record_release_events_release_idx on public.record_release_events(release_id);
create function public.record_release_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Release history is immutable; withdraw and prepare a new reviewed package' using errcode='23514'; end $$;
do $$ declare t text; begin
 foreach t in array array['record_release_policy','record_releases','record_release_sources','record_release_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy "Active staff read releases" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  if t<>'record_release_policy' then
   execute format('create trigger release_immutable before update or delete on public.%I for each row execute function public.record_release_immutable()',t);
   execute format('create trigger release_audit after insert on public.%I for each row execute function public.audit_trigger_fn()',t);
  end if;
 end loop;
end $$;
create function public.preview_record_release(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare pet public.pets; owner public.clients; selected uuid; k text; ids jsonb; e public.clinical_encounters; c public.vaccine_certificates; l public.patient_lab_orders; d public.patient_documents; soaps jsonb:='[]'; certs jsonb:='[]'; labs jsonb:='[]'; docs jsonb:='[]'; snapshot jsonb; recipient text; count_selected integer:=0;
begin
 perform public.clinical_require_staff();
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in ('encounter_ids','certificate_ids','lab_order_ids','document_ids')) then raise exception 'Choose explicit release sources' using errcode='23514'; end if;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids'] loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>100 then raise exception 'Each source selection must be an array of at most 100 IDs' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Source IDs must be unique strings' using errcode='23514'; end if;
  count_selected:=count_selected+jsonb_array_length(ids);
 end loop;
 if count_selected=0 then raise exception 'Choose at least one source; nothing is included by default' using errcode='23514'; end if;
 select * into pet from public.pets where id=p_pet_id and client_id=p_client_id for share;
 if not found then raise exception 'Patient does not belong to this household' using errcode='42501'; end if;
 select * into owner from public.clients where id=p_client_id for share;
 recipient:=public.communication_recipient(p_channel,p_recipient);
 if p_channel is null or p_channel not in ('EMAIL','SMS') or recipient is null or recipient is distinct from public.communication_recipient(p_channel,case when p_channel='EMAIL' then owner.primary_email else owner.primary_phone end) then raise exception 'Recipient must match the selected patient household contact' using errcode='42501'; end if;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'encounter_ids','[]')) v order by v loop
  select * into e from public.clinical_encounters where id=selected and pet_id=p_pet_id and status='signed' for update;
  if not found then raise exception 'Only signed encounters from this patient can be released' using errcode='23514'; end if;
  soaps:=soaps||jsonb_build_array(jsonb_build_object('id',e.id,'version',e.version,'visit_at',e.visit_at,'visit_type',e.visit_type,'subjective',e.subjective,'objective',e.objective,'assessment',e.assessment,'plan',e.plan,'signed_by',e.signed_by,'signed_at',e.signed_at,'addenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'content',a.content,'created_by',a.created_by,'created_at',a.created_at) order by a.created_at,a.id) from public.clinical_addenda a where a.encounter_id=e.id),'[]'::jsonb)));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'certificate_ids','[]')) v order by v loop
  select * into c from public.vaccine_certificates where id=selected and pet_id=p_pet_id for update;
  if not found or exists(select 1 from public.vaccine_certificate_events where certificate_id=selected) then raise exception 'Certificate is unavailable, belongs to another patient or is invalidated' using errcode='23514'; end if;
  certs:=certs||jsonb_build_array(to_jsonb(c)-array['request']);
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'lab_order_ids','[]')) v order by v loop
  select * into l from public.patient_lab_orders where id=selected and pet_id=p_pet_id and status='resulted' for update;
  if not found then raise exception 'Only resulted laboratory records from this patient can be released' using errcode='23514'; end if;
  if l.result_document_id is null or not exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) v where v::uuid=l.result_document_id) then raise exception 'Select the lab original report explicitly as a shareable attachment' using errcode='23514'; end if;
  labs:=labs||jsonb_build_array(jsonb_build_object('id',l.id,'version',l.version,'test_name',l.test_name,'accession',l.accession,'collected_date',l.collected_date,'result_date',l.result_date,'result_document_id',l.result_document_id));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) v order by v loop
  select * into d from public.patient_documents where id=selected and pet_id=p_pet_id and status='ready' and visibility='client_shareable' for update;
  if not found then raise exception 'Only ready client-shareable documents from this patient can be released' using errcode='23514'; end if;
  if not exists(select 1 from storage.objects where bucket_id='patient-documents' and name=d.file_path and metadata->>'size'=d.file_size::text and metadata->>'mimetype'=d.mime_type) then raise exception 'Original document object is unavailable or metadata differs' using errcode='23514'; end if;
  docs:=docs||jsonb_build_array(jsonb_build_object('id',d.id,'version',d.version,'file_name',d.file_name,'file_path',d.file_path,'bucket','patient-documents','mime_type',d.mime_type,'file_size',d.file_size,'document_date',d.document_date,'category',d.category));
 end loop;
 snapshot:=jsonb_build_object('schema_version',1,'patient',jsonb_build_object('id',pet.id,'version',pet.version,'name',pet.name,'species',pet.species,'breed',pet.breed,'dob',pet.dob,'birth_date_precision',pet.birth_date_precision,'microchip_id',pet.microchip_id),'recipient',jsonb_build_object('client_id',owner.id,'client_version',owner.version,'name',owner.full_name,'channel',p_channel,'address',recipient),'encounters',soaps,'certificates',certs,'lab_results',labs,'attachments',docs);
 return jsonb_build_object('snapshot',snapshot,'source_hash',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';
end $$;
create function public.confirm_record_release(p_id uuid,p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb,p_reviewed_snapshot jsonb,p_reviewed_hash text,p_attest_review boolean) returns public.record_releases language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.record_releases; preview jsonb; req jsonb; k text; source_type text;
begin
 if p_id is null or p_attest_review is distinct from true then raise exception 'Stable ID and explicit content/recipient review are required' using errcode='23514'; end if;
 req:=jsonb_build_object('pet_id',p_pet_id,'client_id',p_client_id,'channel',p_channel,'recipient',p_recipient,'selection',p_selection,'reviewed_snapshot',p_reviewed_snapshot,'reviewed_hash',p_reviewed_hash,'attest_review',p_attest_review);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));
 select * into result from public.record_releases where id=p_id;
 if found then if result.created_by<>actor or result.request is distinct from req then raise exception 'Release identifier already used' using errcode='23514'; end if; return result; end if;
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() for share;
 if not found then raise exception 'Clinical acceptance of the release form and workflow is required before confirmation' using errcode='42501'; end if;
 preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 if preview->'snapshot' is distinct from p_reviewed_snapshot or preview->>'source_hash' is distinct from p_reviewed_hash then raise exception 'Release sources or recipient changed; preview and review again' using errcode='40001'; end if;
 insert into public.record_releases(id,pet_id,client_id,channel,recipient,selection,snapshot,source_hash,request,created_by) values(p_id,p_pet_id,p_client_id,p_channel,preview#>>'{snapshot,recipient,address}',p_selection,p_reviewed_snapshot,p_reviewed_hash,req,actor) returning * into result;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids'] loop
  source_type:=case k when 'encounter_ids' then 'encounter' when 'certificate_ids' then 'certificate' when 'lab_order_ids' then 'lab' else 'document' end;
  insert into public.record_release_sources(release_id,source_kind,source_id) select p_id,source_type,v::uuid from jsonb_array_elements_text(coalesce(p_selection->k,'[]')) v;
 end loop;
 return result;
end $$;
-- Locks coordinate source writers with preview/confirm to prevent missed invalidations.
create function public.release_lock_source_parent() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_NAME='clinical_addenda' then perform 1 from public.clinical_encounters where id=NEW.encounter_id for update;
 else perform 1 from public.vaccine_certificates where id=NEW.certificate_id for update; end if;
 return NEW;
end $$;
create trigger aaa_release_lock_parent before insert on public.clinical_addenda for each row execute function public.release_lock_source_parent();
create trigger aaa_release_lock_parent before insert on public.vaccine_certificate_events for each row execute function public.release_lock_source_parent();
create function public.invalidate_record_release_source() returns trigger language plpgsql security definer set search_path=public as $$
declare source_type text; source uuid;
begin
 case TG_TABLE_NAME
 when 'clinical_addenda' then source_type:='encounter';source:=NEW.encounter_id;
 when 'vaccine_certificate_events' then source_type:='certificate';source:=NEW.certificate_id;
 when 'patient_lab_orders' then source_type:='lab';source:=NEW.id;
 when 'patient_documents' then source_type:='document';source:=NEW.id;
 when 'pets' then source_type:='patient';source:=NEW.id;
 when 'clients' then source_type:='household';source:=NEW.id;
 end case;
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),r.id,'source_changed','Reviewed '||source_type||' changed; prepare a fresh package',auth.uid() from public.record_releases r where (source_type='patient' and r.pet_id=source) or (source_type='household' and r.client_id=source) or exists(select 1 from public.record_release_sources s where s.release_id=r.id and s.source_kind=source_type and s.source_id=source);
 return NEW;
end $$;
create trigger release_source_changed after insert on public.clinical_addenda for each row execute function public.invalidate_record_release_source();
create trigger release_source_changed after insert on public.vaccine_certificate_events for each row execute function public.invalidate_record_release_source();
create trigger release_source_changed after update on public.patient_lab_orders for each row execute function public.invalidate_record_release_source();
create trigger release_source_changed after update on public.patient_documents for each row execute function public.invalidate_record_release_source();
create trigger release_source_changed after update on public.pets for each row execute function public.invalidate_record_release_source();
create trigger release_source_changed after update on public.clients for each row execute function public.invalidate_record_release_source();
create function public.withdraw_record_release(p_id uuid,p_release_id uuid,p_reason text) returns public.record_release_events language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.record_release_events;
begin
 if p_id is null or length(trim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Withdrawal reason required' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));
 select * into result from public.record_release_events where id=p_id;
 if found then if row(result.release_id,result.kind,result.reason,result.created_by) is distinct from row(p_release_id,'withdrawn'::text,trim(p_reason),actor) then raise exception 'Withdrawal ID already used' using errcode='23514'; end if;return result;end if;
 perform 1 from public.record_releases where id=p_release_id for update;
 if not found then raise exception 'Release not found' using errcode='23514'; end if;
 insert into public.record_release_events(id,release_id,kind,reason,created_by) values(p_id,p_release_id,'withdrawn',trim(p_reason),actor) returning * into result;
 return result;
end $$;
create function public.read_record_release(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.record_releases; events jsonb; eligible boolean:=true; why text; current_preview jsonb;
begin
 perform public.clinical_require_staff();
 select * into r from public.record_releases where id=p_id for share;
 if not found then raise exception 'Release not found' using errcode='23514'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]') into events from public.record_release_events e where release_id=p_id;
 if jsonb_array_length(events)>0 then eligible:=false;why:='Withdrawn or a reviewed source changed';
 else
  begin
   current_preview:=public.preview_record_release(r.pet_id,r.client_id,r.channel,r.recipient,r.selection);
   if current_preview->>'source_hash'<>r.source_hash then eligible:=false;why:='Current source snapshot differs';end if;
  exception when sqlstate '23514' or sqlstate '42501' then eligible:=false;why:='Source or recipient is no longer eligible';end;
 end if;
 return jsonb_build_object('release',to_jsonb(r)-'request','events',events,'eligible',eligible,'ineligibility_reason',why);
end $$;
-- Future transport must authorize a package, never accept arbitrary document IDs.
-- This is not granted to workers: a separately reviewed outbox adapter must revalidate
-- consent/suppression, recipient, content, attachment sizes and delivery state at send time.
create function public.authorize_record_release(p_id uuid,p_client_id uuid,p_channel text,p_recipient text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() for share;
 if not found then raise exception 'Clinical release acceptance is not active' using errcode='42501';end if;
 result:=public.read_record_release(p_id);
 if (result->>'eligible')::boolean is distinct from true or result#>>'{release,client_id}' is distinct from p_client_id::text or result#>>'{release,channel}' is distinct from p_channel or result#>>'{release,recipient}' is distinct from public.communication_recipient(p_channel,p_recipient) then raise exception 'Release is not eligible for this household recipient' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.record_release_immutable(),public.release_lock_source_parent(),public.invalidate_record_release_source() from public,anon,authenticated,service_role;
revoke all on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean),public.withdraw_record_release(uuid,uuid,text),public.read_record_release(uuid),public.authorize_record_release(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean),public.withdraw_record_release(uuid,uuid,text),public.read_record_release(uuid),public.authorize_record_release(uuid,uuid,text,text) to authenticated;

create function public.record_release_policy_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(user_id,action,table_name,record_id,old_data,new_data) values(auth.uid(),TG_OP,TG_TABLE_NAME,md5('public.record_release_policy:singleton')::uuid,case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end);
 return coalesce(NEW,OLD);
end $$;
create trigger release_policy_audit after insert or update or delete on public.record_release_policy for each row execute function public.record_release_policy_audit();
revoke all on function public.record_release_policy_audit() from public,anon,authenticated,service_role;
