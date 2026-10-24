-- Extend the existing early source boundary to handoff and its corrections.
-- No controlled classification, opening count, physical effect or approval is
-- inferred. Existing immutable history and original receipts are not backfilled.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
-- Take the same global barrier FIRST. The two older uninstrumented producers
-- are drained at their physical tables; an already-running old body without
-- admission then fails atomically rather than committing unlinked evidence.
select pg_advisory_xact_lock(90271040,0);
lock table public.native_pickups,public.native_dispense_correction_events,
 public.native_fulfillment_operations,public.native_dispense_correction_operations
 in share row exclusive mode;

create table public.stock_pickup_sources (
 event_id uuid primary key references public.native_pickups(id)deferrable initially deferred,
 actor_id uuid not null references public.profiles(id)
);
create index stock_pickup_sources_actor on public.stock_pickup_sources(actor_id);
create table public.stock_correction_sources (
 event_id uuid primary key references public.native_dispense_correction_events(id)deferrable initially deferred,
 actor_id uuid not null references public.profiles(id)
);
create index stock_correction_sources_actor on public.stock_correction_sources(actor_id);

do $$declare name text;begin
 foreach name in array array['stock_pickup_sources','stock_correction_sources']loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function public.stock_source_immutable()',name);
  execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.stock_source_immutable()',name);
 end loop;
end $$;

create function public.stock_handoff_guard()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare admission public.stock_writer_admissions:=public.stock_writer_current();expected_writer text;
begin
 expected_writer:=case TG_TABLE_NAME when 'native_pickups'then 'record_native_pickup'
  when 'native_dispense_correction_events'then 'append_native_dispense_correction'end;
 if expected_writer is null or admission.writer is distinct from expected_writer
 or admission.source_id is distinct from NEW.id or admission.actor_id is distinct from NEW.actor_id then
  raise exception 'Canonical handoff writer mismatch'using errcode='23514';
 end if;
 if TG_WHEN='AFTER'then
  if TG_TABLE_NAME='native_pickups'then
   insert into public.stock_pickup_sources values(NEW.id,admission.actor_id);
  else
   insert into public.stock_correction_sources values(NEW.id,admission.actor_id);
  end if;
 end if;
 return NEW;
end $$;

create function public.stock_handoff_consistency()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare target_id uuid;valid boolean;
begin
 target_id:=(to_jsonb(NEW)->>case when TG_TABLE_NAME in('stock_pickup_sources','stock_correction_sources')then 'event_id'else 'id'end)::uuid;
 if TG_TABLE_NAME in('native_pickups','stock_pickup_sources','native_fulfillment_operations')then
  -- Other fulfillment operations retain their existing source invariants.
  if TG_TABLE_NAME='native_fulfillment_operations'then
   if NEW.operation<>'pickup'then return null;end if;
  end if;
  select exists(select 1 from public.stock_pickup_sources s
   join public.native_pickups e on e.id=s.event_id
   join public.native_fulfillment_operations o on o.id=e.id and o.operation='pickup'
   where s.event_id=target_id and s.actor_id=e.actor_id and o.actor_id=e.actor_id
   and o.result=e.document
   and o.request_hash=public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',o.actor_id,'operation','pickup','request',o.request))
   -- The original pickup API accepts mixed-case UUID strings. Preserve its
   -- exact request hash while comparing the parsed identities, not spelling.
   and (o.request->>'authorization_id')::uuid=e.authorization_id
   and (o.request->>'pet_id')::uuid=e.pet_id and (o.request->>'dispense_id')::uuid=e.dispense_id
   and e.document->>'id'=e.id::text and e.document->>'actor_id'=e.actor_id::text
   and e.document->>'authorization_id'=e.authorization_id::text
   and e.document->>'pet_id'=e.pet_id::text and e.document->>'dispense_id'=e.dispense_id::text
   and (e.document->>'picked_up_at')::timestamptz=e.picked_up_at
   and e.document->'recipient_name'=o.request->'recipient_name'
   and e.document->'recipient_relationship'=o.request->'recipient_relationship'
   and e.document->'reason'=o.request->'reason'
  )into valid;
 elsif TG_TABLE_NAME in('native_dispense_correction_events','stock_correction_sources','native_dispense_correction_operations')then
  select exists(select 1 from public.stock_correction_sources s
   join public.native_dispense_correction_events e on e.id=s.event_id
   join public.native_dispense_correction_operations o on o.id=e.id
   where s.event_id=target_id and s.actor_id=e.actor_id and o.actor_id=e.actor_id
   and o.result=e.document and o.created_at=e.created_at
   and o.request_hash=public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',o.actor_id,'operation','append_native_dispense_correction','request',o.request))
   and o.request->>'authorization_id'=e.authorization_id::text
   and o.request->>'pet_id'=e.pet_id::text and o.request->>'dispense_id'=e.dispense_id::text
   and o.request->>'kind'=e.kind
   and e.document->>'id'=e.id::text and e.document#>>'{actor,id}'=e.actor_id::text
   and e.document->'target'=jsonb_build_object('authorization_id',e.authorization_id,'pet_id',e.pet_id,'dispense_id',e.dispense_id)
   and e.document->>'kind'=e.kind and (e.document->>'sequence')::integer=e.sequence
   and (e.document->>'prior_event_id')::uuid is not distinct from e.prior_event_id
   and (e.document->>'created_at')::timestamptz=e.created_at
   and e.record_hash=e.document->>'record_hash'
   and e.record_hash=public.native_fulfillment_hash(e.document-'record_hash')
   and e.document->'reason'=o.request->'reason'and e.document->'note'=o.request->'note'
   and e.document->'amends_event_id'=o.request->'amends_event_id'
   and e.document->'pickup_amendment'=o.request->'pickup_amendment'
  )into valid;
 else raise exception 'Unsupported canonical handoff source'using errcode='23514';
 end if;
 if valid is distinct from true then raise exception 'Canonical handoff source required'using errcode='23514';end if;
 return null;
