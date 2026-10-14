-- Extend the private action ledger for exact editor completion saves.
alter table public.appointment_next_visit_actions drop constraint appointment_next_visit_actions_operation_check;
alter table public.appointment_next_visit_actions add constraint appointment_next_visit_actions_operation_check check(operation in('complete','decide','editor'));
do $$declare body text;begin
 body:=pg_get_functiondef('public.recover_next_visit_action(uuid,uuid,text,jsonb)'::regprocedure);
 if position('p_operation not in(''complete'',''decide'')' in body)=0 then raise exception 'Unexpected action operation contract';end if;
 execute replace(body,'p_operation not in(''complete'',''decide'')','p_operation not in(''complete'',''decide'',''editor'')');
end $$;
-- Private reviewed requests support reload without storing clinical drafts in the browser.
create table public.appointment_next_visit_reviews(
 id uuid primary key,actor_id uuid not null references auth.users(id),
 operation text not null check(operation in('complete','decide','editor')),request jsonb not null,
 prepared_session_id uuid not null,prepared_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default(clock_timestamp()+interval '24 hours'),
 check(jsonb_typeof(request)='object' and octet_length(request::text)<=65536),check(expires_at>prepared_at)
);
create table public.appointment_next_visit_review_cancellations(
 id uuid primary key,actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp()
);
create index appointment_next_visit_review_actor on public.appointment_next_visit_reviews(actor_id,expires_at);
do $$declare t text;begin
 foreach t in array array['appointment_next_visit_reviews','appointment_next_visit_review_cancellations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger next_visit_review_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 end loop;
end $$;
create function public.next_visit_review_session() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();sid uuid;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then sid:=null;end;
 if sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=actor and (not_after is null or not_after>clock_timestamp())) then
  raise exception 'Current staff session required for reviewed drafts' using errcode='42501';end if;
 return sid;
end $$;
-- Private guard also protects direct canonical calls for a cancelled/expired reviewed UUID.
-- The canonical receipt is recovered BEFORE this guard, so expiry never erases saved work.
create function public.guard_next_visit_review(p_actor uuid,p_action uuid,p_operation text,p_request jsonb) returns void language plpgsql stable security definer set search_path=public as $$
declare r appointment_next_visit_reviews;c appointment_next_visit_review_cancellations;begin
 select * into c from appointment_next_visit_review_cancellations where id=p_action;
 if found then raise exception 'Reviewed action cancelled; check saved outcome before new work' using errcode='PT409';end if;
 select * into r from appointment_next_visit_reviews where id=p_action;
 if not found then return;end if;
 if r.actor_id is distinct from p_actor or r.operation is distinct from p_operation or r.request is distinct from p_request then
  raise exception 'Reviewed action belongs to different work' using errcode='23505';end if;
 perform public.next_visit_review_session();
 if r.expires_at<=clock_timestamp() then raise exception 'Review expired; check saved outcome before reviewing again' using errcode='PT409';end if;
