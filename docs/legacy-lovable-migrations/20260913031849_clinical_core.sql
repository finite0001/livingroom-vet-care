alter table public.clients add column mailing_address text, add column housecall_address text, add column version integer not null default 1;
alter table public.pets add column color text, add column sex text not null default 'unknown' check (sex in ('unknown','female','male')), add column neuter_status text not null default 'unknown' check (neuter_status in ('unknown','intact','neutered')), add column birth_date_precision text not null default 'unknown' check (birth_date_precision in ('exact','estimated','unknown')), add column archived_at timestamptz, add column deceased_at date, add column version integer not null default 1;
update public.pets set birth_date_precision='estimated' where dob is not null;
alter table public.pets drop constraint if exists pets_client_id_fkey;
alter table public.pets add constraint pets_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict;

create table public.patient_weights (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete restrict,
 weight numeric not null check (weight > 0 and weight <= 10000), unit text not null check (unit in ('kg','lb')),
 measured_at date not null check (measured_at <= (now() at time zone 'America/Denver')::date), recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.clinical_encounters (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete restrict,
 visit_at timestamptz not null, visit_type text not null check (visit_type in ('clinic','housecall')), location text not null default '' check (length(location) <= 1000),
 subjective text not null default '' check (length(subjective) <= 50000), objective text not null default '' check (length(objective) <= 50000), assessment text not null default '' check (length(assessment) <= 50000), plan text not null default '' check (length(plan) <= 50000),
 status text not null default 'draft' check (status in ('draft','signed')), version integer not null default 1,
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id), signed_by uuid references auth.users(id), signed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((status = 'draft' and signed_by is null and signed_at is null) or (status = 'signed' and signed_by is not null and signed_at is not null and length(trim(assessment)) > 0 and length(trim(plan)) > 0))
);
create table public.clinical_addenda (
 id uuid primary key default gen_random_uuid(), encounter_id uuid not null references public.clinical_encounters(id) on delete restrict,
 content text not null check (length(trim(content)) between 1 and 50000), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.patient_problems (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete restrict,
 title text not null check (length(trim(title)) between 1 and 250), notes text not null default '' check (length(notes) <= 10000), onset_date date check (onset_date <= (now() at time zone 'America/Denver')::date),
 status text not null default 'active' check (status in ('active','resolved')), importance text not null default 'routine' check (importance in ('routine','high')),
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create index patient_weights_pet_measured_idx on public.patient_weights(pet_id, measured_at desc, created_at desc);
create index clinical_encounters_pet_visit_idx on public.clinical_encounters(pet_id, visit_at desc);
create index clinical_addenda_encounter_idx on public.clinical_addenda(encounter_id, created_at);
create index patient_problems_pet_idx on public.patient_problems(pet_id, status);

create function public.clinical_require_staff() returns uuid language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null or not public.is_active_staff(auth.uid()) then raise exception 'Active staff access required' using errcode = '42501'; end if;
 return auth.uid();
end $$;
create function public.clinical_version_row() returns trigger language plpgsql set search_path = public as $$
begin
 if TG_OP = 'UPDATE' and TG_TABLE_NAME = 'pets' then
  if NEW.client_id is distinct from OLD.client_id then raise exception 'Patient ownership transfer requires a separate workflow' using errcode='23514'; end if;
 end if;
 if TG_OP = 'INSERT' then NEW.version := 1; else NEW.version := OLD.version + 1; end if;
 return NEW;
end $$;
create trigger clients_version before insert or update on public.clients for each row execute function public.clinical_version_row();
create trigger pets_version before insert or update on public.pets for each row execute function public.clinical_version_row();

create function public.clinical_guard_row() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid;
begin
 actor := public.clinical_require_staff();
 if TG_OP = 'DELETE' then raise exception 'Clinical history cannot be deleted' using errcode = '23514'; end if;
 if TG_OP = 'UPDATE' and TG_TABLE_NAME in ('clinical_addenda','patient_weights') then raise exception 'Clinical history is append-only' using errcode = '23514'; end if;
 if TG_TABLE_NAME = 'clinical_encounters' then
  if TG_OP = 'UPDATE' and OLD.status = 'signed' then raise exception 'Signed encounters are immutable; add an addendum' using errcode = '23514'; end if;
  if NEW.status = 'signed' then NEW.signed_by := actor; NEW.signed_at := now(); else NEW.signed_by := null; NEW.signed_at := null; end if;
 end if;
 if TG_TABLE_NAME = 'clinical_addenda' then
  perform 1 from public.clinical_encounters where id = NEW.encounter_id and status = 'signed' for share;
  if not found then raise exception 'Addenda require a signed encounter' using errcode = '23514'; end if;
 end if;
 if TG_TABLE_NAME = 'patient_weights' then NEW.recorded_by := actor;
 else
  if TG_OP = 'INSERT' then NEW.created_by := actor; else NEW.created_by := OLD.created_by; end if;
 end if;
 if TG_OP = 'INSERT' then NEW.created_at := now(); else NEW.created_at := OLD.created_at; end if;
 if TG_TABLE_NAME in ('clinical_encounters','patient_problems') then
  NEW.updated_by := actor; NEW.updated_at := now();
  if TG_OP = 'INSERT' then NEW.version := 1; else NEW.version := OLD.version + 1; NEW.pet_id := OLD.pet_id; end if;
 end if;
 return NEW;
end $$;
alter table public.patient_weights enable row level security;
create policy "Active staff read" on public.patient_weights for select to authenticated using (public.is_active_staff(auth.uid()));
revoke all on public.patient_weights from public, anon, authenticated, service_role;
grant select on public.patient_weights to authenticated, service_role;
create trigger clinical_guard before insert or update or delete on public.patient_weights for each row execute function public.clinical_guard_row();
alter table public.clinical_encounters enable row level security;
create policy "Active staff read" on public.clinical_encounters for select to authenticated using (public.is_active_staff(auth.uid()));
revoke all on public.clinical_encounters from public, anon, authenticated, service_role;
grant select on public.clinical_encounters to authenticated, service_role;
create trigger clinical_guard before insert or update or delete on public.clinical_encounters for each row execute function public.clinical_guard_row();
alter table public.clinical_addenda enable row level security;
create policy "Active staff read" on public.clinical_addenda for select to authenticated using (public.is_active_staff(auth.uid()));
revoke all on public.clinical_addenda from public, anon, authenticated, service_role;
grant select on public.clinical_addenda to authenticated, service_role;
create trigger clinical_guard before insert or update or delete on public.clinical_addenda for each row execute function public.clinical_guard_row();
alter table public.patient_problems enable row level security;
create policy "Active staff read" on public.patient_problems for select to authenticated using (public.is_active_staff(auth.uid()));
revoke all on public.patient_problems from public, anon, authenticated, service_role;
grant select on public.patient_problems to authenticated, service_role;
create trigger clinical_guard before insert or update or delete on public.patient_problems for each row execute function public.clinical_guard_row();

create function public.save_clinical_encounter(p_id uuid, p_pet_id uuid, p_expected_version integer, p_visit_at timestamptz, p_visit_type text, p_location text, p_subjective text, p_objective text, p_assessment text, p_plan text)
returns public.clinical_encounters language plpgsql security definer set search_path = public as $$
declare result public.clinical_encounters; actor uuid;
begin
 actor := public.clinical_require_staff();
 if p_visit_at is null or p_visit_at > now() + interval '5 minutes' then raise exception 'Encounter date cannot exceed the current time by more than five minutes' using errcode = '23514'; end if;
 if p_id is null then
  perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for share;
  if not found then raise exception 'New encounters require an active patient' using errcode='23514'; end if;
  insert into public.clinical_encounters(pet_id,visit_at,visit_type,location,subjective,objective,assessment,plan,created_by,updated_by) values(p_pet_id,p_visit_at,p_visit_type,coalesce(p_location,''),coalesce(p_subjective,''),coalesce(p_objective,''),coalesce(p_assessment,''),coalesce(p_plan,''),actor,actor) returning * into result;
 else
  update public.clinical_encounters set visit_at=p_visit_at,visit_type=p_visit_type,location=coalesce(p_location,''),subjective=coalesce(p_subjective,''),objective=coalesce(p_objective,''),assessment=coalesce(p_assessment,''),plan=coalesce(p_plan,'') where id=p_id and pet_id=p_pet_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='40001'; end if;
 end if;
 return result;
end $$;
create function public.sign_clinical_encounter(p_id uuid,p_expected_version integer) returns public.clinical_encounters language plpgsql security definer set search_path=public as $$
declare result public.clinical_encounters;
begin
 perform public.clinical_require_staff();
 update public.clinical_encounters set status='signed' where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Record changed or no longer exists; reload before signing' using errcode='40001'; end if;
 return result;
end $$;
create function public.add_clinical_addendum(p_encounter_id uuid,p_content text) returns public.clinical_addenda language plpgsql security definer set search_path=public as $$
declare result public.clinical_addenda; actor uuid;
begin
 actor := public.clinical_require_staff();
 insert into public.clinical_addenda(encounter_id,content,created_by) values(p_encounter_id,trim(p_content),actor) returning * into result;
 return result;
end $$;
create function public.save_patient_problem(p_id uuid,p_pet_id uuid,p_expected_version integer,p_title text,p_notes text,p_onset_date date,p_status text,p_importance text) returns public.patient_problems language plpgsql security definer set search_path=public as $$
declare result public.patient_problems; actor uuid;
begin
 actor := public.clinical_require_staff();
 if p_id is null then
  insert into public.patient_problems(pet_id,title,notes,onset_date,status,importance,created_by,updated_by) values(p_pet_id,trim(p_title),coalesce(p_notes,''),p_onset_date,p_status,p_importance,actor,actor) returning * into result;
 else
  update public.patient_problems set title=trim(p_title),notes=coalesce(p_notes,''),onset_date=p_onset_date,status=p_status,importance=p_importance where id=p_id and pet_id=p_pet_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='40001'; end if;
 end if;
 return result;
end $$;
create function public.save_patient(p_id uuid,p_client_id uuid,p_expected_version integer,p_name text,p_species text,p_breed text,p_dob date,p_birth_date_precision text,p_color text,p_sex text,p_neuter_status text,p_microchip_id text,p_archived_at timestamptz,p_deceased_at date) returns public.pets language plpgsql security definer set search_path=public as $$
declare result public.pets;
begin
 perform public.clinical_require_staff();
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_species is null or length(trim(p_species)) not between 1 and 100 or length(p_breed)>150 or length(p_color)>150 or length(p_microchip_id)>100 then raise exception 'Patient fields are missing or too long' using errcode='23514'; end if;
 if p_dob>(now() at time zone 'America/Denver')::date or p_deceased_at>(now() at time zone 'America/Denver')::date or p_deceased_at<p_dob or (p_birth_date_precision in ('exact','estimated') and p_dob is null) then raise exception 'Patient dates are invalid' using errcode='23514'; end if;
 if p_id is null then
  insert into public.pets(client_id,name,species,breed,dob,birth_date_precision,color,sex,neuter_status,microchip_id,archived_at,deceased_at) values(p_client_id,trim(p_name),trim(p_species),p_breed,p_dob,p_birth_date_precision,p_color,p_sex,p_neuter_status,p_microchip_id,p_archived_at,p_deceased_at) returning * into result;
 else
  update public.pets set name=trim(p_name),species=trim(p_species),breed=p_breed,dob=p_dob,birth_date_precision=p_birth_date_precision,color=p_color,sex=p_sex,neuter_status=p_neuter_status,microchip_id=p_microchip_id,archived_at=p_archived_at,deceased_at=p_deceased_at where id=p_id and client_id=p_client_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='40001'; end if;
 end if;
 return result;
end $$;
create function public.record_patient_weight(p_pet_id uuid,p_weight numeric,p_unit text,p_measured_at date) returns public.patient_weights language plpgsql security definer set search_path=public as $$
declare result public.patient_weights; actor uuid;
begin
 actor := public.clinical_require_staff();
 perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for share;
 if not found then raise exception 'Weight entries require an active patient' using errcode='23514'; end if;
 insert into public.patient_weights(pet_id,weight,unit,measured_at,recorded_by) values(p_pet_id,p_weight,p_unit,p_measured_at,actor) returning * into result;
 return result;
end $$;
revoke all on function public.clinical_require_staff() from public, anon, authenticated, service_role;
revoke all on function public.clinical_version_row() from public, anon, authenticated, service_role;
revoke all on function public.clinical_guard_row() from public, anon, authenticated, service_role;
revoke all on function public.save_clinical_encounter(uuid,uuid,integer,timestamptz,text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.save_clinical_encounter(uuid,uuid,integer,timestamptz,text,text,text,text,text,text) to authenticated;
revoke all on function public.sign_clinical_encounter(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.sign_clinical_encounter(uuid,integer) to authenticated;
revoke all on function public.add_clinical_addendum(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.add_clinical_addendum(uuid,text) to authenticated;
revoke all on function public.save_patient_problem(uuid,uuid,integer,text,text,date,text,text) from public, anon, authenticated, service_role;
grant execute on function public.save_patient_problem(uuid,uuid,integer,text,text,date,text,text) to authenticated;
revoke all on function public.save_patient(uuid,uuid,integer,text,text,text,date,text,text,text,text,text,timestamptz,date) from public, anon, authenticated, service_role;
grant execute on function public.save_patient(uuid,uuid,integer,text,text,text,date,text,text,text,text,text,timestamptz,date) to authenticated;
revoke all on function public.record_patient_weight(uuid,numeric,text,date) from public, anon, authenticated, service_role;
grant execute on function public.record_patient_weight(uuid,numeric,text,date) to authenticated;

create function public.save_client(p_actor_id uuid,p_client_id uuid,p_expected_version integer,p_first_name text,p_last_name text,p_primary_phone text,p_primary_email text,p_preferred_channel public.channel_type,p_mailing_address text,p_housecall_address text) returns public.clients language plpgsql security definer set search_path=public as $$
declare result public.clients; actor uuid;
begin
 actor := public.clinical_require_staff();
 if p_actor_id is distinct from actor then raise exception 'Actor does not match signed-in staff' using errcode='42501'; end if;
 if p_first_name is null or length(trim(p_first_name)) not between 1 and 150 or p_last_name is null or length(trim(p_last_name)) not between 1 and 150 or length(p_primary_phone)>50 or length(p_primary_email)>254 or length(p_mailing_address)>1000 or length(p_housecall_address)>1000 then raise exception 'Client fields are missing or too long' using errcode='23514'; end if;
 if nullif(trim(p_primary_email),'') is not null and p_primary_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Client email is invalid' using errcode='23514'; end if;
 if p_client_id is null then
  insert into public.clients(first_name,last_name,full_name,primary_phone,primary_email,preferred_channel,mailing_address,housecall_address) values(trim(p_first_name),trim(p_last_name),trim(p_first_name)||' '||trim(p_last_name),nullif(trim(p_primary_phone),''),nullif(trim(p_primary_email),''),p_preferred_channel,nullif(trim(p_mailing_address),''),nullif(trim(p_housecall_address),'')) returning * into result;
 else
  update public.clients set first_name=trim(p_first_name),last_name=trim(p_last_name),full_name=trim(p_first_name)||' '||trim(p_last_name),primary_phone=nullif(trim(p_primary_phone),''),primary_email=nullif(trim(p_primary_email),''),preferred_channel=p_preferred_channel,mailing_address=nullif(trim(p_mailing_address),''),housecall_address=nullif(trim(p_housecall_address),'') where id=p_client_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='40001'; end if;
 end if;
 return result;
end $$;
create function public.search_clients(p_search text,p_limit integer default 250) returns setof public.clients language plpgsql security definer set search_path=public as $$
declare needle text := lower(trim(coalesce(p_search,'')));
begin
 perform public.clinical_require_staff();
 if length(needle)>250 then raise exception 'Search is too long' using errcode='23514'; end if;
 return query select c.* from public.clients c where needle='' or strpos(lower(c.full_name),needle)>0 or strpos(lower(coalesce(c.primary_email,'')),needle)>0 or strpos(coalesce(c.primary_phone,''),needle)>0 or (needle ~ '^[+0-9().[:space:]-]+$' and regexp_replace(needle,'[^0-9]','','g') <> '' and strpos(regexp_replace(coalesce(c.primary_phone,''),'[^0-9]','','g'),regexp_replace(needle,'[^0-9]','','g'))>0) or exists(select 1 from public.pets p where p.client_id=c.id and strpos(lower(p.name),needle)>0) order by c.full_name,c.id limit greatest(1,least(coalesce(p_limit,250),250));
end $$;
revoke all on function public.save_client(uuid,uuid,integer,text,text,text,text,public.channel_type,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_client(uuid,uuid,integer,text,text,text,text,public.channel_type,text,text) to authenticated;
revoke all on function public.search_clients(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_clients(text,integer) to authenticated;
create trigger audit_pets after insert or update or delete on public.pets for each row execute function public.audit_trigger_fn();
create trigger audit_clinical_encounters after insert or update on public.clinical_encounters for each row execute function public.audit_trigger_fn();
create trigger audit_patient_problems after insert or update on public.patient_problems for each row execute function public.audit_trigger_fn();
create trigger audit_patient_weights after insert on public.patient_weights for each row execute function public.audit_trigger_fn();
create trigger audit_clinical_addenda after insert on public.clinical_addenda for each row execute function public.audit_trigger_fn();