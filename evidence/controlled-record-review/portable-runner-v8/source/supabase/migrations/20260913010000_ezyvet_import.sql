-- Review-only ezyVet imports. No clinical table is mutated by this migration's RPCs.
create table public.ezyvet_import_runs (
 id uuid primary key,
 source_origin text not null check(source_origin in ('https://api.trial.ezyvet.com','https://api.ezyvet.com')),
 source_site_uid text not null check(length(source_site_uid) between 1 and 4096),
 resource text not null check(resource in ('contact','contactdetail','address','animal','species','breed','sex','animalcolour','appointment','consult','history','vaccination','diagnostic')),
 requested_by uuid not null references public.profiles(id),
 status text not null default 'running' check(status in ('running','review_ready','page_limit_reached')),
 next_page integer not null default 1 check(next_page between 1 and 1001),
 lease_id uuid,
 lease_until timestamptz,
 retry_after timestamptz,
 last_error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.ezyvet_import_snapshots (
 id uuid primary key default gen_random_uuid(),
 source_origin text not null check(source_origin in ('https://api.trial.ezyvet.com','https://api.ezyvet.com')),
 source_site_uid text not null,
 resource text not null,
 external_id text not null check(external_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 payload_hash text not null,
 first_seen_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(source_origin,source_site_uid,resource,external_id,payload_hash)
);
create table public.ezyvet_import_pages (
 run_id uuid not null references public.ezyvet_import_runs(id),
 page integer not null check(page between 1 and 1000),
 item_count integer not null check(item_count between 0 and 50),
 fetched_at timestamptz not null default now(),
 primary key(run_id,page)
);
create table public.ezyvet_import_page_items (
 run_id uuid not null,
 page integer not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),
 primary key(run_id,page,snapshot_id),
 foreign key(run_id,page) references public.ezyvet_import_pages(run_id,page)
);
create table public.ezyvet_import_reviews (
 id uuid primary key default gen_random_uuid(),
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),
 decision text not null check(decision in ('unmatched','proposed_match','ignored')),
 client_id uuid references public.clients(id),
 pet_id uuid references public.pets(id),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 reviewed_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check((decision='proposed_match' and num_nonnulls(client_id,pet_id)=1) or (decision<>'proposed_match' and client_id is null and pet_id is null))
);
create index ezyvet_snapshots_identity on public.ezyvet_import_snapshots(source_origin,source_site_uid,resource,external_id);
create index ezyvet_reviews_snapshot on public.ezyvet_import_reviews(snapshot_id,created_at desc);
create index ezyvet_runs_actor on public.ezyvet_import_runs(requested_by,created_at desc);

create function public.ezyvet_is_active_admin(p_actor uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_active_staff(p_actor) and exists(select 1 from public.user_roles where user_id=p_actor and role='ADMIN');
$$;
revoke all on function public.ezyvet_is_active_admin(uuid) from public,anon;
grant execute on function public.ezyvet_is_active_admin(uuid) to authenticated,service_role;

do $$ declare t text; begin
 foreach t in array array['ezyvet_import_runs','ezyvet_import_snapshots','ezyvet_import_pages','ezyvet_import_page_items','ezyvet_import_reviews'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on table public.%I to authenticated,service_role',t);
 execute format('create policy "Active administrators read imports" on public.%I for select to authenticated using (public.ezyvet_is_active_admin(auth.uid()))',t);
 end loop;
end $$;

create function public.claim_ezyvet_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text)
returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_import_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 if p_id is null or nullif(trim(p_site_uid),'') is null then raise exception 'Invalid import request' using errcode='23514'; end if;
 -- Serialize claims per source/resource, including different runs, to avoid concurrent provider traffic.
 perform pg_advisory_xact_lock(hashtextextended(p_source_origin||':'||p_site_uid||':'||p_resource,0));
 insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by) values(p_id,p_source_origin,p_site_uid,p_resource,p_actor) on conflict(id) do nothing;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.requested_by<>p_actor or r.source_origin<>p_source_origin or r.source_site_uid<>p_site_uid or r.resource<>p_resource then raise exception 'Import identity mismatch' using errcode='42501'; end if;
 if r.status<>'running' then return r; end if;
 if exists(select 1 from public.ezyvet_import_runs where source_origin=p_source_origin and source_site_uid=p_site_uid and resource=p_resource and (lease_until>now() or retry_after>now())) then raise exception 'Import busy or cooling down' using errcode='55P03'; end if;
 update public.ezyvet_import_runs set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',last_error_code=null,updated_at=now() where id=p_id returning * into r;
 return r;