end $$;
create function public.read_next_visit_review(p_actor_id uuid,p_action_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r appointment_next_visit_reviews;receipt jsonb;begin
 perform public.next_visit_review_session();
 if actor is distinct from p_actor_id or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 select * into r from appointment_next_visit_reviews where id=p_action_id;
 if not found then return null;end if;
 if r.actor_id<>actor then raise exception 'Review belongs to another account' using errcode='42501';end if;
 receipt:=public.recover_next_visit_action(actor,r.id,r.operation,r.request);
 return jsonb_build_object('id',r.id,'actor_id',actor,'operation',r.operation,'request',r.request,'expires_at',r.expires_at,'receipt',receipt,
 'state',case when receipt is not null then 'saved' when exists(select 1 from appointment_next_visit_review_cancellations where id=r.id) then 'cancelled' when r.expires_at<=clock_timestamp() then 'expired' else 'prepared' end);
end $$;
create function public.prepare_next_visit_review(p_actor_id uuid,p_action_id uuid,p_operation text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();sid uuid:=public.next_visit_review_session();r appointment_next_visit_reviews;receipt jsonb;begin
 if actor is distinct from p_actor_id or p_action_id is null or p_operation is null or p_operation not in('complete','decide','editor') then raise exception 'Matched review actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.next_visit_review_session();
 select * into r from appointment_next_visit_reviews where id=p_action_id;
 if found then
  if r.actor_id<>actor or r.operation<>p_operation or r.request is distinct from p_request then raise exception 'Review UUID is immutable' using errcode='23505';end if;
  return public.read_next_visit_review(actor,p_action_id);
 end if;
 if exists(select 1 from appointment_next_visit_review_cancellations where id=p_action_id) then raise exception 'Review was cancelled' using errcode='PT409';end if;
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>65536 then raise exception 'Bounded reviewed request required' using errcode='23514';end if;
 if p_operation='complete' then
  perform public.native_rx_keys(p_request,array['id','expected_version']);perform public.native_rx_uuid(p_request->'id');perform public.appointment_catalog_integer(p_request->'expected_version',1,2147483647);
 elsif p_operation='editor' then
  perform public.native_rx_keys(p_request,array['id','expected_version','booking']);
  perform public.native_rx_keys(p_request->'booking',array['mode','values']);
 else
  perform public.native_rx_keys(p_request,array['occurrence_id','expected_version','values']);perform public.native_rx_uuid(p_request->'occurrence_id');perform public.appointment_catalog_integer(p_request->'expected_version',0,2147483647);
  perform public.native_rx_keys(p_request->'values',array['action','note','followup_on','booking','appointment_id','appointment_version']);
 end if;
 receipt:=public.recover_next_visit_action(actor,p_action_id,p_operation,p_request);
 if receipt is null and (select count(*) from appointment_next_visit_reviews pending_review where pending_review.actor_id=actor and pending_review.expires_at>clock_timestamp() and not exists(select 1 from appointment_next_visit_actions a where a.id=pending_review.id) and not exists(select 1 from appointment_next_visit_review_cancellations c where c.id=pending_review.id))>=32 then raise exception 'Review pending actions before preparing more work' using errcode='23514';end if;
 insert into appointment_next_visit_reviews(id,actor_id,operation,request,prepared_session_id) values(p_action_id,actor,p_operation,p_request,sid);
 return public.read_next_visit_review(actor,p_action_id);
end $$;
-- Stable custom/catalog editor completion, including an already-completed notes edit.
create function public.save_editor_completion(p_actor_id uuid,p_action_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();receipt jsonb;row appointments;id uuid;expected integer;v jsonb;booking jsonb;offsets integer[];element jsonb;begin
 if actor is distinct from p_actor_id or p_action_id is null then raise exception 'Matched editor actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.next_visit_review_session();
 receipt:=public.recover_next_visit_action(actor,p_action_id,'editor',p_request);if receipt is not null then return receipt;end if;
 perform public.guard_next_visit_review(actor,p_action_id,'editor',p_request);
 perform public.native_rx_keys(p_request,array['id','expected_version','booking']);
 id:=public.native_rx_uuid(p_request->'id',true);
 if p_request->'expected_version'<>'null'::jsonb then expected:=public.appointment_catalog_integer(p_request->'expected_version',1,2147483647);end if;
 if (id is null)<>(expected is null) then raise exception 'Matched editor identity/version required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request->'booking',array['mode','values']);v:=p_request#>'{booking,values}';
 if p_request#>>'{booking,mode}'='catalog' then
  if v->>'status' is distinct from 'COMPLETED' then raise exception 'Completed editor status required' using errcode='23514';end if;
  if exists(select 1 from appointment_booking_actions where appointment_booking_actions.id=p_action_id) then raise exception 'Action already belongs to another booking' using errcode='23505';end if;
  booking:=public.save_catalog_appointment(actor,p_action_id,id,expected,v);
  select * into row from appointments where appointments.id=(booking#>>'{appointment,id}')::uuid;
 elsif p_request#>>'{booking,mode}'='custom' then
  perform public.native_rx_keys(v,array['client_id','pet_id','scheduled_at','duration_minutes','appointment_type','assigned_dvm_id','visit_type','address_snapshot','travel_before_minutes','travel_after_minutes','resource_name','notes','reminder_offsets']);
  if jsonb_typeof(v->'reminder_offsets') is distinct from 'array' then raise exception 'Typed reminders required' using errcode='23514';end if;
  offsets:='{}';for element in select value from jsonb_array_elements(v->'reminder_offsets') loop offsets:=array_append(offsets,public.appointment_catalog_integer(element,1,720));end loop;
  row:=public.save_appointment(actor,id,expected,public.native_rx_uuid(v->'client_id'),public.native_rx_uuid(v->'pet_id'),public.appointment_catalog_instant(v->'scheduled_at'),public.appointment_catalog_integer(v->'duration_minutes',15,480),v->>'appointment_type','COMPLETED',public.native_rx_uuid(v->'assigned_dvm_id'),v->>'visit_type',v->>'address_snapshot',public.appointment_catalog_integer(v->'travel_before_minutes',0,240),public.appointment_catalog_integer(v->'travel_after_minutes',0,240),v->>'resource_name',v->>'notes',offsets);
 else raise exception 'Reviewed custom or catalog editor required' using errcode='23514';end if;
 receipt:=jsonb_build_object('appointment',to_jsonb(row),'context',public.read_appointment_completion(row.id,row.version));
 insert into appointment_next_visit_actions(id,actor_id,operation,request,receipt) values(p_action_id,actor,'editor',p_request,receipt);return receipt;
end $$;
create function public.execute_next_visit_review(p_actor_id uuid,p_action_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r appointment_next_visit_reviews;receipt jsonb;begin
 perform public.next_visit_review_session();
 if actor is distinct from p_actor_id or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.next_visit_review_session();
 select * into r from appointment_next_visit_reviews where id=p_action_id;
 if not found or r.actor_id<>actor then raise exception 'Own prepared review required' using errcode='42501';end if;
 receipt:=public.recover_next_visit_action(actor,r.id,r.operation,r.request);if receipt is not null then return receipt;end if;
 perform public.guard_next_visit_review(actor,r.id,r.operation,r.request);
 if r.operation='editor' then return public.save_editor_completion(actor,r.id,r.request);end if;
 if r.operation='complete' then return public.complete_appointment(actor,r.id,public.native_rx_uuid(r.request->'id'),public.appointment_catalog_integer(r.request->'expected_version',1,2147483647));end if;
 return public.save_next_visit_outcome(actor,r.id,public.native_rx_uuid(r.request->'occurrence_id'),public.appointment_catalog_integer(r.request->'expected_version',0,2147483647),r.request->'values');
end $$;
create function public.cancel_next_visit_review(p_actor_id uuid,p_action_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r appointment_next_visit_reviews;a appointment_next_visit_actions;c appointment_next_visit_review_cancellations;begin
 perform public.next_visit_review_session();
 if actor is distinct from p_actor_id or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.next_visit_review_session();
 select * into r from appointment_next_visit_reviews where id=p_action_id;
 select * into a from appointment_next_visit_actions where id=p_action_id;
 select * into c from appointment_next_visit_review_cancellations where id=p_action_id;
 if (r.id is not null and r.actor_id<>actor) or (a.id is not null and a.actor_id<>actor) or (c.id is not null and c.actor_id<>actor) then raise exception 'Review belongs to another account' using errcode='42501';end if;
 if a.id is not null then return jsonb_build_object('cancelled',false,'operation',a.operation,'receipt',a.receipt);end if;
 insert into appointment_next_visit_review_cancellations(id,actor_id) values(p_action_id,actor) on conflict do nothing;
 return jsonb_build_object('cancelled',true,'operation',r.operation,'receipt',null);
end $$;
-- Editor completion is read by its exact trigger-captured version, never the latest guess.
create function public.read_appointment_completion(p_appointment_id uuid,p_completed_version integer) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();occurrence uuid;begin
 select id into occurrence from appointment_completion_occurrences where appointment_id=p_appointment_id and appointment_version=p_completed_version;
 if occurrence is null then return null;end if;
 return public.read_next_visit_context(occurrence);
end $$;
create function public.list_patient_next_visits(p_pet_id uuid,p_after_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();result jsonb;begin
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 100 or (p_after_at is null)<>(p_after_id is null) or (p_after_at is not null and not isfinite(p_after_at)) then raise exception 'Bounded patient history cursor required' using errcode='23514';end if;
 with bounded as materialized(select id,recorded_at from appointment_completion_occurrences where pet_id=p_pet_id and (p_after_at is null or (recorded_at,id)>(p_after_at,p_after_id)) order by recorded_at,id limit p_limit+1),
 selected as materialized(select * from bounded order by recorded_at,id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.read_next_visit_context(s.id) order by s.recorded_at,s.id) from selected s),'[]'),
 'next',case when (select count(*) from bounded)>p_limit then (select jsonb_build_object('at',recorded_at,'id',id) from selected order by recorded_at desc,id desc limit 1) end) into result;return result;
end $$;
do $$declare signature regprocedure;body text;needle text;replacement text;begin
 foreach signature in array array['public.complete_appointment(uuid,uuid,uuid,integer)'::regprocedure,'public.save_next_visit_outcome(uuid,uuid,uuid,integer,jsonb)'::regprocedure] loop
  body:=pg_get_functiondef(signature);needle:='if receipt is not null then return receipt;end if;';
  replacement:=needle||case when signature::text like '%complete_appointment%' then E'\n perform public.guard_next_visit_review(actor,p_action_id,''complete'',req);' else E'\n perform public.guard_next_visit_review(actor,p_action_id,''decide'',req);' end;
  if position(needle in body)=0 or position('guard_next_visit_review' in body)>0 then raise exception 'Unexpected next-visit receipt contract';end if;
  execute replace(body,needle,replacement);
 end loop;
end $$;
do $$declare f record;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in('save_editor_completion','next_visit_review_session','guard_next_visit_review','prepare_next_visit_review','read_next_visit_review','execute_next_visit_review','cancel_next_visit_review','read_appointment_completion','list_patient_next_visits') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  if f.proname not in('save_editor_completion','next_visit_review_session','guard_next_visit_review') then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 end loop;
end $$;
