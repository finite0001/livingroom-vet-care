-- Reconciliation-aware clinical copies; original immutable artifacts remain unchanged.
create function public.native_reconciliation_authorization_affected(a uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.native_return_events where authorization_id=a and document->>'version'='2') or (public.native_reconciliation_summary(a)->>'discrepancy_event_count')::integer>0;
$$;
create function public.native_reconciliation_release_affected(s jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
declare a uuid;begin
 for a in select (x->>'id')::uuid from jsonb_array_elements(s->'native_prescriptions') x union select (x#>>'{prescription,id}')::uuid from jsonb_array_elements(s->'native_dispenses') x loop
  if public.native_reconciliation_authorization_affected(a) then return true;end if;
 end loop;return false;end $$;
create function public.read_native_prescription_print_v4(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;summary jsonb;disclosure jsonb;begin
 perform public.clinical_require_staff();r:=public.native_return_print_base(p_authorization_id,p_dispense_id);
 summary:=public.native_reconciliation_summary(p_authorization_id);
 if p_dispense_id is not null then disclosure:=public.native_reconciliation_disclosure(p_authorization_id,(r#>>'{prescription,patient,id}')::uuid,p_dispense_id);end if;
 r:=jsonb_set(r,'{status,checked_at}',to_jsonb(clock_timestamp()));perform public.clinical_require_staff();
 return r||jsonb_build_object('version',4,'return_summary',summary,'dispense_returns',disclosure);end $$;
-- Guard old current copies, but do not alter their saved historical documents.
do $$declare d text;needle text;fname text;begin
 foreach fname in array array['read_native_prescription_print','read_native_prescription_print_v2','read_native_prescription_print_v3'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=fname;
  needle:='r:=public.native_return_print_base(p_authorization_id,p_dispense_id);';
  if fname='read_native_prescription_print' then needle:='perform public.clinical_require_staff();return r;';end if;
  if position(needle in d)=0 then raise exception 'Expected print gate missing: %',fname;end if;
  if fname='read_native_prescription_print' then execute replace(d,needle,'if public.native_reconciliation_authorization_affected(p_authorization_id) then raise exception ''Reconciliation history requires version4 print'' using errcode=''23514'';end if;'||needle);else execute replace(d,needle,needle||' if public.native_reconciliation_authorization_affected(p_authorization_id) then raise exception ''Reconciliation history requires version4 print'' using errcode=''23514'';end if;');end if;
 end loop;
 foreach fname in array array['release_preview_v10_internal','release_preview_v11_internal','release_preview_v12_internal'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=fname;
  if fname='release_preview_v12_internal' then needle:='s:=r->''snapshot'';';else needle:='if auth.role() is distinct from ''service_role'' then perform public.clinical_require_staff();end if;return r;';end if;
  if position(needle in d)=0 then raise exception 'Expected release gate missing: %',fname;end if;
  execute replace(d,needle,'if public.native_reconciliation_release_affected(r->''snapshot'') then raise exception ''Reconciliation history requires release schema13'' using errcode=''23514'';end if;'||needle);
 end loop;
end $$;
create function public.release_preview_v13_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;s jsonb;p jsonb;d jsonb;ps jsonb:='[]';ds jsonb:='[]';begin
 r:=public.native_return_release_base(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);s:=r->'snapshot';
 for p in select value from jsonb_array_elements(s->'native_prescriptions') loop ps:=ps||jsonb_build_array(p||jsonb_build_object('returns',public.native_reconciliation_summary((p->>'id')::uuid)));end loop;
 for d in select value from jsonb_array_elements(s->'native_dispenses') loop p:=d->'prescription';p:=p||jsonb_build_object('returns',public.native_reconciliation_summary((p->>'id')::uuid));ds:=ds||jsonb_build_array(d||jsonb_build_object('prescription',p,'returns',public.native_reconciliation_disclosure((p->>'id')::uuid,p_pet_id,(d->>'id')::uuid)));end loop;
 s:=s||jsonb_build_object('schema_version',13,'native_prescriptions',ps,'native_dispenses',ds);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;return jsonb_build_object('snapshot',s,'source_hash',public.native_fulfillment_hash(s));end $$;
create function public.preview_record_release_v13(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;begin perform public.clinical_require_staff();r:=public.release_preview_v13_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);perform public.clinical_require_staff();return r;end $$;
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add constraint record_release_policy_accepted_schema_version_check check(accepted_schema_version in(1,2,3,4,5,6,7,8,9,10,11,12,13));
do $$declare d text;needle text;name text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=12 then';if position(needle in d)=0 then raise exception 'Expected schema12 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=13 then preview:=public.release_preview_v13_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=12 then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12'')','(''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12'',''13'')');d:=replace(d,'(''6'',''7'',''8'',''9'',''10'',''11'',''12'')','(''6'',''7'',''8'',''9'',''10'',''11'',''12'',''13'')');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''12'' then';if position(needle in d)=0 then raise exception 'Expected schema12 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''13'' then current_preview:=public.release_preview_v13_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''12'' then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12'')','(''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12'',''13'')');d:=replace(d,'(''6'',''7'',''8'',''9'',''10'',''11'',''12'')','(''6'',''7'',''8'',''9'',''10'',''11'',''12'',''13'')');execute d;
 select pg_get_functiondef('public.verify_release_source_original_v5(jsonb,jsonb,bytea)'::regprocedure) into d;needle:='p_snapshot->>''schema_version'' is distinct from ''12''';if position(needle in d)=0 then raise exception 'Expected schema12 original byte boundary missing';end if;execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''13''');
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed','invalidate_native_record_release','invalidate_native_correction_release'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  needle:='''10'',''11'',''12'')';if d is null or position(needle in d)=0 then raise exception 'Expected schema12 invalidation missing: %',name;end if;execute replace(d,needle,'''10'',''11'',''12'',''13'')');
 end loop;
end $$;
create function public.list_record_release_sources_v13(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$declare r jsonb;begin perform public.clinical_require_staff();r:=public.list_record_release_sources_v12(p_pet_id,p_offset);perform public.clinical_require_staff();return r||jsonb_build_object('policy_v13_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=13));end $$;
create function public.select_all_record_release_sources_v13(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;begin perform public.clinical_require_staff();r:=public.select_all_record_release_sources_v12(p_pet_id);perform public.clinical_require_staff();return r||jsonb_build_object('scope',coalesce(r->>'scope','')||'; schema13 native return reconciliation disclosure');end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('native_reconciliation_release_affected','native_reconciliation_authorization_affected','read_native_prescription_print_v4','release_preview_v13_internal','preview_record_release_v13','list_record_release_sources_v13','select_all_record_release_sources_v13') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in('read_native_prescription_print_v4','preview_record_release_v13','list_record_release_sources_v13','select_all_record_release_sources_v13') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