end $$;

create function public.stage_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb)
returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs; item jsonb; snapshot_id uuid; item_hash text;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.requested_by<>p_actor then raise exception 'Import owner mismatch' using errcode='42501'; end if;
 -- Retried committed page is a no-op, including a response lost after successful staging.
 if exists(select 1 from public.ezyvet_import_pages where run_id=p_id and page=p_page) then return r; end if;
 if r.status<>'running' or r.lease_id is distinct from p_lease_id or r.lease_until<=now() or p_page<>r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001'; end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50 or octet_length(p_items::text)>2097152 then raise exception 'Invalid import page' using errcode='23514'; end if;
 if not p_complete and jsonb_array_length(p_items)=0 then raise exception 'Empty intermediate page' using errcode='23514'; end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct value->>'external_id') from jsonb_array_elements(p_items)) then raise exception 'Duplicate external IDs' using errcode='23514'; end if;
 insert into public.ezyvet_import_pages(run_id,page,item_count) values(p_id,p_page,jsonb_array_length(p_items));
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'payload') is distinct from 'object' or item->>'external_id' is null or item->>'external_id' !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'Invalid imported entity' using errcode='23514'; end if;
  item_hash=encode(digest((item->'payload')::text,'sha256'),'hex');
  insert into public.ezyvet_import_snapshots(source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
  values(r.source_origin,r.source_site_uid,r.resource,item->>'external_id',item->'payload',item_hash,p_actor) on conflict(source_origin,source_site_uid,resource,external_id,payload_hash) do nothing;
  select id into strict snapshot_id from public.ezyvet_import_snapshots where source_origin=r.source_origin and source_site_uid=r.source_site_uid and resource=r.resource and external_id=item->>'external_id' and payload_hash=item_hash;
  insert into public.ezyvet_import_page_items(run_id,page,snapshot_id) values(p_id,p_page,snapshot_id);
 end loop;
 update public.ezyvet_import_runs set next_page=p_page+1,status=case when p_complete then 'review_ready' when p_page=1000 then 'page_limit_reached' else 'running' end,lease_id=null,lease_until=null,retry_after=now()+interval '2 seconds',last_error_code=null,updated_at=now() where id=p_id returning * into r;
 return r;
end $$;

create function public.fail_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_code text,p_retry_seconds integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 if p_code is null or p_retry_seconds is null or p_code !~ '^[A-Z_]{1,64}$' or p_retry_seconds not between 1 and 3600 then raise exception 'Invalid import failure' using errcode='23514'; end if;
 update public.ezyvet_import_runs set lease_id=null,lease_until=null,last_error_code=p_code,retry_after=now()+make_interval(secs=>p_retry_seconds),updated_at=now() where id=p_id and requested_by=p_actor and lease_id=p_lease_id;
end $$;

create function public.review_ezyvet_snapshot(p_snapshot_id uuid,p_decision text,p_client_id uuid,p_pet_id uuid,p_reason text)
returns public.ezyvet_import_reviews language plpgsql security definer set search_path=public as $$
declare s public.ezyvet_import_snapshots; r public.ezyvet_import_reviews;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 select * into strict s from public.ezyvet_import_snapshots where id=p_snapshot_id;
 if (p_client_id is not null and s.resource<>'contact') or (p_pet_id is not null and s.resource<>'animal') then raise exception 'Match target does not fit imported resource' using errcode='23514'; end if;
 insert into public.ezyvet_import_reviews(snapshot_id,decision,client_id,pet_id,reason,reviewed_by) values(p_snapshot_id,p_decision,p_client_id,p_pet_id,trim(p_reason),auth.uid()) returning * into r;
 return r;
end $$;

revoke all on function public.claim_ezyvet_import(uuid,uuid,text,text,text), public.stage_ezyvet_import_page(uuid,uuid,uuid,integer,boolean,jsonb), public.fail_ezyvet_import_page(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_ezyvet_import(uuid,uuid,text,text,text), public.stage_ezyvet_import_page(uuid,uuid,uuid,integer,boolean,jsonb), public.fail_ezyvet_import_page(uuid,uuid,uuid,text,integer) to service_role;
revoke all on function public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text) to authenticated;
comment on table public.ezyvet_import_reviews is 'Append-only review proposals; no clinical data changes or approved source-of-truth decisions are implied.';
