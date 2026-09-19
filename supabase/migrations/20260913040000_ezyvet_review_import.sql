-- Living Room Vet is primary. Promotion is explicit, contact/patient-only, and never overwrites.
create table public.ezyvet_identity_heads (
 source_origin text not null,source_site_uid text not null,resource text not null,external_id text not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),version integer not null default 1,
 observed_at timestamptz not null default clock_timestamp(),
 primary key(source_origin,source_site_uid,resource,external_id)
);
create table public.ezyvet_record_links (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,request_hash text not null,
 source_origin text not null,source_site_uid text not null,resource text not null check(resource in ('contact','animal')),external_id text not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),head_version integer not null,
 client_id uuid references public.clients(id),pet_id uuid references public.pets(id),local_version integer not null,
 action text not null check(action in ('create','link')),reason text not null check(length(trim(reason)) between 1 and 2000),
 approved_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 unique(source_origin,source_site_uid,resource,external_id),
 check((resource='contact' and client_id is not null and pet_id is null) or (resource='animal' and client_id is not null and pet_id is not null))
);
create function public.ezyvet_observe_identity() returns trigger language plpgsql security definer set search_path=public as $$
declare s public.ezyvet_import_snapshots;
begin
 select * into strict s from public.ezyvet_import_snapshots where id=new.snapshot_id;
 insert into public.ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id) values(s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id)
 on conflict(source_origin,source_site_uid,resource,external_id) do update set snapshot_id=excluded.snapshot_id,version=ezyvet_identity_heads.version+1,observed_at=clock_timestamp() where ezyvet_identity_heads.snapshot_id<>excluded.snapshot_id;
 return new;
end $$;
revoke all on function public.ezyvet_observe_identity() from public,anon,authenticated,service_role;
create trigger ezyvet_page_observation after insert on public.ezyvet_import_page_items for each row execute function public.ezyvet_observe_identity();
-- Existing reviewed staging is backfilled using its latest recorded page observation.
insert into public.ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id)
select distinct on(s.source_origin,s.source_site_uid,s.resource,s.external_id) s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id
from public.ezyvet_import_snapshots s join public.ezyvet_import_page_items i on i.snapshot_id=s.id join public.ezyvet_import_pages p on p.run_id=i.run_id and p.page=i.page
order by s.source_origin,s.source_site_uid,s.resource,s.external_id,p.fetched_at desc,p.run_id desc,p.page desc;

do $$ declare t text; begin foreach t in array array['ezyvet_identity_heads','ezyvet_record_links'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on table public.%I to authenticated,service_role',t);
 execute format('create policy "Active administrators read import decisions" on public.%I for select to authenticated using (public.ezyvet_is_active_admin(auth.uid()))',t);
end loop;end $$;

create function public.promote_ezyvet_identity(p_request_id uuid,p_snapshot_id uuid,p_expected_hash text,p_head_version integer,p_action text,p_client_id uuid,p_pet_id uuid,p_expected_local_version integer,p_values jsonb,p_reason text)
returns public.ezyvet_record_links language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid(); s public.ezyvet_import_snapshots; h public.ezyvet_identity_heads; result public.ezyvet_record_links; c public.clients; p public.pets; owner_id uuid; fingerprint text; allowed text[];
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 if p_request_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or p_action is null or p_action not in ('create','link') or nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Invalid reviewed import' using errcode='23514'; end if;
 fingerprint=encode(digest(jsonb_build_array(p_snapshot_id,p_expected_hash,p_head_version,p_action,p_client_id,p_pet_id,p_expected_local_version,p_values,p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into result from public.ezyvet_record_links where request_id=p_request_id;
 if found then
  if result.approved_by<>actor or result.request_hash<>fingerprint then raise exception 'Approval request identity mismatch' using errcode='42501'; end if;
  return result;
 end if;
 select * into strict s from public.ezyvet_import_snapshots where id=p_snapshot_id;
 if s.resource not in ('contact','animal') then raise exception 'Only reviewed contacts and animals can be promoted' using errcode='23514'; end if;
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for update;
 if not found or h.snapshot_id<>s.id or h.version is distinct from p_head_version or s.payload_hash is distinct from p_expected_hash then raise exception 'Source changed; reload and review again' using errcode='40001'; end if;
 if exists(select 1 from public.ezyvet_record_links where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id) then raise exception 'Source identity already linked; local record will not be overwritten' using errcode='23505'; end if;
 if p_action='link' and p_values<>'{}'::jsonb then raise exception 'Linking cannot change local values' using errcode='23514'; end if;
 if s.resource='contact' then
  if p_pet_id is not null then raise exception 'Contact cannot target a patient' using errcode='23514'; end if;
  if p_action='create' then
   if p_client_id is not null or p_expected_local_version is not null then raise exception 'New household cannot target existing records' using errcode='23514'; end if;
   allowed=array['first_name','last_name','primary_phone','primary_email','mailing_address','housecall_address'];
   if exists(select 1 from jsonb_object_keys(p_values) k where not k=any(allowed)) then raise exception 'Unsupported household fields' using errcode='23514'; end if;
   c=public.save_client(actor,null,null,p_values->>'first_name',p_values->>'last_name',p_values->>'primary_phone',p_values->>'primary_email','EMAIL',p_values->>'mailing_address',p_values->>'housecall_address');
  else
   select * into c from public.clients where id=p_client_id for share;
   if not found or c.version is distinct from p_expected_local_version then raise exception 'Local record changed; reload before linking' using errcode='40001'; end if;
  end if;
 else
  select client_id into owner_id from public.ezyvet_record_links where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='contact' and external_id=s.payload->>'contact_id';
  if owner_id is null then raise exception 'Review and link the source household first' using errcode='23514'; end if;
  if p_client_id is distinct from owner_id then raise exception 'Animal household does not match source household link' using errcode='23514'; end if;
  if p_action='create' then
   if p_pet_id is not null or p_expected_local_version is not null then raise exception 'New patient cannot target existing records' using errcode='23514'; end if;
   allowed=array['name','species','breed','dob','birth_date_precision','color','sex','neuter_status','microchip_id','deceased_at'];
   if exists(select 1 from jsonb_object_keys(p_values) k where not k=any(allowed)) then raise exception 'Unsupported patient fields' using errcode='23514'; end if;
   p=public.save_patient(null,owner_id,null,p_values->>'name',p_values->>'species',nullif(p_values->>'breed',''),nullif(p_values->>'dob','')::date,coalesce(p_values->>'birth_date_precision','unknown'),nullif(p_values->>'color',''),coalesce(p_values->>'sex','unknown'),coalesce(p_values->>'neuter_status','unknown'),nullif(p_values->>'microchip_id',''),null,nullif(p_values->>'deceased_at','')::date);
  else
   select * into p from public.pets where id=p_pet_id for share;
   if not found or p.version is distinct from p_expected_local_version then raise exception 'Local record changed; reload before linking' using errcode='40001'; end if;
   if p.client_id<>owner_id then raise exception 'Existing patient ownership cannot change through import' using errcode='23514'; end if;
  end if;
 end if;
 insert into public.ezyvet_record_links(request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
 values(p_request_id,fingerprint,s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,case when s.resource='contact' then c.id else owner_id end,case when s.resource='animal' then p.id else null end,case when s.resource='contact' then c.version else p.version end,p_action,trim(p_reason),actor) returning * into result;
 return result;
end $$;
revoke all on function public.promote_ezyvet_identity(uuid,uuid,text,integer,text,uuid,uuid,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.promote_ezyvet_identity(uuid,uuid,text,integer,text,uuid,uuid,integer,jsonb,text) to authenticated;
