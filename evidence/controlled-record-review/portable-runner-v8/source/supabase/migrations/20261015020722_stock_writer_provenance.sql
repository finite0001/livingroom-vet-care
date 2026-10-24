-- All stock/custody entry points acquire the shared barrier BEFORE their old
-- resource locks. This is source provenance, not controlled-drug activation.
-- Current-statement admission is private and cannot be supplied through a GUC.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
-- Drain existing physical INSERTs before publishing the hooks and constraints.
-- A request still running an older body must fail atomically at the new guard,
-- then recover/retry its original UUID; it must never commit an unlinked write.
lock table public.inventory_movements,public.native_return_events,public.native_return_discrepancy_events in share row exclusive mode;

create table public.stock_writer_manifests (
 writer text not null, version integer not null check(version>0),
 signature text not null, definition_sha256 text not null check(definition_sha256 ~ '^[0-9a-f]{64}$'),
 prior_definition_sha256 text not null check(prior_definition_sha256 ~ '^[0-9a-f]{64}$'),
 primary key(writer,version), unique(signature,version)
);
create table public.stock_writer_admissions (
 backend_pid integer primary key,
 server_started_at timestamptz not null,
 transaction_id bigint not null,
 transaction_started_at timestamptz not null,
 statement_started_at timestamptz not null,
 writer text not null,
 source_id uuid not null,
 actor_id uuid not null
);
create table public.stock_movement_sources (
 movement_id uuid primary key references public.inventory_movements(id) deferrable initially deferred,
 writer text not null,
 source_id uuid not null,
 actor_id uuid not null references public.profiles(id)
);
create index stock_movement_sources_root on public.stock_movement_sources(writer,source_id);
create table public.stock_custody_sources (
 event_id uuid primary key references public.native_return_events(id) deferrable initially deferred,
 writer text not null check(writer in('record_native_dispense_return','record_native_dispense_return_v2')),
 actor_id uuid not null references public.profiles(id)
);
create table public.stock_discrepancy_sources (
 event_id uuid primary key references public.native_return_discrepancy_events(id) deferrable initially deferred,
 actor_id uuid not null references public.profiles(id)
);

create function public.stock_source_immutable() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 raise exception 'Stock source evidence is immutable' using errcode='23514';
end $$;

do $$declare name text;begin
 foreach name in array array['stock_writer_manifests','stock_writer_admissions','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  if name<>'stock_writer_admissions' then
   execute format('create trigger immutable before update or delete on public.%I for each row execute function public.stock_source_immutable()',name);
   execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.stock_source_immutable()',name);
  end if;
 end loop;
end $$;

create function public.stock_writer_current() returns public.stock_writer_admissions
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare a public.stock_writer_admissions; actor uuid:=public.clinical_require_staff();
begin
 select * into a from public.stock_writer_admissions
 where backend_pid=pg_backend_pid() and server_started_at=pg_postmaster_start_time()
 and transaction_id=txid_current() and transaction_started_at=transaction_timestamp()
 and statement_started_at=statement_timestamp() and actor_id=actor;
 if not found then raise exception 'Stock writer admission required' using errcode='23514';end if;
 return a;
end $$;

create function public.stock_writer_enter(p_writer text,p_source_id uuid) returns void
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid; manifest public.stock_writer_manifests; prior public.stock_writer_admissions;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Stock mutation requires READ COMMITTED isolation' using errcode='23514';
 end if;
 if p_source_id is null then raise exception 'Stable stock operation required' using errcode='23514';end if;
 actor:=public.clinical_require_staff();
 -- Reserved practice-wide barrier. Future exclusive cutover must take this
 -- before ANY other operation, authorization, invoice, product or lot lock.
 perform pg_advisory_xact_lock_shared(90271040,0);
 actor:=public.clinical_require_staff();
 select * into manifest from public.stock_writer_manifests where writer=p_writer order by version desc limit 1;
 if not found or manifest.definition_sha256 is distinct from
  encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(manifest.signature)),'UTF8')),'hex') then
  raise exception 'Stock writer coverage changed; reviewed manifest required' using errcode='23514';
 end if;
 select * into prior from public.stock_writer_admissions
 where backend_pid=pg_backend_pid() and server_started_at=pg_postmaster_start_time()
 and transaction_id=txid_current() and transaction_started_at=transaction_timestamp()
 and statement_started_at=statement_timestamp() and actor_id=actor;
 -- The outer anesthesia operation owns its nested treatment's SINGLE debit.
 if found and prior.writer='record_anesthesia_drug_administration'
 and p_writer='record_patient_treatment' and prior.source_id=p_source_id then return;end if;
 insert into public.stock_writer_admissions values(pg_backend_pid(),pg_postmaster_start_time(),txid_current(),transaction_timestamp(),statement_timestamp(),p_writer,p_source_id,actor)
 on conflict(backend_pid) do update set
 server_started_at=excluded.server_started_at,transaction_id=excluded.transaction_id,
 transaction_started_at=excluded.transaction_started_at,statement_started_at=excluded.statement_started_at,
 writer=excluded.writer,source_id=excluded.source_id,actor_id=excluded.actor_id;
