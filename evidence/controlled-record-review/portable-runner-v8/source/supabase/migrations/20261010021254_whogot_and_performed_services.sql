-- Explicit service performance is independent of invoicing and preserves corrections.
create table public.patient_service_events (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 encounter_id uuid not null references public.clinical_encounters(id) on delete restrict,
 product_id uuid not null references public.catalog_products(id) on delete restrict,
 product_name text not null, clinician_id uuid not null references public.profiles(id), clinician_name text not null,
 performed_at timestamptz not null check(isfinite(performed_at)), notes text not null check(length(notes)<=2000),
 invoice_id uuid references public.billing_invoices(id) on delete restrict,
 request jsonb not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp()
);
create table public.patient_service_corrections (
 id uuid primary key, service_event_id uuid not null unique references public.patient_service_events(id) on delete restrict,
 replacement_id uuid references public.patient_service_events(id) on delete restrict,
 reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['patient_service_events','patient_service_corrections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  execute format('create trigger service_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
  execute format('create trigger service_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
  execute format('create trigger service_audit after insert on public.%I for each row execute function public.audit_trigger_fn()',t);
 end loop;
end $$;
create index patient_service_pet on public.patient_service_events(pet_id,performed_at desc,id desc);
create index patient_service_product on public.patient_service_events(product_id,performed_at desc,id desc);
create index patient_service_encounter on public.patient_service_events(encounter_id);
create index patient_service_clinician on public.patient_service_events(clinician_id);
create index patient_service_invoice on public.patient_service_events(invoice_id);
create index patient_service_replacement on public.patient_service_corrections(replacement_id);
create index whogot_treatment_product on public.patient_treatments(product_id,administered_at desc,id desc);
create index whogot_treatment_lot on public.patient_treatments(lot_number,administered_at desc,id desc);
create index whogot_dispense_date on public.native_dispenses(dispensed_at desc,id desc);
create index whogot_dispense_product on public.billing_invoice_items(product_id,id);
create index patient_service_actor on public.patient_service_events(created_by);
create index patient_service_correction_actor on public.patient_service_corrections(created_by);

create function public.record_patient_service(p_id uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); r public.patient_service_events; e public.clinical_encounters; p public.catalog_products;
 pet uuid; clinician uuid; clinician_name text; stamp timestamptz; invoice uuid;
begin
 if p_id is null then raise exception 'Service event identity required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['pet_id','encounter_id','product_id','clinician_id','performed_at','notes','invoice_id']);
 if octet_length(p_request::text)>8192 then raise exception 'Bounded service record required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('patient-service:'||p_id::text,0));
 perform public.clinical_require_staff();
 select * into r from public.patient_service_events where id=p_id;
 if found then
  if r.created_by<>actor or r.request is distinct from p_request then raise exception 'Service identity already used' using errcode='23505';end if;
  return to_jsonb(r);
 end if;
 pet:=public.native_rx_uuid(p_request->'pet_id');clinician:=public.native_rx_uuid(p_request->'clinician_id');
 stamp:=public.native_correction_instant(p_request->'performed_at');invoice:=public.native_rx_uuid(p_request->'invoice_id',true);
 if stamp>clock_timestamp() then raise exception 'Service must already have been performed' using errcode='23514';end if;
 if jsonb_typeof(p_request->'notes') is distinct from 'string' or length(p_request->>'notes')>2000 then raise exception 'Bounded service notes required' using errcode='23514';end if;
 perform 1 from public.pets where id=pet and archived_at is null and deceased_at is null for share;
 if not found then raise exception 'Active patient required for service completion' using errcode='23514';end if;
 select * into e from public.clinical_encounters where id=public.native_rx_uuid(p_request->'encounter_id') and pet_id=pet for share;
 if not found then raise exception 'Saved encounter for this patient required' using errcode='23514';end if;
 if stamp<e.visit_at then raise exception 'Service time cannot precede this encounter' using errcode='23514';end if;
 select * into p from public.catalog_products where id=public.native_rx_uuid(p_request->'product_id') and kind='service' and active for share;
 if not found then raise exception 'Active service catalog item required' using errcode='23514';end if;
 select full_name into clinician_name from public.profiles where id=clinician and public.is_active_staff(id) for share;
 if not found or nullif(trim(clinician_name),'') is null then raise exception 'Named active performing clinician required' using errcode='23514';end if;
 if invoice is not null then
  perform 1 from public.billing_invoices b join public.pets pt on pt.client_id=b.client_id where b.id=invoice and pt.id=pet and b.status<>'void' for share of b;
  if not found then raise exception 'Invoice must belong to this patient household' using errcode='23514';end if;
 end if;
 insert into public.patient_service_events(id,pet_id,encounter_id,product_id,product_name,clinician_id,clinician_name,performed_at,notes,invoice_id,request,created_by)
 values(p_id,pet,e.id,p.id,p.name,clinician,clinician_name,stamp,p_request->>'notes',invoice,p_request,actor) returning * into r;
 return to_jsonb(r);
end $$;
create function public.correct_patient_service(p_id uuid,p_pet_id uuid,p_event_id uuid,p_reason text,p_replacement_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.patient_service_corrections;event public.patient_service_events;
begin
 if p_id is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Correction identity and reason required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('patient-service-correction:'||p_id::text,0));
 perform public.clinical_require_staff();
 select * into r from public.patient_service_corrections where id=p_id;
 if found then
  if r.created_by<>actor or r.service_event_id is distinct from p_event_id or r.reason is distinct from trim(p_reason) or r.replacement_id is distinct from p_replacement_id
    or not exists(select 1 from public.patient_service_events where id=r.service_event_id and pet_id=p_pet_id)
  then raise exception 'Correction identity already used' using errcode='23505';end if;
  return to_jsonb(r);
 end if;
 select * into event from public.patient_service_events where id=p_event_id and pet_id=p_pet_id for update;
 if not found then raise exception 'Service event for this patient required' using errcode='23514';end if;
 if p_replacement_id is not null and (p_replacement_id=p_event_id or not exists(select 1 from public.patient_service_events where id=p_replacement_id and pet_id=event.pet_id and encounter_id=event.encounter_id)) then raise exception 'Replacement must be another service in the same patient encounter' using errcode='23514';end if;
 insert into public.patient_service_corrections(id,service_event_id,replacement_id,reason,created_by) values(p_id,p_event_id,p_replacement_id,trim(p_reason),actor) returning * into r;
 return to_jsonb(r);
end $$;

-- Search aliases are names already linked to the same stable catalog identity.
-- Never infer a mapping for unlinked historical free-text records.
create function public.search_whogot_products(p_search text default '',p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();
 if p_search is null or length(p_search)>200 or p_limit is null or p_limit not between 1 and 101 then raise exception 'Bounded product search required' using errcode='23514';end if;
 with aliases as (
  select id product_id,name alias from public.catalog_products
  union select product_id,product_name from public.patient_treatments where product_id is not null
  union select product_id,description from public.billing_invoice_items
  union select product_id,product_name from public.patient_service_events
 ), matches as (
  select p.id,p.name,p.kind,p.active,array_agg(distinct a.alias order by a.alias) aliases
  from public.catalog_products p join aliases a on a.product_id=p.id
  group by p.id having bool_or(strpos(lower(a.alias),lower(trim(p_search)))>0)
  order by lower(p.name),p.id limit p_limit
 ) select coalesce(jsonb_agg(to_jsonb(matches)),'[]') into result from matches;
 return result;
end $$;
create function public.list_patient_services(p_pet_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;begin
 if auth.uid() is null or not public.is_active_staff(auth.uid()) then raise exception 'Active staff access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('correction',to_jsonb(c)) order by s.performed_at desc,s.id desc),'[]') into result
 from public.patient_service_events s left join public.patient_service_corrections c on c.service_event_id=s.id where s.pet_id=p_pet_id;
 return result;
end $$;

create function public.search_whogot(
 p_product_id uuid default null,p_event_type text default null,p_from date default null,p_to date default null,
 p_lot text default '',p_species text default '',p_clinician text default '',p_include_corrected boolean default false,
 p_include_historical boolean default false,p_before jsonb default null,p_as_of timestamptz default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;stamp timestamptz:=coalesce(p_as_of,statement_timestamp());before_stamp timestamptz;before_kind text;before_id uuid;
begin
 perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 200 or p_lot is null or length(p_lot)>200 or p_species is null or length(p_species)>100 or p_clinician is null or length(p_clinician)>200
  or (p_event_type is not null and p_event_type not in('administered','dispensed','performed')) or p_include_corrected is null or p_include_historical is null
  or (p_from is not null and not isfinite(p_from)) or (p_to is not null and not isfinite(p_to)) or p_from>p_to or not isfinite(stamp) or stamp>statement_timestamp()
 then raise exception 'Valid bounded Whogot filters required' using errcode='23514';end if;
 if p_before is not null then
  if p_as_of is null then raise exception 'Pagination requires original search time' using errcode='23514';end if;
  perform public.native_rx_keys(p_before,array['occurred_at','event_type','id']);
  before_stamp:=public.native_correction_instant(p_before->'occurred_at');before_kind:=p_before->>'event_type';before_id:=public.native_rx_uuid(p_before->'id');
  if before_kind is null or before_kind not in('administered','dispensed','performed') then raise exception 'Invalid search cursor' using errcode='23514';end if;
 end if;
 with events as (
  select t.id,t.pet_id,t.product_id,t.product_name,'administered'::text event_type,t.kind item_kind,t.administered_at occurred_at,t.created_at,
   t.historical,t.veterinarian clinician,t.lot_number lots,
   case when c.id is null then 'current' else 'corrected' end correction_status,c.reason correction_reason,c.replacement_id,
   null::uuid encounter_id,null::uuid authorization_id,t.source source_note
  from public.patient_treatments t left join public.patient_treatment_corrections c on c.treatment_id=t.id and c.created_at<=stamp
  where (p_product_id is null or t.product_id=p_product_id) and (p_event_type is null or p_event_type='administered')
   and (p_include_historical or not t.historical) and (p_include_corrected or c.id is null)
   and (trim(p_lot)='' or t.lot_number=trim(p_lot))
  union all
  select d.id,d.pet_id,b.product_id,b.description,'dispensed','medication',d.dispensed_at,d.dispensed_at,
   false,coalesce(d.document#>>'{artifact,recorded_by,name}',''),coalesce((select string_agg(l.value->>'number',', ' order by l.value->>'number') from jsonb_array_elements(d.document#>'{artifact,lots}') l),''),
   case when dc.id is null then 'current' else 'annotated' end,dc.document->>'reason',null::uuid,null::uuid,d.authorization_id,'Practice dispensing; administration is not implied'
  from public.native_dispenses d join public.billing_invoice_items b on b.id=d.invoice_item_id
  left join lateral(select * from public.native_dispense_correction_events where dispense_id=d.id and created_at<=stamp order by sequence desc limit 1) dc on true
  where (p_product_id is null or b.product_id=p_product_id) and (p_event_type is null or p_event_type='dispensed')
   and (trim(p_lot)='' or exists(select 1 from jsonb_array_elements(d.document#>'{artifact,lots}') l where l.value->>'number'=trim(p_lot)))
  union all
  select s.id,s.pet_id,s.product_id,s.product_name,'performed','service',s.performed_at,s.created_at,
   false,s.clinician_name,'',case when c.id is null then 'current' else 'corrected' end,c.reason,c.replacement_id,s.encounter_id,null::uuid,s.notes
  from public.patient_service_events s left join public.patient_service_corrections c on c.service_event_id=s.id and c.created_at<=stamp
  where (p_product_id is null or s.product_id=p_product_id) and (p_event_type is null or p_event_type='performed')
   and (p_include_corrected or c.id is null) and trim(p_lot)=''
 ), filtered as (
  select e.*,p.name patient_name,p.species,p.deceased_at,p.archived_at,c.id client_id,c.full_name client_name,c.primary_phone phone,c.primary_email email
  from events e join public.pets p on p.id=e.pet_id join public.clients c on c.id=p.client_id
  where e.created_at<=stamp and e.occurred_at<=stamp
   and (p_from is null or e.occurred_at>=(p_from::timestamp at time zone 'America/Denver'))
   and (p_to is null or e.occurred_at<((p_to+1)::timestamp at time zone 'America/Denver'))
   and (trim(p_species)='' or p.species=trim(p_species))
   and (trim(p_clinician)='' or strpos(lower(e.clinician),lower(trim(p_clinician)))>0)
   and (p_before is null or (e.occurred_at,e.event_type,e.id)<(before_stamp,before_kind,before_id))
  order by e.occurred_at desc,e.event_type desc,e.id desc limit p_limit+1
 ), page as (select * from filtered order by occurred_at desc,event_type desc,id desc limit p_limit)
 select jsonb_build_object('as_of',stamp,'rows',coalesce((select jsonb_agg(to_jsonb(page) order by occurred_at desc,event_type desc,id desc) from page),'[]'),
  'next',case when (select count(*) from filtered)>p_limit then (select jsonb_build_object('occurred_at',occurred_at,'event_type',event_type,'id',id) from page order by occurred_at,event_type,id limit 1) else null end)
 into result;
 return result;
end $$;
revoke all on function public.record_patient_service(uuid,jsonb),public.correct_patient_service(uuid,uuid,uuid,text,uuid),public.search_whogot_products(text,integer),public.list_patient_services(uuid),public.search_whogot(uuid,text,date,date,text,text,text,boolean,boolean,jsonb,timestamptz,integer) from public,anon,authenticated,service_role;
grant execute on function public.record_patient_service(uuid,jsonb),public.correct_patient_service(uuid,uuid,uuid,text,uuid),public.search_whogot_products(text,integer),public.list_patient_services(uuid),public.search_whogot(uuid,text,date,date,text,text,text,boolean,boolean,jsonb,timestamptz,integer) to authenticated;

create function public.list_service_clinicians() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by full_name,id),'[]') into result
 from public.profiles where public.is_active_staff(id) and nullif(trim(full_name),'') is not null;
 return result;
end $$;
revoke all on function public.list_service_clinicians() from public,anon,authenticated,service_role;
grant execute on function public.list_service_clinicians() to authenticated;

-- Direct patient-scoped source access works even when the event is on an older history page.
create function public.read_whogot_source(p_pet_id uuid,p_event_type text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();
 if p_event_type='administered' then
  select jsonb_build_object('event_type','administered','record',to_jsonb(t),'corrections',coalesce((select jsonb_agg(to_jsonb(c)) from public.patient_treatment_corrections c where c.treatment_id=t.id),'[]')) into result
  from public.patient_treatments t where t.id=p_id and t.pet_id=p_pet_id;
 elsif p_event_type='dispensed' then
  select jsonb_build_object('event_type','dispensed','record',public.native_fulfillment_verified_dispense(d.id),
   'corrections',coalesce((select jsonb_agg(to_jsonb(c) order by c.sequence) from public.native_dispense_correction_events c where c.dispense_id=d.id),'[]')) into result
  from public.native_dispenses d where d.id=p_id and d.pet_id=p_pet_id;
 elsif p_event_type='performed' then
  select jsonb_build_object('event_type','performed','record',to_jsonb(s),'corrections',coalesce((select jsonb_agg(to_jsonb(c)) from public.patient_service_corrections c where c.service_event_id=s.id),'[]')) into result
  from public.patient_service_events s where s.id=p_id and s.pet_id=p_pet_id;
 else raise exception 'Received-care event type required' using errcode='23514';end if;
 return result;
end $$;
revoke all on function public.read_whogot_source(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_whogot_source(uuid,text,uuid) to authenticated;
