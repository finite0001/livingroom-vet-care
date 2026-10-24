create table public.dental_charts (
 id uuid primary key,pet_id uuid not null references public.pets(id),species_family text not null check(species_family in ('dog','cat','manual')),dentition text not null check(dentition in ('adult','deciduous','manual')),
 visit_at timestamptz not null,notes text not null default '',teeth jsonb not null default '{}',status text not null default 'draft' check(status in ('draft','signed')),
 version integer not null default 1,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),signed_by uuid references public.profiles(id),signed_at timestamptz,
 check((status='draft' and signed_by is null and signed_at is null)or(status='signed' and signed_by is not null and signed_at is not null)),check(species_family<>'manual' or dentition='manual')
);
create table public.dental_chart_revisions (
 id uuid primary key default gen_random_uuid(),chart_id uuid not null references public.dental_charts(id),version integer not null,visit_at timestamptz not null,notes text not null,teeth jsonb not null,status text not null,actor_id uuid not null references public.profiles(id),recorded_at timestamptz not null default now(),unique(chart_id,version)
);
create table public.dental_chart_addenda (
 id uuid primary key,chart_id uuid not null references public.dental_charts(id),content text not null check(length(trim(content)) between 1 and 10000),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index dental_charts_patient on public.dental_charts(pet_id,visit_at desc);
create index dental_addenda_chart on public.dental_chart_addenda(chart_id,created_at);
create function public.dental_tooth_numbers(p_species text,p_dentition text) returns text[] language plpgsql immutable set search_path=public as $$
declare upper_teeth integer[];lower_teeth integer[];bases integer[];result text[]='{}';i integer;n integer;
begin
 if p_dentition='manual' then return result;end if;
 if p_species not in ('dog','cat') or p_dentition not in ('adult','deciduous') then raise exception 'Unsupported dental chart template' using errcode='23514';end if;
 if p_species='dog' then upper_teeth=case when p_dentition='adult' then array[1,2,3,4,5,6,7,8,9,10] else array[1,2,3,4,6,7,8] end;lower_teeth=case when p_dentition='adult' then array[1,2,3,4,5,6,7,8,9,10,11] else array[1,2,3,4,6,7,8] end;
 else upper_teeth=case when p_dentition='adult' then array[1,2,3,4,6,7,8,9] else array[1,2,3,4,6,7,8] end;lower_teeth=case when p_dentition='adult' then array[1,2,3,4,7,8,9] else array[1,2,3,4,7,8] end;end if;
 bases=case when p_dentition='adult' then array[100,200,300,400] else array[500,600,700,800] end;
 for i in 1..4 loop foreach n in array (case when i<=2 then upper_teeth else lower_teeth end) loop result=array_append(result,(bases[i]+n)::text);end loop;end loop;
 return result;
end $$;
create function public.dental_validate_data(p_species text,p_dentition text,p_teeth jsonb,p_notes text,p_visit_at timestamptz) returns void language plpgsql set search_path=public as $$
declare entry record;measurement jsonb;allowed text[];
begin
 if p_notes is null or length(p_notes)>20000 or p_visit_at is null or not isfinite(p_visit_at) or p_visit_at>now()+interval '5 minutes' or p_teeth is null or jsonb_typeof(p_teeth)<>'object' or octet_length(p_teeth::text)>250000 then raise exception 'Invalid dental chart values' using errcode='23514';end if;
 allowed=public.dental_tooth_numbers(p_species,p_dentition);
 for entry in select * from jsonb_each(p_teeth) loop
  if not entry.key=any(allowed) or jsonb_typeof(entry.value)<>'object' or exists(select 1 from jsonb_object_keys(entry.value) k where k not in ('presence','findings','planned','performed','measurements')) then raise exception 'Invalid tooth for selected dentition' using errcode='23514';end if;
  if (entry.value->>'presence') is null or (entry.value->>'presence') not in ('not_recorded','present','missing','extracted') then raise exception 'Invalid recorded tooth presence' using errcode='23514';end if;
  if exists(select 1 from unnest(array['findings','planned','performed']) k where jsonb_typeof(entry.value->k) is distinct from 'string' or length(entry.value->>k)>5000) then raise exception 'Invalid tooth narrative' using errcode='23514';end if;
  if jsonb_typeof(entry.value->'measurements') is distinct from 'array' or jsonb_array_length(entry.value->'measurements')>12 then raise exception 'Invalid tooth measurements' using errcode='23514';end if;
  for measurement in select value from jsonb_array_elements(entry.value->'measurements') loop
   if jsonb_typeof(measurement)<>'object' or exists(select 1 from jsonb_object_keys(measurement) k where k not in ('label','value_mm')) or jsonb_typeof(measurement->'label') is distinct from 'string' or length(trim(measurement->>'label')) not between 1 and 120 or jsonb_typeof(measurement->'value_mm') is distinct from 'number' or (measurement->>'value_mm')::numeric<=0 then raise exception 'Measurements require a label and positive finite millimeters' using errcode='23514';end if;
  end loop;
 end loop;
end $$;
create function public.dental_record_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.dental_chart_revisions(chart_id,version,visit_at,notes,teeth,status,actor_id) values(new.id,new.version,new.visit_at,new.notes,new.teeth,new.status,new.updated_by);return new;end $$;
create trigger dental_revision after insert or update on public.dental_charts for each row execute function public.dental_record_revision();
do $$ declare t text;begin foreach t in array array['dental_charts','dental_chart_revisions','dental_chart_addenda'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);execute format('grant select on table public.%I to authenticated',t);execute format('create policy "Active staff read dental records" on public.%I for select to authenticated using (public.is_active_staff(auth.uid()))',t);
end loop;end $$;
create function public.save_dental_chart(p_id uuid,p_pet_id uuid,p_expected_version integer,p_dentition text,p_visit_at timestamptz,p_notes text,p_teeth jsonb) returns public.dental_charts language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.dental_charts;family text;pet public.pets;
begin
 actor=public.clinical_require_staff();if p_id is null then raise exception 'Stable chart ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5));
 select * into pet from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for share;if not found then raise exception 'Dental drafts require an active patient' using errcode='23514';end if;
 select * into r from public.dental_charts where id=p_id for update;
 if found then
  if r.pet_id<>p_pet_id then raise exception 'Chart does not belong to patient' using errcode='42501';end if;
  if r.status<>'draft' then raise exception 'Signed chart is immutable; add a correction instead' using errcode='23514';end if;
  if r.dentition<>p_dentition then raise exception 'Saved chart dentition cannot change' using errcode='23514';end if;
  if r.updated_by=actor and r.visit_at=p_visit_at and r.notes=p_notes and r.teeth=p_teeth and ((p_expected_version is null and r.version=1)or r.version=p_expected_version+1) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Dental chart changed; reload before saving' using errcode='40001';end if;
  perform public.dental_validate_data(r.species_family,r.dentition,p_teeth,p_notes,p_visit_at);
  update public.dental_charts set visit_at=p_visit_at,notes=p_notes,teeth=p_teeth,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  if p_expected_version is not null then raise exception 'Dental chart no longer exists' using errcode='40001';end if;
  family=case when lower(trim(pet.species)) in ('dog','canine') then 'dog' when lower(trim(pet.species)) in ('cat','feline') then 'cat' else 'manual' end;
  if p_dentition is null or p_dentition not in ('adult','deciduous','manual') or(family='manual' and p_dentition<>'manual') then raise exception 'Select an appropriate dentition' using errcode='23514';end if;
  perform public.dental_validate_data(family,p_dentition,p_teeth,p_notes,p_visit_at);
  insert into public.dental_charts(id,pet_id,species_family,dentition,visit_at,notes,teeth,created_by,updated_by) values(p_id,p_pet_id,family,p_dentition,p_visit_at,p_notes,p_teeth,actor,actor) returning * into r;
 end if;return r;
end $$;
create function public.sign_dental_chart(p_id uuid,p_pet_id uuid,p_expected_version integer) returns public.dental_charts language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.dental_charts;
begin actor=public.clinical_require_staff();select * into strict r from public.dental_charts where id=p_id for update;
 if r.pet_id<>p_pet_id then raise exception 'Chart does not belong to patient' using errcode='42501';end if;
 if r.status='signed' and r.signed_by=actor and r.version=p_expected_version+1 then return r;end if;
 if r.version is distinct from p_expected_version then raise exception 'Dental chart changed; reload before signing' using errcode='40001';end if;
 if r.status<>'draft' then raise exception 'Chart already signed' using errcode='23514';end if;
 if nullif(trim(r.notes),'') is null and not exists(select 1 from jsonb_each(r.teeth) e where e.value->>'presence'<>'not_recorded' or nullif(trim(e.value->>'findings'),'') is not null or nullif(trim(e.value->>'planned'),'') is not null or nullif(trim(e.value->>'performed'),'') is not null or jsonb_array_length(e.value->'measurements')>0) then raise exception 'Record observations or notes before signing' using errcode='23514';end if;
 update public.dental_charts set status='signed',signed_by=actor,signed_at=now(),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;return r;
end $$;
create function public.add_dental_addendum(p_id uuid,p_chart_id uuid,p_pet_id uuid,p_content text) returns public.dental_chart_addenda language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.dental_chart_addenda;c public.dental_charts;
begin actor=public.clinical_require_staff();select * into strict c from public.dental_charts where id=p_chart_id for share;
 if c.pet_id<>p_pet_id then raise exception 'Chart does not belong to patient' using errcode='42501';end if;
 if c.status<>'signed' then raise exception 'Addenda require a signed dental chart' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6));select * into r from public.dental_chart_addenda where id=p_id;
 if found then if r.chart_id<>p_chart_id or r.created_by<>actor or r.content<>trim(p_content) then raise exception 'Addendum request changed' using errcode='42501';end if;return r;end if;
 insert into public.dental_chart_addenda(id,chart_id,content,created_by) values(p_id,p_chart_id,trim(p_content),actor) returning * into r;return r;
end $$;
revoke all on function public.dental_tooth_numbers(text,text),public.dental_validate_data(text,text,jsonb,text,timestamptz),public.dental_record_revision() from public,anon,authenticated,service_role;
revoke all on function public.save_dental_chart(uuid,uuid,integer,text,timestamptz,text,jsonb),public.sign_dental_chart(uuid,uuid,integer),public.add_dental_addendum(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.save_dental_chart(uuid,uuid,integer,text,timestamptz,text,jsonb),public.sign_dental_chart(uuid,uuid,integer),public.add_dental_addendum(uuid,uuid,uuid,text) to authenticated;