end $$;

create function public.stock_source_guard() returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare admission public.stock_writer_admissions:=public.stock_writer_current();
begin
 if TG_TABLE_NAME='inventory_movements' then
  if admission.writer not in('receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration','record_native_dispense','record_native_dispense_return','record_native_dispense_return_v2') then
   raise exception 'Admitted writer cannot post stock' using errcode='23514';end if;
  if TG_WHEN='AFTER' then
   if NEW.created_by is distinct from admission.actor_id then raise exception 'Stock source actor mismatch' using errcode='23514';end if;
   insert into public.stock_movement_sources values(NEW.id,admission.writer,admission.source_id,admission.actor_id);
  end if;
 elsif TG_TABLE_NAME='native_return_events' then
  if admission.writer not in('record_native_dispense_return','record_native_dispense_return_v2')
  or admission.source_id is distinct from NEW.id or admission.actor_id is distinct from NEW.actor_id then
   raise exception 'Return custody writer mismatch' using errcode='23514';end if;
  if TG_WHEN='AFTER' then insert into public.stock_custody_sources values(NEW.id,admission.writer,admission.actor_id);end if;
 elsif TG_TABLE_NAME='native_return_discrepancy_events' then
  if admission.writer<>'record_native_return_discrepancy' or admission.source_id is distinct from NEW.id
  or admission.actor_id is distinct from NEW.actor_id then raise exception 'Discrepancy writer mismatch' using errcode='23514';end if;
  if TG_WHEN='AFTER' then insert into public.stock_discrepancy_sources values(NEW.id,admission.actor_id);end if;
 else raise exception 'Unsupported stock source boundary' using errcode='23514';
 end if;
 return NEW;
end $$;

