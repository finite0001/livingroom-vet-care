-- Immutable annotations and attributed pickup amendments; no stock/allowance/financial effects.
create table public.native_dispense_correction_events (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),
 pet_id uuid not null references public.pets(id),dispense_id uuid not null references public.native_dispenses(id),
 sequence integer not null check(sequence>0),prior_event_id uuid unique references public.native_dispense_correction_events(id),
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in('clinical_annotation','operational_annotation','pickup_amendment')),
 created_at timestamptz not null,record_hash text not null check(record_hash~'^[a-f0-9]{64}$'),
 reviewed_context jsonb not null,document jsonb not null,unique(dispense_id,sequence),check((sequence=1)=(prior_event_id is null))
);
create unique index native_correction_single_root on public.native_dispense_correction_events(dispense_id) where prior_event_id is null;
create index native_correction_authorization on public.native_dispense_correction_events(authorization_id,dispense_id,sequence);
create table public.native_dispense_correction_operations (
 id uuid primary key references public.native_dispense_correction_events(id),actor_id uuid not null references public.profiles(id),
 request jsonb not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),result jsonb not null,created_at timestamptz not null
);
create function public.native_correction_immutable() returns trigger language plpgsql set search_path=public as $$begin raise exception 'Native correction history is immutable' using errcode='23514';end $$;
do $$declare t text;begin foreach t in array array['native_dispense_correction_events','native_dispense_correction_operations'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger native_correction_immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()',t);
 execute format('create trigger native_correction_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
 execute format('create trigger native_correction_audit after insert on public.%I for each row execute function public.native_rx_audit()',t);
 end loop;end $$;
create function public.native_correction_actor(p_kind text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();n text;begin
 if p_kind not in('clinical_annotation','operational_annotation','pickup_amendment') or p_kind is null then raise exception 'Correction kind required' using errcode='23514';end if;
 if p_kind='clinical_annotation' and not exists(select 1 from public.user_roles where user_id=a and role='DVM') then raise exception 'Active veterinarian required for clinical annotation' using errcode='42501';end if;
 select full_name into n from public.profiles where id=a;perform public.native_rx_text(to_jsonb(n),200);
 return jsonb_build_object('id',a,'name',n,'authority',case when p_kind='clinical_annotation' then 'active_dvm' else 'active_staff' end);
end $$;
create function public.native_correction_uuid(v jsonb,nullable boolean default false) returns uuid language plpgsql immutable set search_path=public as $$
declare u uuid:=public.native_rx_uuid(v,nullable);begin
 if u is not null and v#>>'{}' is distinct from u::text then raise exception 'Canonical lowercase correction identity required' using errcode='23514';end if;return u;
end $$;
create function public.native_correction_instant(v jsonb) returns timestamptz language plpgsql immutable set search_path=public as $$
declare t text:=v#>>'{}';stamp timestamptz;begin
 if jsonb_typeof(v) is distinct from 'string' or t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Finite correction timestamp required' using errcode='23514';end if;
 if substring(t,12,2)::integer>23 or substring(t,15,2)::integer>59 or substring(t,18,2)::integer>59 then raise exception 'Finite correction timestamp required' using errcode='23514';end if;
 stamp:=t::timestamptz;if not isfinite(stamp) then raise exception 'Finite correction timestamp required' using errcode='23514';end if;return stamp;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Finite correction timestamp required' using errcode='23514';end $$;
create function public.native_correction_pickup(p_dispense_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',p.id,'document_hash',public.native_fulfillment_hash(p.document),'picked_up_at',p.document->'picked_up_at','recipient_name',p.document->'recipient_name','recipient_relationship',p.document->'recipient_relationship','actor_id',p.actor_id) from public.native_pickups p where p.dispense_id=p_dispense_id;
$$;
-- Verify canonical hashes AND immutable parent/operation/predecessor bindings.
-- This stable reader takes no write gates and uses one caller snapshot.
create function public.native_correction_verified(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare d jsonb;target jsonb;head jsonb:=jsonb_build_object('event_id',null,'version',0,'record_hash',null);events jsonb:='[]';latest jsonb;ctx jsonb;pickup jsonb;e public.native_dispense_correction_events;o public.native_dispense_correction_operations;v jsonb;previous_stamp timestamptz;reference public.native_dispense_correction_events;
begin
 d:=public.native_fulfillment_verified_dispense(p_dispense_id);
 if d is null or p_authorization_id is null or p_pet_id is null or d->>'authorization_id' is distinct from p_authorization_id::text or d->>'pet_id' is distinct from p_pet_id::text then return null;end if;
 target:=jsonb_build_object('authorization_id',p_authorization_id,'pet_id',p_pet_id,'dispense_id',p_dispense_id);pickup:=public.native_correction_pickup(p_dispense_id);
 for e in select * from public.native_dispense_correction_events where dispense_id=p_dispense_id order by sequence loop
  v:=e.document;select * into o from public.native_dispense_correction_operations where id=e.id;
  if o.id is null or o.actor_id<>e.actor_id or o.result is distinct from v or o.created_at is distinct from e.created_at
   or o.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',o.actor_id,'operation','append_native_dispense_correction','request',o.request))
   or e.authorization_id<>p_authorization_id or e.pet_id<>p_pet_id or e.sequence<>(head->>'version')::integer+1 or e.prior_event_id::text is distinct from head->>'event_id'
   or v->'target' is distinct from target or v->>'id' is distinct from e.id::text or v->'version' is distinct from '1'::jsonb
   or v->'sequence' is distinct from to_jsonb(e.sequence) or v->>'prior_event_id' is distinct from head->>'event_id' or v->>'prior_record_hash' is distinct from head->>'record_hash'
   or v#>>'{actor,id}' is distinct from e.actor_id::text or v->>'kind' is distinct from e.kind or (v->>'created_at')::timestamptz is distinct from e.created_at
   or v->>'authorization_hash' is distinct from d->>'authorization_hash' or v->>'dispense_document_hash' is distinct from public.native_fulfillment_hash(d)
   or v->>'record_hash' is distinct from e.record_hash or e.record_hash is distinct from public.native_fulfillment_hash(v-'record_hash')
   or v->>'reviewed_context_hash' is distinct from public.native_fulfillment_hash(e.reviewed_context)
   or e.reviewed_context->'target' is distinct from target or e.reviewed_context->'head' is distinct from head
   or e.reviewed_context->'latest_pickup_amendment' is distinct from coalesce(latest,'null'::jsonb)
   or e.reviewed_context->>'authorization_hash' is distinct from d->>'authorization_hash'
   or e.reviewed_context->>'dispense_document_hash' is distinct from public.native_fulfillment_hash(d)
   or e.reviewed_context->>'dispense_artifact_hash' is distinct from d->>'artifact_hash'
   or e.reviewed_context->'dispensed_at' is distinct from d->'dispensed_at'
   or (e.reviewed_context->'original_pickup'<>'null'::jsonb and e.reviewed_context->'original_pickup' is distinct from pickup)
   or e.created_at<(d->>'dispensed_at')::timestamptz or (previous_stamp is not null and e.created_at<previous_stamp)
  then raise exception 'Native correction integrity mismatch' using errcode='23514';end if;
  perform public.native_rx_keys(v,array['version','id','target','authorization_hash','dispense_document_hash','sequence','prior_event_id','prior_record_hash','actor','kind','reason','note','amends_event_id','pickup_amendment','reviewed_context_hash','created_at','record_hash']);
  perform public.native_rx_keys(e.reviewed_context,array['version','target','authorization_hash','dispense_document_hash','dispense_artifact_hash','dispensed_at','original_pickup','head','latest_pickup_amendment']);
  perform public.native_rx_keys(v->'actor',array['id','name','authority']);perform public.native_rx_text(v#>'{actor,name}',200);
  if v#>>'{actor,authority}' is distinct from (case when e.kind='clinical_annotation' then 'active_dvm' else 'active_staff' end)
   or (o.request->>'authorization_id')::uuid is distinct from p_authorization_id or (o.request->>'pet_id')::uuid is distinct from p_pet_id or (o.request->>'dispense_id')::uuid is distinct from p_dispense_id
   or o.request-'authorization_id'-'pet_id'-'dispense_id'-'expected_context_hash'-'expected_head'-'attest_review' is distinct from jsonb_build_object('kind',v->'kind','reason',v->'reason','note',v->'note','amends_event_id',v->'amends_event_id','pickup_amendment',v->'pickup_amendment')
   or o.request->'expected_head' is distinct from head or o.request->>'expected_context_hash' is distinct from v->>'reviewed_context_hash' or o.request->'attest_review' is distinct from 'true'::jsonb
  then raise exception 'Native correction receipt mismatch' using errcode='23514';end if;
  if e.kind='pickup_amendment' then
   if pickup is null or e.created_at<(pickup->>'picked_up_at')::timestamptz or (v#>>'{pickup_amendment,original_pickup_id}')::uuid is distinct from (pickup->>'id')::uuid or (v->>'amends_event_id')::uuid is distinct from (latest->>'event_id')::uuid then raise exception 'Native pickup amendment chain mismatch' using errcode='23514';end if;
   latest:=jsonb_build_object('event_id',e.id,'version',e.sequence,'value',v->'pickup_amendment');
  elsif v->'pickup_amendment' is distinct from 'null'::jsonb then raise exception 'Native correction kind mismatch' using errcode='23514';end if;
  if v->>'amends_event_id' is not null then
   select * into reference from public.native_dispense_correction_events where id=(v->>'amends_event_id')::uuid;
   if reference.id is null or reference.dispense_id<>p_dispense_id or reference.sequence>=e.sequence or reference.kind<>e.kind then raise exception 'Native correction amendment target mismatch' using errcode='23514';end if;
  end if;
  head:=jsonb_build_object('event_id',e.id,'version',e.sequence,'record_hash',e.record_hash);events:=events||jsonb_build_array(v);previous_stamp:=e.created_at;
 end loop;
 ctx:=jsonb_build_object('version',1,'target',target,'authorization_hash',d->'authorization_hash','dispense_document_hash',public.native_fulfillment_hash(d),'dispense_artifact_hash',d->'artifact_hash','dispensed_at',d->'dispensed_at','original_pickup',pickup,'head',head,'latest_pickup_amendment',latest);
 return jsonb_build_object('context',ctx,'context_hash',public.native_fulfillment_hash(ctx),'events',events);
end $$;
create function public.native_correction_receipt(o public.native_dispense_correction_operations) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('version',1,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
$$;
create function public.preview_native_dispense_correction(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();v jsonb;begin
 if p_authorization_id is null then raise exception 'Exact correction target required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||p_authorization_id::text,0));perform public.clinical_require_staff();
 v:=public.native_correction_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then raise exception 'Exact correction target required' using errcode='23514';end if;
 perform public.clinical_require_staff();return jsonb_build_object('version',1,'actor_id',a,'context',v->'context','context_hash',v->'context_hash','observed_at',clock_timestamp());
end $$;
create function public.append_native_dispense_correction(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();actor jsonb;aid uuid;pet uuid;did uuid;amends uuid;kind text;v jsonb;c jsonb;head jsonb;doc jsonb;pickup jsonb;assertion jsonb;stamp timestamptz;handoff_at timestamptz;seq integer;old public.native_dispense_correction_operations;reference public.native_dispense_correction_events;
begin
 if p_id is null then raise exception 'Stable correction ID required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','dispense_id','kind','expected_context_hash','expected_head','reason','note','amends_event_id','pickup_amendment','attest_review']);
 aid:=public.native_correction_uuid(p_request->'authorization_id');pet:=public.native_correction_uuid(p_request->'pet_id');did:=public.native_correction_uuid(p_request->'dispense_id');amends:=public.native_correction_uuid(p_request->'amends_event_id',true);kind:=p_request->>'kind';
 perform public.native_rx_text(p_request->'reason',2000);perform public.native_rx_text(p_request->'note',4000);
 if kind is null or kind not in('clinical_annotation','operational_annotation','pickup_amendment') or p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or p_request->>'expected_context_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Exact correction review required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request->'expected_head',array['event_id','version','record_hash']);perform public.native_correction_uuid(p_request#>'{expected_head,event_id}',true);
 perform pg_advisory_xact_lock(hashtextextended('native-dispense-correction-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into old from public.native_dispense_correction_operations where id=p_id;
 if found then
  if old.actor_id<>a or old.request is distinct from p_request then raise exception 'Correction identifier already used' using errcode='23514';end if;
  perform public.native_correction_verified(aid,pet,did);perform public.clinical_require_staff();return public.native_correction_receipt(old);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));actor:=public.native_correction_actor(kind);
 v:=public.native_correction_verified(aid,pet,did);if v is null then raise exception 'Exact correction target required' using errcode='23514';end if;
 c:=v->'context';head:=c->'head';
 if p_request->>'expected_context_hash' is distinct from v->>'context_hash' or p_request->'expected_head' is distinct from head then raise exception 'Correction review context changed' using errcode='40001';end if;
 if (head->>'version')::integer=2147483647 then raise exception 'Correction history version exhausted' using errcode='23514';end if;seq:=(head->>'version')::integer+1;
 if amends is not null then select * into reference from public.native_dispense_correction_events where id=amends;
  if reference.id is null or reference.dispense_id<>did or reference.kind<>kind then raise exception 'Exact same-kind correction amendment required' using errcode='23514';end if;
 end if;
 stamp:=clock_timestamp();
 if stamp<(c->>'dispensed_at')::timestamptz or (jsonb_array_length(v->'events')>0 and stamp<(v#>>'{events,-1,created_at}')::timestamptz) then raise exception 'Correction observation clock moved backwards' using errcode='40001';end if;
 if kind='pickup_amendment' then
  pickup:=c->'original_pickup';assertion:=p_request->'pickup_amendment';perform public.native_rx_keys(assertion,array['original_pickup_id','disposition','handoff']);
  if pickup='null'::jsonb or pickup is null or public.native_correction_uuid(assertion->'original_pickup_id')::text is distinct from pickup->>'id' or amends::text is distinct from c#>>'{latest_pickup_amendment,event_id}' then raise exception 'Exact original pickup and latest amendment required' using errcode='23514';end if;
  if stamp<(pickup->>'picked_up_at')::timestamptz then raise exception 'Correction observation clock moved backwards' using errcode='40001';end if;
  if assertion->>'disposition'='recorded_in_error' then
   if assertion->'handoff' is distinct from 'null'::jsonb then raise exception 'Disputed pickup must not assert replacement handoff' using errcode='23514';end if;
  elsif assertion->>'disposition'='corrected_handoff' then
   perform public.native_rx_keys(assertion->'handoff',array['picked_up_at','recipient_name','recipient_relationship']);perform public.native_rx_text(assertion#>'{handoff,recipient_name}',200);perform public.native_rx_text(assertion#>'{handoff,recipient_relationship}',200);
   handoff_at:=public.native_correction_instant(assertion#>'{handoff,picked_up_at}');if handoff_at<(c->>'dispensed_at')::timestamptz or handoff_at>stamp then raise exception 'Corrected handoff time outside recorded bounds' using errcode='23514';end if;
  else raise exception 'Pickup amendment disposition required' using errcode='23514';end if;
 elsif p_request->'pickup_amendment' is distinct from 'null'::jsonb then raise exception 'Annotation cannot replace pickup' using errcode='23514';end if;
 actor:=public.native_correction_actor(kind);
 doc:=jsonb_build_object('version',1,'id',p_id,'target',c->'target','authorization_hash',c->'authorization_hash','dispense_document_hash',c->'dispense_document_hash','sequence',seq,'prior_event_id',head->'event_id','prior_record_hash',head->'record_hash','actor',actor,'kind',kind,'reason',p_request->'reason','note',p_request->'note','amends_event_id',p_request->'amends_event_id','pickup_amendment',p_request->'pickup_amendment','reviewed_context_hash',v->'context_hash','created_at',stamp);
 doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_dispense_correction_events values(p_id,aid,pet,did,seq,(head->>'event_id')::uuid,a,kind,stamp,doc->>'record_hash',c,doc);
 insert into public.native_dispense_correction_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','append_native_dispense_correction','request',p_request)),doc,stamp) returning * into old;
 perform public.native_correction_actor(kind);return public.native_correction_receipt(old);
end $$;
create function public.recover_native_dispense_correction(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();o public.native_dispense_correction_operations;begin
 select * into o from public.native_dispense_correction_operations where id=p_id;if not found then return null;end if;if o.actor_id<>a then raise exception 'Correction receipt unavailable' using errcode='42501';end if;
 perform public.native_correction_verified((o.request->>'authorization_id')::uuid,(o.request->>'pet_id')::uuid,(o.request->>'dispense_id')::uuid);return public.native_correction_receipt(o);
end $$;
create function public.read_native_dispense_corrections(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;begin perform public.clinical_require_staff();v:=public.native_correction_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then return null;end if;return jsonb_build_object('version',1,'context',v->'context','context_hash',v->'context_hash');end $$;
create function public.list_native_dispense_corrections(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid,p_before_version integer default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;rows jsonb;more boolean;begin perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 100 or (p_before_version is not null and p_before_version<1) then raise exception 'Bounded correction cursor required' using errcode='23514';end if;
 v:=public.native_correction_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then return null;end if;
 select coalesce(jsonb_agg(x order by (x->>'sequence')::integer desc),'[]') into rows from(select value x from jsonb_array_elements(v->'events') where p_before_version is null or (value->>'sequence')::integer<p_before_version order by (value->>'sequence')::integer desc limit p_limit+1) q;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;
 return jsonb_build_object('version',1,'target',v#>'{context,target}','head',v#>'{context,head}','events',rows,'next_before_version',case when more then (rows->-1->>'sequence')::integer else null end);
end $$;
create function public.native_correction_summary(p_authorization_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record;v jsonb;heads jsonb:='[]';n bigint:=0;begin
 for r in select distinct e.dispense_id,e.pet_id from public.native_dispense_correction_events e where e.authorization_id=p_authorization_id order by e.dispense_id loop
  v:=public.native_correction_verified(p_authorization_id,r.pet_id,r.dispense_id);if v is null then raise exception 'Native correction target unavailable' using errcode='23514';end if;
  n:=n+(v#>>'{context,head,version}')::bigint;heads:=heads||jsonb_build_array(jsonb_build_object('dispense_id',r.dispense_id,'head',v#>'{context,head}'));
 end loop;
 if n>9007199254740991 then raise exception 'Correction summary count exceeds exact bound' using errcode='23514';end if;
 return jsonb_build_object('version',1,'event_count',n,'affected_dispense_count',jsonb_array_length(heads),'heads_hash',public.native_fulfillment_hash(heads));
end $$;
create function public.native_correction_disclosure(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;begin
 v:=public.native_correction_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then raise exception 'Exact correction target required' using errcode='23514';end if;
 if jsonb_array_length(v->'events')>100 then raise exception 'More than100 correction events; use complete paginated history instead of this package' using errcode='23514';end if;
 return jsonb_build_object('version',1,'head',v#>'{context,head}','events',v->'events','latest_pickup_amendment',v#>'{context,latest_pickup_amendment}');
end $$;
-- Preserve a private frozen-format composer for inherited snapshots. Public old
-- print fails closed when new annotations would otherwise be silently omitted.
alter function public.read_native_prescription_print(uuid,uuid) rename to native_correction_print_legacy;
revoke all on function public.native_correction_print_legacy(uuid,uuid) from public,anon,authenticated,service_role;
create function public.read_native_prescription_print(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin
 perform public.clinical_require_staff();r:=public.native_correction_print_legacy(p_authorization_id,p_dispense_id);
 if exists(select 1 from public.native_dispense_correction_events where authorization_id=p_authorization_id) then raise exception 'Prescription has correction history; use version2 print disclosure' using errcode='23514';end if;
 perform public.clinical_require_staff();return r;
end $$;
create function public.read_native_prescription_print_v2(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;summary jsonb;disclosure jsonb;pickup jsonb;pet uuid;begin
 perform public.clinical_require_staff();r:=public.native_correction_print_legacy(p_authorization_id,p_dispense_id);
 summary:=public.native_correction_summary(p_authorization_id);
 if p_dispense_id is not null then
  pet:=(r#>>'{prescription,patient,id}')::uuid;disclosure:=public.native_correction_disclosure(p_authorization_id,pet,p_dispense_id);pickup:=public.native_correction_pickup(p_dispense_id);
 end if;
 r:=jsonb_set(r,'{status,checked_at}',to_jsonb(clock_timestamp()));perform public.clinical_require_staff();
 return r||jsonb_build_object('version',2,'correction_summary',summary,'dispense_corrections',disclosure,'original_pickup',pickup);
end $$;

alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add constraint record_release_policy_accepted_schema_version_check check(accepted_schema_version in(1,2,3,4,5,6,7,8,9,10,11));
alter function public.release_preview_v10_internal(uuid,uuid,text,text,jsonb) rename to native_correction_release_base;
revoke all on function public.native_correction_release_base(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.release_preview_v10_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin
 r:=public.native_correction_release_base(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 if exists(select 1 from public.native_dispense_correction_events e where e.authorization_id in(
  select (value->>'id')::uuid from jsonb_array_elements(r#>'{snapshot,native_prescriptions}') union select (value#>>'{prescription,id}')::uuid from jsonb_array_elements(r#>'{snapshot,native_dispenses}'))) then raise exception 'Native correction history requires release schema11' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;return r;
end $$;
create function public.release_preview_v11_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;s jsonb;p jsonb;d jsonb;prescriptions jsonb:='[]';dispenses jsonb:='[]';begin
 r:=public.native_correction_release_base(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);s:=r->'snapshot';
 for p in select value from jsonb_array_elements(s->'native_prescriptions') loop
  prescriptions:=prescriptions||jsonb_build_array(p||jsonb_build_object('corrections',public.native_correction_summary((p->>'id')::uuid)));
 end loop;
 for d in select value from jsonb_array_elements(s->'native_dispenses') loop
  p:=d->'prescription';p:=p||jsonb_build_object('corrections',public.native_correction_summary((p->>'id')::uuid));
  dispenses:=dispenses||jsonb_build_array(d||jsonb_build_object('prescription',p,'corrections',public.native_correction_disclosure((p->>'id')::uuid,p_pet_id,(d->>'id')::uuid)));
 end loop;
 s:=s||jsonb_build_object('schema_version',11,'native_prescriptions',prescriptions,'native_dispenses',dispenses);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 return jsonb_build_object('snapshot',s,'source_hash',public.native_fulfillment_hash(s));
end $$;
create function public.preview_record_release_v11(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();r:=public.release_preview_v11_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);perform public.clinical_require_staff();return r;end $$;
do $$declare d text;needle text;name text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=10 then';if strpos(d,needle)=0 then raise exception 'Expected schema10 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=11 then preview:=public.release_preview_v11_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=10 then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'',''10'')','(''5'',''6'',''7'',''8'',''9'',''10'',''11'')');d:=replace(d,'(''6'',''7'',''8'',''9'',''10'')','(''6'',''7'',''8'',''9'',''10'',''11'')');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''10'' then';if strpos(d,needle)=0 then raise exception 'Expected schema10 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''11'' then current_preview:=public.release_preview_v11_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''10'' then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'',''10'')','(''5'',''6'',''7'',''8'',''9'',''10'',''11'')');d:=replace(d,'(''6'',''7'',''8'',''9'',''10'')','(''6'',''7'',''8'',''9'',''10'',''11'')');execute d;
 select pg_get_functiondef('public.verify_release_source_original_v5(jsonb,jsonb,bytea)'::regprocedure) into d;
 needle:='p_snapshot->>''schema_version'' is distinct from ''10''';if strpos(d,needle)=0 then raise exception 'Expected schema10 original verifier missing';end if;
 execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''11''');
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  needle:='''9'',''10'')';if d is null or strpos(d,needle)=0 then raise exception 'Expected schema10 inherited provenance guard missing: %',name;end if;execute replace(d,needle,'''9'',''10'',''11'')');
 end loop;
 select pg_get_functiondef('public.invalidate_native_record_release()'::regprocedure) into d;
 needle:='r.snapshot->>''schema_version''=''10''';if strpos(d,needle)=0 then raise exception 'Expected native schema10 invalidation missing';end if;
 execute replace(d,needle,'r.snapshot->>''schema_version'' in(''10'',''11'')');
end $$;
create function public.invalidate_native_correction_release() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),r.id,'source_changed','Native dispensing correction history changed; review a fresh schema11 package',NEW.actor_id
 from public.record_releases r where r.snapshot->>'schema_version' in('10','11') and exists(select 1 from public.record_release_sources rs where rs.release_id=r.id and
 ((rs.source_kind='native_prescription' and rs.source_id=NEW.authorization_id) or (rs.source_kind='native_dispense' and exists(select 1 from public.native_dispenses d where d.id=rs.source_id and d.authorization_id=NEW.authorization_id))));
 return NEW;
end $$;
create trigger native_correction_release_changed after insert on public.native_dispense_correction_events for each row execute function public.invalidate_native_correction_release();
create function public.list_record_release_sources_v11(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();r:=public.list_record_release_sources_v10(p_pet_id,p_offset);perform public.clinical_require_staff();return r||jsonb_build_object('policy_v11_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=11));end $$;
create function public.select_all_record_release_sources_v11(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();r:=public.select_all_record_release_sources_v10(p_pet_id);perform public.clinical_require_staff();return r||jsonb_build_object('scope',coalesce(r->>'scope','')||'; schema11 native correction disclosure');end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'native_correction_%' or proname in('preview_native_dispense_correction','append_native_dispense_correction','recover_native_dispense_correction','read_native_dispense_corrections','list_native_dispense_corrections','read_native_prescription_print','read_native_prescription_print_v2','release_preview_v10_internal','release_preview_v11_internal','preview_record_release_v11','invalidate_native_correction_release','list_record_release_sources_v11','select_all_record_release_sources_v11')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('preview_native_dispense_correction','append_native_dispense_correction','recover_native_dispense_correction','read_native_dispense_corrections','list_native_dispense_corrections','read_native_prescription_print','read_native_prescription_print_v2','preview_record_release_v11','list_record_release_sources_v11','select_all_record_release_sources_v11') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
