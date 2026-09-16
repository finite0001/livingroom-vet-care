-- Native terminal authorization history. Existing signed artifacts remain immutable.
alter table public.native_prescription_operations drop constraint native_prescription_operations_operation_check;
alter table public.native_prescription_operations add constraint native_prescription_operations_operation_check check(operation in ('configure_prescriber','save_draft','sign','cancel','replace'));
create table public.native_prescription_authorization_events (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),authorization_hash text not null,
 pet_id uuid not null references public.pets(id),action text not null check(action in ('cancel','replace')),
 prior_event_id uuid unique references public.native_prescription_authorization_events(id),event_version integer not null check(event_version>0),
 replacement_id uuid unique references public.native_prescription_authorizations(id),actor_id uuid not null references public.profiles(id),reason text not null,
 reviewed_context jsonb not null,reviewed_context_hash text not null,reconciliation jsonb,record_hash text not null,created_at timestamptz not null,
 unique(authorization_id,event_version),check((prior_event_id is null)=(event_version=1)),
 check((action='cancel' and replacement_id is null and reconciliation is null) or (action='replace' and replacement_id is not null and reconciliation is not null)),
 check(replacement_id is null or replacement_id<>authorization_id),check(authorization_hash ~ '^[a-f0-9]{64}$' and reviewed_context_hash ~ '^[a-f0-9]{64}$' and record_hash ~ '^[a-f0-9]{64}$')
);
create unique index native_rx_authorization_event_root on public.native_prescription_authorization_events(authorization_id) where prior_event_id is null;
create index native_rx_authorization_history on public.native_prescription_authorization_events(authorization_id,created_at desc,id desc);
alter table public.native_prescription_authorization_events enable row level security;
revoke all on public.native_prescription_authorization_events from public,anon,authenticated,service_role;
create trigger native_rx_event_immutable before update or delete on public.native_prescription_authorization_events for each row execute function public.guard_inquiry_history();
create trigger native_rx_event_audit after insert on public.native_prescription_authorization_events for each row execute function public.native_rx_audit();
-- Shared private materializer: intentionally creates NO operation receipt.
create function public.native_rx_materialize_authorization(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();di uuid;pet uuid;ev integer;preview jsonb;ctx jsonb;r jsonb;stamp timestamptz;h text;artifact jsonb;document jsonb;
begin
 perform public.native_rx_keys(p_request,array['draft_id','pet_id','expected_version','expected_context_hash','signature_name','attest_review']);
 di:=public.native_rx_uuid(p_request->'draft_id');pet:=public.native_rx_uuid(p_request->'pet_id');ev:=public.native_rx_revision(p_request->'expected_version');
 perform public.native_rx_text(p_request->'signature_name',200);
 if ev is null or p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or (p_request->>'expected_context_hash') !~ '^[a-f0-9]{64}$' then raise exception 'Exact signing review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform 1 from public.native_prescription_drafts where id=di for update;
 preview:=public.preview_native_prescription_sign(di,ev);ctx:=preview->'context';
 if (preview->>'pet_id')::uuid<>pet then raise exception 'Prescription patient mismatch' using errcode='23514';end if;
 if preview->>'context_hash'<>p_request->>'expected_context_hash' then raise exception 'Prescription signing context changed' using errcode='40001';end if;
 if p_request->>'signature_name'<>ctx#>>'{prescriber,name}' then raise exception 'Signature must match reviewed veterinarian identity' using errcode='23514';end if;
 stamp:=clock_timestamp();h:=encode(sha256(convert_to(jsonb_build_object('version',1,'id',p_id,'draft_id',di,'draft_version',ev,'actor_id',a,'context_hash',preview->>'context_hash','signature_name',p_request->>'signature_name','signed_at',stamp)::text,'UTF8')),'hex');
 artifact:=jsonb_build_object('schema_version',1,'authorization_id',p_id,'authorization_hash',h,'signed_at',stamp,'signature_name',p_request->>'signature_name',
 'patient',(ctx->'patient')-'version','household',(ctx->'household')-'version',
 'prescriber',jsonb_build_object('user_id',a,'name',ctx#>>'{prescriber,name}','license_number',ctx#>>'{prescriber,configuration,fields,license_number}','license_state',ctx#>>'{prescriber,configuration,fields,license_state}','practice_name',ctx#>>'{prescriber,configuration,fields,practice_name}','practice_address',ctx#>>'{prescriber,configuration,fields,practice_address}','practice_phone',ctx#>'{prescriber,configuration,fields,practice_phone}'),
 'medication',ctx#>'{draft,fields,medication}','quantity_per_fill',ctx#>'{draft,fields,quantity_per_fill}','unit',ctx#>'{draft,fields,unit}','refills_authorized',ctx#>'{draft,fields,refills_authorized}','fulfillment_mode',ctx#>'{draft,fields,fulfillment_mode}','starts_on',ctx#>'{draft,fields,starts_on}','expires_on',ctx#>'{draft,fields,expires_on}');
 document:=jsonb_build_object('id',p_id,'pet_id',pet,'client_id',ctx#>'{household,id}','draft_id',di,'draft_version',ev,'signed_by',a,'signed_at',stamp,'context_hash',preview->>'context_hash','context',ctx,'authorization_hash',h,'artifact',artifact);
 insert into public.native_prescription_authorizations values(p_id,pet,(ctx#>>'{household,id}')::uuid,di,document);
 update public.native_prescription_drafts set status='signed',authorization_id=p_id,updated_by=a,updated_at=stamp where id=di;
 if ctx->'prescriber' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 return document;
end $$;

create or replace function public.sign_native_prescription(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;document jsonb;
begin
 r:=public.native_rx_begin(p_id,'sign',p_request);if r is not null then return r;end if;
 document:=public.native_rx_materialize_authorization(p_id,p_request);
 return public.native_rx_finish(p_id,'sign',(document->>'pet_id')::uuid,p_request,document);
end $$;

-- Future dispensing must replace this explicit unknown-evidence adapter and use the authorization gate.
create function public.native_rx_usage_context(p_authorization_id uuid) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('version',1,'native_fill_accounting','not_implemented','dispensed_quantity',null,'used_fill_slots',null,'remaining_quantity',null,'external_fulfillment','unknown');
$$;
create function public.native_rx_event_projection(e public.native_prescription_authorization_events) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('version',1,'id',e.id,'authorization_id',e.authorization_id,'authorization_hash',e.authorization_hash,'pet_id',e.pet_id,'action',e.action,'prior_event_id',e.prior_event_id,'event_version',e.event_version,'replacement_id',e.replacement_id,'actor_id',e.actor_id,'reason',e.reason,'reviewed_context',e.reviewed_context,'reviewed_context_hash',e.reviewed_context_hash,'reconciliation',e.reconciliation,'record_hash',e.record_hash,'created_at',e.created_at);
$$;
create function public.native_rx_verified_authorization(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare stored public.native_prescription_authorizations;d jsonb;c jsonb;h text;artifact jsonb;
begin
 select * into stored from public.native_prescription_authorizations where id=p_id;if not found then return null;end if;
 d:=stored.document;c:=d->'context';
 perform public.native_rx_keys(d,array['id','pet_id','client_id','draft_id','draft_version','signed_by','signed_at','context_hash','context','authorization_hash','artifact']);
 if d->>'id'<>stored.id::text or d->>'pet_id'<>stored.pet_id::text or d->>'client_id'<>stored.client_id::text or d->>'draft_id'<>stored.draft_id::text
 or d->>'context_hash' is distinct from encode(sha256(convert_to(c::text,'UTF8')),'hex')
 or c#>>'{draft,id}' is distinct from d->>'draft_id' or c#>'{draft,version}' is distinct from d->'draft_version' or c#>>'{draft,status}' is distinct from 'draft'
 or c#>>'{patient,id}' is distinct from d->>'pet_id' or c#>>'{household,id}' is distinct from d->>'client_id' or c#>>'{prescriber,user_id}' is distinct from d->>'signed_by' then raise exception 'Stored native authorization integrity mismatch' using errcode='23514';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('version',1,'id',d->'id','draft_id',d->'draft_id','draft_version',d->'draft_version','actor_id',d->'signed_by','context_hash',d->'context_hash','signature_name',c#>'{prescriber,name}','signed_at',d->'signed_at')::text,'UTF8')),'hex');
 artifact:=jsonb_build_object('schema_version',1,'authorization_id',d->'id','authorization_hash',h,'signed_at',d->'signed_at','signature_name',c#>'{prescriber,name}',
 'patient',(c->'patient')-'version','household',(c->'household')-'version',
 'prescriber',jsonb_build_object('user_id',d->'signed_by','name',c#>>'{prescriber,name}','license_number',c#>>'{prescriber,configuration,fields,license_number}','license_state',c#>>'{prescriber,configuration,fields,license_state}','practice_name',c#>>'{prescriber,configuration,fields,practice_name}','practice_address',c#>>'{prescriber,configuration,fields,practice_address}','practice_phone',c#>'{prescriber,configuration,fields,practice_phone}'),
 'medication',c#>'{draft,fields,medication}','quantity_per_fill',c#>'{draft,fields,quantity_per_fill}','unit',c#>'{draft,fields,unit}','refills_authorized',c#>'{draft,fields,refills_authorized}','fulfillment_mode',c#>'{draft,fields,fulfillment_mode}','starts_on',c#>'{draft,fields,starts_on}','expires_on',c#>'{draft,fields,expires_on}');
 if d->>'authorization_hash' is distinct from h or d->'artifact' is distinct from artifact then raise exception 'Stored native authorization integrity mismatch' using errcode='23514';end if;
 return d;
end $$;
create function public.read_native_prescription_status(p_authorization_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb;e public.native_prescription_authorization_events;state text;
begin
 perform public.clinical_require_staff();
 if p_authorization_id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||p_authorization_id::text,0));
 perform public.clinical_require_staff();d:=public.native_rx_verified_authorization(p_authorization_id);
 if d is null or p_pet_id is null or d->>'pet_id'<>p_pet_id::text then return null;end if;
 select * into e from public.native_prescription_authorization_events where authorization_id=p_authorization_id order by event_version desc limit 1;
 state:=case when e.action='cancel' then 'cancelled' when e.action='replace' then 'replaced' when (d#>>'{artifact,expires_on}')::date<(now() at time zone 'America/Denver')::date then 'expired' else 'active' end;
 return jsonb_build_object('version',1,'pet_id',p_pet_id,'status',jsonb_build_object('authorization_id',p_authorization_id,'authorization_hash',d->>'authorization_hash','checked_at',clock_timestamp(),'state',state,'reason',e.reason,'replacement_id',e.replacement_id),'head_id',e.id,'head_version',coalesce(e.event_version,0),'usage',public.native_rx_usage_context(p_authorization_id));
end $$;
create function public.native_rx_change_context(p_authorization_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb;s jsonb;prescriber jsonb;p public.pets;alerts jsonb;
begin
 prescriber:=public.native_rx_require_dvm();d:=public.native_rx_verified_authorization(p_authorization_id);
 if d is null or p_pet_id is null or d->>'pet_id'<>p_pet_id::text then raise exception 'Exact native authorization patient required' using errcode='23514';end if;
 alerts:=public.read_patient_treatment_alerts(p_pet_id);select * into p from public.pets where id=p_pet_id for share;
 s:=public.read_native_prescription_status(p_authorization_id,p_pet_id);
 return jsonb_build_object('version',1,'authorization',d,'head',jsonb_build_object('id',s->'head_id','version',s->'head_version','state',s#>'{status,state}','reason',s#>'{status,reason}','replacement_id',s#>'{status,replacement_id}'),
 'patient_current',jsonb_build_object('id',p.id,'client_id',p.client_id,'version',p.version,'archived_at',p.archived_at,'deceased_at',p.deceased_at),'prescriber',prescriber,'alerts',alerts,'usage',s->'usage');
end $$;
create function public.preview_native_prescription_cancel(p_authorization_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();c jsonb;
begin
 if p_authorization_id is null then raise exception 'Exact authorization required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||p_authorization_id::text,0));
 c:=public.native_rx_change_context(p_authorization_id,p_pet_id);
 if c->'prescriber' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 return jsonb_build_object('version',1,'actor_id',a,'pet_id',p_pet_id,'context',c,'context_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'),'observed_at',statement_timestamp());
end $$;
create function public.preview_native_prescription_replacement(p_authorization_id uuid,p_pet_id uuid,p_draft_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior jsonb;fresh jsonb;c jsonb;
begin
 prior:=public.preview_native_prescription_cancel(p_authorization_id,p_pet_id);
 fresh:=public.preview_native_prescription_sign(p_draft_id,p_expected_version);
 if fresh->>'pet_id' is distinct from p_pet_id::text or fresh#>>'{context,household,id}' is distinct from prior#>>'{context,authorization,client_id}' then raise exception 'Replacement patient and household must match' using errcode='23514';end if;
 c:=jsonb_build_object('version',1,'prior',prior->'context','new_sign',fresh->'context','new_sign_context_hash',fresh->>'context_hash');
 return jsonb_build_object('version',1,'actor_id',auth.uid(),'pet_id',p_pet_id,'context',c,'context_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'),'observed_at',statement_timestamp());
end $$;
create function public.native_rx_check_change_request(p_request jsonb,p_replace boolean) returns void language plpgsql immutable set search_path=public as $$
begin
 perform public.native_rx_keys(p_request,case when p_replace then array['authorization_id','pet_id','expected_event_id','expected_context_hash','reason','attest_review','draft_id','expected_version','signature_name','reconciliation'] else array['authorization_id','pet_id','expected_event_id','expected_context_hash','reason','attest_review'] end);
 perform public.native_rx_uuid(p_request->'authorization_id');perform public.native_rx_uuid(p_request->'pet_id');perform public.native_rx_uuid(p_request->'expected_event_id',true);perform public.native_rx_text(p_request->'reason',2000);
 if p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or (p_request->>'expected_context_hash') !~ '^[a-f0-9]{64}$' then raise exception 'Exact authorization change review required' using errcode='23514';end if;
end $$;
create function public.native_rx_append_event(p_id uuid,p_request jsonb,p_preview jsonb,p_replacement_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior jsonb;basis jsonb;stamp timestamptz:=clock_timestamp();e public.native_prescription_authorization_events;action text:=case when p_replacement_id is null then 'cancel' else 'replace' end;
begin
 prior:=case when p_replacement_id is null then p_preview->'context' else p_preview#>'{context,prior}' end;
 basis:=jsonb_build_object('version',1,'id',p_id,'authorization_id',p_request->'authorization_id','authorization_hash',prior#>'{authorization,authorization_hash}','pet_id',p_request->'pet_id','action',action,'prior_event_id',prior#>'{head,id}','event_version',(prior#>>'{head,version}')::integer+1,'replacement_id',p_replacement_id,'actor_id',auth.uid(),'reason',p_request->>'reason','reviewed_context_hash',p_preview->>'context_hash','reconciliation',case when p_replacement_id is null then null else p_request->'reconciliation' end,'created_at',stamp);
 insert into public.native_prescription_authorization_events values(p_id,(p_request->>'authorization_id')::uuid,prior#>>'{authorization,authorization_hash}',(p_request->>'pet_id')::uuid,action,(prior#>>'{head,id}')::uuid,(prior#>>'{head,version}')::integer+1,p_replacement_id,auth.uid(),p_request->>'reason',p_preview->'context',p_preview->>'context_hash',case when p_replacement_id is null then null else p_request->'reconciliation' end,encode(sha256(convert_to(basis::text,'UTF8')),'hex'),stamp) returning * into e;
 return public.native_rx_event_projection(e);
end $$;
create function public.native_rx_check_change_context(p_request jsonb,p_preview jsonb,p_replace boolean) returns void language plpgsql immutable set search_path=public as $$
declare prior jsonb;begin
 prior:=case when p_replace then p_preview#>'{context,prior}' else p_preview->'context' end;
 if p_request->'expected_event_id' is distinct from prior#>'{head,id}' or p_request->>'expected_context_hash' is distinct from p_preview->>'context_hash' then raise exception 'Authorization change context changed' using errcode='40001';end if;
 if prior#>>'{head,state}' in ('cancelled','replaced') then raise exception 'Authorization already has a terminal event' using errcode='23514';end if;
end $$;
create function public.cancel_native_prescription(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;preview jsonb;e jsonb;
begin
 r:=public.native_rx_begin(p_id,'cancel',p_request);if r is not null then return r;end if;
 perform public.native_rx_check_change_request(p_request,false);
 preview:=public.preview_native_prescription_cancel((p_request->>'authorization_id')::uuid,(p_request->>'pet_id')::uuid);
 perform public.native_rx_check_change_context(p_request,preview,false);
 e:=public.native_rx_append_event(p_id,p_request,preview);
 if preview#>'{context,prescriber}' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 return public.native_rx_finish(p_id,'cancel',(p_request->>'pet_id')::uuid,p_request,e);
end $$;
create function public.replace_native_prescription(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r jsonb;preview jsonb;auth_doc jsonb;e jsonb;di uuid;ev integer;recon jsonb;k text;
begin
 r:=public.native_rx_begin(p_id,'replace',p_request);if r is not null then return r;end if;
 perform public.native_rx_check_change_request(p_request,true);
 di:=public.native_rx_uuid(p_request->'draft_id');ev:=public.native_rx_revision(p_request->'expected_version');perform public.native_rx_text(p_request->'signature_name',200);recon:=p_request->'reconciliation';
 perform public.native_rx_keys(recon,array['native_use_note','external_use_status','external_use_note','remaining_allowance_note','attest_review']);
 foreach k in array array['native_use_note','external_use_note','remaining_allowance_note'] loop perform public.native_rx_text(recon->k,2000);end loop;
 if ev is null or recon->'attest_review' is distinct from 'true'::jsonb or recon->>'external_use_status' is null or recon->>'external_use_status' not in ('unknown','reconciled') then raise exception 'Explicit replacement use reconciliation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||(p_request->>'authorization_id')::uuid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform 1 from public.native_prescription_drafts where id=di for update;
 preview:=public.preview_native_prescription_replacement((p_request->>'authorization_id')::uuid,(p_request->>'pet_id')::uuid,di,ev);
 perform public.native_rx_check_change_context(p_request,preview,true);
 if preview#>>'{context,prior,authorization,artifact,fulfillment_mode}'='external_pharmacy' and recon->>'external_use_status'<>'reconciled' then raise exception 'Unknown external fulfillment must be reconciled before replacement' using errcode='23514';end if;
 auth_doc:=public.native_rx_materialize_authorization(p_id,jsonb_build_object('draft_id',di,'pet_id',p_request->'pet_id','expected_version',ev,'expected_context_hash',preview#>>'{context,new_sign_context_hash}','signature_name',p_request->>'signature_name','attest_review',true));
 e:=public.native_rx_append_event(p_id,p_request,preview,p_id);
 if preview#>'{context,prior,prescriber}' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 return public.native_rx_finish(p_id,'replace',(p_request->>'pet_id')::uuid,p_request,jsonb_build_object('authorization',auth_doc,'event',e));
end $$;
create function public.list_native_prescription_events(p_authorization_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin
 perform public.clinical_require_staff();
 if p_authorization_id is null or p_pet_id is null or not exists(select 1 from public.native_prescription_authorizations where id=p_authorization_id and pet_id=p_pet_id) then raise exception 'Exact native authorization patient required' using errcode='23514';end if;
 if (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid authorization history cursor' using errcode='23514';end if;
 with bounded as materialized(select * from public.native_prescription_authorization_events where authorization_id=p_authorization_id and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1), selected as(select * from bounded order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('version',1,'authorization_id',p_authorization_id,'pet_id',p_pet_id,'events',(select coalesce(jsonb_agg(public.native_rx_event_projection(e) order by created_at desc,id desc),'[]') from selected e),'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when(select count(*)>p_limit from bounded) then(select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end) into r;return r;
end $$;
create function public.read_native_prescription_print(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb;s jsonb;begin perform public.clinical_require_staff();
 if p_dispense_id is not null then raise exception 'Native dispensing is not implemented' using errcode='23514';end if;
 d:=public.native_rx_verified_authorization(p_authorization_id);if d is null then raise exception 'Exact native authorization required' using errcode='23514';end if;
 s:=public.read_native_prescription_status(p_authorization_id,(d->>'pet_id')::uuid);
 return jsonb_build_object('prescription',d->'artifact','status',s->'status','dispense',null);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'native_rx_%' or proname in ('sign_native_prescription','read_native_prescription_status','preview_native_prescription_cancel','preview_native_prescription_replacement','cancel_native_prescription','replace_native_prescription','list_native_prescription_events','read_native_prescription_print')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname not like 'native_rx_%' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;
end $$;