create function public.stock_source_validate_movement(p_id uuid) returns void
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare source public.stock_movement_sources; movement public.inventory_movements; valid boolean:=false;
begin
 select * into source from public.stock_movement_sources where movement_id=p_id;
 if not found then raise exception 'Stock movement source required' using errcode='23514';end if;
 select * into movement from public.inventory_movements where id=p_id;
 if not found or movement.created_by is distinct from source.actor_id then raise exception 'Stock movement source mismatch' using errcode='23514';end if;
 case source.writer
 when 'receive_inventory' then valid:=movement.id=source.source_id and movement.kind='receive' and movement.quantity>0;
 when 'adjust_inventory' then valid:=movement.id=source.source_id and movement.kind='adjust' and movement.quantity<>0;
 when 'record_patient_treatment','record_anesthesia_drug_administration' then
  valid:=movement.id=source.source_id and movement.kind='dispense' and exists(
   select 1 from public.patient_treatments t where t.id=source.source_id and not t.historical
   and t.lot_id=movement.lot_id and t.quantity=-movement.quantity and t.created_by=source.actor_id
   and t.created_at=movement.created_at
  );
  if source.writer='record_anesthesia_drug_administration' then
   valid:=valid and exists(select 1 from public.anesthesia_drug_administrations a join public.patient_treatments t on t.id=a.id where a.id=source.source_id and a.created_by=source.actor_id and a.pet_id=t.pet_id and a.request=t.request and t.source='Anesthesia record '||a.record_id::text);
  end if;
 when 'record_native_dispense' then
  valid:=movement.kind='dispense' and exists(
   select 1 from public.native_dispense_allocations a join public.native_dispenses d on d.id=a.dispense_id
   join public.native_fulfillment_operations o on o.id=d.id and o.operation='dispense'
   where d.id=source.source_id and d.actor_id=source.actor_id and a.movement_id=p_id
   and a.lot_id=movement.lot_id and a.quantity=-movement.quantity
   and o.actor_id=d.actor_id and o.result->'dispense'=d.document
   and jsonb_array_length(d.document->'allocations')=(select count(*)from public.native_dispense_allocations other where other.dispense_id=d.id)
   and d.quantity=(select sum(other.quantity)from public.native_dispense_allocations other where other.dispense_id=d.id)
   and exists(select 1 from jsonb_array_elements(d.document->'allocations')line where line->>'movement_id'=p_id::text and line->>'lot_id'=movement.lot_id::text and (line->>'quantity')::numeric=a.quantity)
  );
 when 'record_native_dispense_return','record_native_dispense_return_v2' then
  valid:=exists(select 1 from public.native_return_events e join public.native_return_operations o on o.id=e.id where e.id=source.source_id
   and e.actor_id=source.actor_id and e.created_at=movement.created_at
   and o.actor_id=e.actor_id and o.result=e.document
   and e.document->>'version'=case source.writer when 'record_native_dispense_return' then '1' else '2' end
   and exists(select 1 from jsonb_array_elements(e.document->'allocations')line where line->>'movement_id'=p_id::text and line->>'lot_id'=movement.lot_id::text and (line->>'quantity')::numeric=abs(movement.quantity))
   and (
    (movement.kind='native_return' and e.action='restock' and exists(select 1 from public.native_return_stock_links s where s.event_id=e.id and s.movement_id=p_id and s.lot_id=movement.lot_id and s.quantity=movement.quantity))
    or (movement.kind='native_return_compensation' and e.action='retract_restock' and source.writer='record_native_dispense_return_v2' and exists(select 1 from public.native_return_compensation_links s where s.event_id=e.id and s.movement_id=p_id and s.lot_id=movement.lot_id and s.quantity=-movement.quantity))
   )
  );
 else valid:=false;
 end case;
 if valid is distinct from true then raise exception 'Canonical stock source does not match movement' using errcode='23514';end if;
end $$;

create function public.stock_source_consistency() returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare target_id uuid; valid boolean;
begin
 if TG_TABLE_NAME in('inventory_movements','stock_movement_sources') then
  perform public.stock_source_validate_movement((to_jsonb(NEW)->>case when TG_TABLE_NAME='inventory_movements' then 'id' else 'movement_id' end)::uuid);
 elsif TG_TABLE_NAME in('native_return_events','stock_custody_sources') then
  target_id:=(to_jsonb(NEW)->>case when TG_TABLE_NAME='native_return_events' then 'id' else 'event_id' end)::uuid;
  select exists(select 1 from public.stock_custody_sources s
   join public.native_return_events e on e.id=s.event_id
   join public.native_return_operations o on o.id=e.id
   where s.event_id=target_id and s.actor_id=e.actor_id and o.actor_id=e.actor_id
   and o.result=e.document and o.created_at=e.created_at
   and e.document->>'version'=case s.writer when 'record_native_dispense_return' then '1' else '2' end
  ) into valid;
  if not valid then raise exception 'Canonical return custody source required' using errcode='23514';end if;
 elsif TG_TABLE_NAME in('native_return_discrepancy_events','stock_discrepancy_sources') then
  target_id:=(to_jsonb(NEW)->>case when TG_TABLE_NAME='native_return_discrepancy_events' then 'id' else 'event_id' end)::uuid;
  select exists(select 1 from public.stock_discrepancy_sources s
   join public.native_return_discrepancy_events e on e.id=s.event_id
   join public.native_return_discrepancy_operations o on o.id=e.id
   where s.event_id=target_id and s.actor_id=e.actor_id and o.actor_id=e.actor_id
   and o.result=e.document and o.created_at=e.created_at
  ) into valid;
  if not valid then raise exception 'Canonical discrepancy source required' using errcode='23514';end if;
 else raise exception 'Unsupported stock source constraint' using errcode='23514';
 end if;
 return null;