end $$;

-- Preserve both complete bodies, signatures, authorization, validation, lock
-- tails, request hashes, server timestamps, receipts and existing API grants.
do $$declare signature text;writer text;definition text;modified text;begin
 if(select count(*)from public.stock_writer_manifests)<>8 then
  raise exception 'Expected the eight-writer source baseline'using errcode='23514';end if;
 if exists(select 1 from public.stock_writer_manifests m where m.definition_sha256 is distinct from
  encode(sha256(convert_to(pg_get_functiondef(m.signature::regprocedure),'UTF8')),'hex'))then
  raise exception 'Existing stock writer source changed'using errcode='23514';end if;
 foreach signature in array array['public.record_native_pickup(uuid,jsonb)','public.append_native_dispense_correction(uuid,jsonb)']loop
  writer:=split_part(split_part(signature,'(',1),'.',2);
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('stock_writer_enter'in definition)>0 or encode(sha256(convert_to(definition,'UTF8')),'hex')is distinct from
   ('{"record_native_pickup":"7db5d6bbb01127ff82ed1e09ca1fab8bcf5aac3ec57e92ff664c6a2873495ac1","append_native_dispense_correction":"bd19d34d883bb055923058a59f85bc938869480746176d3253a4f70c07528fc5"}'::jsonb->>writer)then
   raise exception 'Unexpected pre-migration handoff writer definition'using errcode='23514';end if;
  if definition!~*'\mbegin\M'then raise exception 'Expected outer handoff block missing';end if;
  modified:=regexp_replace(definition,'\mbegin\M',format('%s'||chr(10)||' perform public.stock_writer_enter(%L,p_id);',substring(definition from '(?i)\mbegin\M'),writer),'i');
  if modified=definition then raise exception 'Handoff admission insertion failed';end if;
  execute modified;
  insert into public.stock_writer_manifests values(writer,1,signature,
   encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'),
   encode(sha256(convert_to(definition,'UTF8')),'hex'));
 end loop;
end $$;

do $$declare name text;begin
 foreach name in array array['native_pickups','native_dispense_correction_events']loop
  execute format('create trigger stock_handoff_admission before insert on public.%I for each row execute function public.stock_handoff_guard()',name);
  execute format('create trigger aaa_stock_handoff_capture after insert on public.%I for each row execute function public.stock_handoff_guard()',name);
 end loop;
 foreach name in array array['native_pickups','stock_pickup_sources','native_fulfillment_operations',
  'native_dispense_correction_events','stock_correction_sources','native_dispense_correction_operations']loop
  execute format('create constraint trigger stock_handoff_required after insert on public.%I deferrable initially deferred for each row execute function public.stock_handoff_consistency()',name);
 end loop;
end $$;
revoke all on function public.stock_handoff_guard(),public.stock_handoff_consistency()from public,anon,authenticated,service_role;
commit;