end $$;


-- Replace only the first outer BEGIN. The complete effective function keeps its
-- prior validation, lock tail, request fingerprint, receipt and grants.
do $$declare signature text; writer text; definition text; modified text;begin
 foreach signature in array array[
  'public.receive_inventory(uuid,uuid,uuid,text,date,text,numeric,text)',
  'public.adjust_inventory(uuid,uuid,numeric,text)',
  'public.record_patient_treatment(uuid,jsonb)',
  'public.record_native_dispense(uuid,jsonb)',
  'public.record_native_dispense_return(uuid,jsonb)',
  'public.record_native_dispense_return_v2(uuid,jsonb)',
  'public.record_anesthesia_drug_administration(uuid,uuid,uuid,jsonb)',
  'public.record_native_return_discrepancy(uuid,jsonb)'
 ] loop
  writer:=split_part(split_part(signature,'(',1),'.',2);
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('stock_writer_enter' in definition)>0 then raise exception 'Stock entry already patched';end if;
  if encode(sha256(convert_to(definition,'UTF8')),'hex') is distinct from ('{"adjust_inventory":"2996dd26667d02633c44742c4eaba8511741f65c2d376e6e24876274c4c42926","receive_inventory":"eced863bd96ff14a8f18c12f858a475dadf0deb8d6f17fafb866ccb4137d17c8","record_native_dispense":"c9d2223083355d8a8ff24684c06b3fc6b4fe1c528bb7bb7e45008b170822a1a4","record_patient_treatment":"4320b962ddc1a5268ca941a4a2dbc129fad41168855f82ccccd463e53467ff50","record_native_dispense_return":"a490bc253d008b5fc240de54d0ecf4ad953b8510c5b60e35d0c425400cb27256","record_native_dispense_return_v2":"09b1832d47b5d23fb75cc39b6f7c0d7b696ef7f238538a552e93daab3796bc01","record_native_return_discrepancy":"c67b7c4fc7d28ea23477a3d82793b2ef58a4d122b8961a78c7b6e77fa3f5df3f","record_anesthesia_drug_administration":"fa79336c65273a510abc7120026e24b806e9a88b7db907c5737bc85a8bbb1388"}'::jsonb->>writer) then raise exception 'Unexpected pre-migration stock writer definition' using errcode='23514';end if;
  if definition !~* '\mbegin\M' then raise exception 'Expected outer stock writer block missing';end if;
  modified:=regexp_replace(definition,'\mbegin\M',format('%s'||chr(10)||' perform public.stock_writer_enter(%L,p_id);',substring(definition from '(?i)\mbegin\M'),writer),'i');
  if modified=definition then raise exception 'Stock admission insertion failed';end if;
  execute modified;
  insert into public.stock_writer_manifests values(writer,1,signature,encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'),encode(sha256(convert_to(definition,'UTF8')),'hex'));
 end loop;
end $$;

do $$declare name text;begin
 foreach name in array array['inventory_movements','native_return_events','native_return_discrepancy_events'] loop
  execute format('create trigger stock_source_admission before insert on public.%I for each row execute function public.stock_source_guard()',name);
  execute format('create trigger aaa_stock_source_capture after insert on public.%I for each row execute function public.stock_source_guard()',name);
 end loop;
 foreach name in array array['inventory_movements','stock_movement_sources','native_return_events','stock_custody_sources','native_return_discrepancy_events','stock_discrepancy_sources'] loop
  execute format('create constraint trigger stock_source_required after insert on public.%I deferrable initially deferred for each row execute function public.stock_source_consistency()',name);
 end loop;
end $$;

revoke all on function public.stock_source_immutable(),public.stock_writer_current(),public.stock_writer_enter(text,uuid),public.stock_source_guard(),public.stock_source_validate_movement(uuid),public.stock_source_consistency() from public,anon,authenticated,service_role;
commit;
