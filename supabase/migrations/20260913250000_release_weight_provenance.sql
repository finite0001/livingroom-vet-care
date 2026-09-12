-- Version 4 adds explicitly reviewed historical weight provenance; no policy acceptance is seeded.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in (1,2,3,4));
alter function public.release_preview_internal(uuid,uuid,text,text,jsonb) rename to release_preview_v3_internal;

create function public.release_preview_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;weights jsonb:='[]';w jsonb;provenance jsonb;
begin
 result:=public.release_preview_v3_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 if jsonb_array_length(coalesce(p_selection->'weight_ids','[]'))=0 then return result;end if;
 for w in select value from jsonb_array_elements(result#>'{snapshot,weights}') loop
  -- Shared locks remain held through confirmation or the provider preflight transaction.
  perform 1 from public.patient_weights where id=(w->>'id')::uuid for share;
  select coalesce(jsonb_agg(jsonb_build_object(
   'approval_id',a.request_id,'source','ezyVet','source_record_id',a.external_id,
   'action',a.action,'latest_source_version',h.version,'approved_source_version',a.head_version,'latest_source_reviewed',h.snapshot_id=a.snapshot_id or exists(select 1 from public.ezyvet_weight_source_reviews sr where sr.approval_id=a.request_id and sr.snapshot_id=h.snapshot_id),'original',jsonb_build_object('weight',s.payload->>'weight','unit',s.payload->>'weight_unit','timestamp',s.payload->>'timestamp'),
   'reviewed_values',a.reviewed_values,'review_reason',a.reason,'reviewer_id',a.approved_by,'reviewed_at',a.created_at,
   'source_clinician',null,'source_reviews',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.request_id,'source_version',r.head_version,'reviewer_id',r.reviewed_by,'reviewed_at',r.created_at,'reason',r.reason,
    'source',jsonb_build_object('weight',rs.payload->>'weight','unit',rs.payload->>'weight_unit','timestamp',rs.payload->>'timestamp','active',rs.payload->>'active')) order by r.created_at,r.request_id)
    from public.ezyvet_weight_source_reviews r join public.ezyvet_import_snapshots rs on rs.id=r.snapshot_id where r.approval_id=a.request_id),'[]'::jsonb)) order by a.created_at,a.request_id),'[]'::jsonb)
  into provenance from public.ezyvet_weight_approvals a join public.ezyvet_import_snapshots s on s.id=a.snapshot_id join public.ezyvet_identity_heads h on h.source_origin=a.source_origin and h.source_site_uid=a.source_site_uid and h.resource='healthstatus' and h.external_id=a.external_id
  where a.weight_id=(w->>'id')::uuid and a.pet_id=p_pet_id;
  weights:=weights||jsonb_build_array(w||jsonb_build_object('import_provenance',provenance));
 end loop;
 s:=(result->'snapshot')||jsonb_build_object('schema_version',4,'weights',weights);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds the reviewed snapshot limit; split into smaller packages' using errcode='23514';end if;
 return jsonb_build_object('snapshot',s,'source_hash',encode(digest(s::text,'sha256'),'hex'));
end $$;
-- The old preview keeps its exact shape. An old UI cannot attest to undisplayed provenance.
create or replace function public.preview_record_release(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_preview_v3_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;
create function public.preview_record_release_v4(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_preview_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;

-- Preserve exact old-package comparison, while v4 comparison includes the frozen ledger.
do $$declare definition text;begin
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into definition;
 if position('else current_preview:=public.release_preview_internal(' in definition)=0 then raise exception 'Release read definition drifted; v4 migration requires review';end if;
 definition:=replace(definition,'else current_preview:=public.release_preview_internal(', 'elsif r.snapshot->>''schema_version''=''3'' then current_preview:=public.release_preview_v3_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); else current_preview:=public.release_preview_internal(');
 execute definition;
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into definition;
 if position('preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);' in definition)=0 then raise exception 'Release confirmation definition drifted; v4 migration requires review';end if;
 definition:=replace(definition,'preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);',
 'if (p_reviewed_snapshot->>''schema_version'')::integer=4 then preview:=public.release_preview_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 else
  preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
  if exists(select 1 from public.ezyvet_weight_approvals where pet_id=p_pet_id and weight_id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->''weight_ids'',''[]'')) v)) then raise exception ''Preview and review weight provenance with release form version 4'' using errcode=''23514'';end if;
 end if;');
 execute definition;
end $$;

-- Ledger appends serialize on the same native weight row; only v4 packages are invalidated.
create function public.release_weight_provenance_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 if TG_TABLE_NAME='ezyvet_weight_approvals' then target:=NEW.weight_id;else select weight_id into strict target from public.ezyvet_weight_approvals where request_id=NEW.approval_id;end if;
 perform 1 from public.patient_weights where id=target for update;
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),s.release_id,'source_changed','Reviewed weight source provenance changed; prepare a fresh package',auth.uid()
 from public.record_release_sources s join public.record_releases r on r.id=s.release_id
 where s.source_kind='weight' and s.source_id=target and r.snapshot->>'schema_version'='4';
 return NEW;
end $$;
create trigger aaa_release_weight_provenance before insert on public.ezyvet_weight_approvals for each row execute function public.release_weight_provenance_changed();
create trigger aaa_release_weight_review before insert on public.ezyvet_weight_source_reviews for each row execute function public.release_weight_provenance_changed();
revoke all on function public.release_preview_v3_internal(uuid,uuid,text,text,jsonb),public.release_preview_internal(uuid,uuid,text,text,jsonb),public.release_weight_provenance_changed(),public.preview_record_release_v4(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_record_release_v4(uuid,uuid,text,text,jsonb) to authenticated;

create function public.release_weight_source_head_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 if NEW.resource<>'healthstatus' or NEW.snapshot_id=OLD.snapshot_id then return NEW;end if;
 for target in select distinct weight_id from public.ezyvet_weight_approvals where source_origin=NEW.source_origin and source_site_uid=NEW.source_site_uid and external_id=NEW.external_id order by weight_id loop
  perform 1 from public.patient_weights where id=target for update;
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),s.release_id,'source_changed','External weight source changed; review provenance in a fresh package',auth.uid()
  from public.record_release_sources s join public.record_releases r on r.id=s.release_id
  where s.source_kind='weight' and s.source_id=target and r.snapshot->>'schema_version'='4';
 end loop;
 return NEW;
end $$;
create trigger aaa_release_weight_source_head before update on public.ezyvet_identity_heads for each row execute function public.release_weight_source_head_changed();
revoke all on function public.release_weight_source_head_changed() from public,anon,authenticated,service_role;
-- Expose an independent v4 gate without changing legacy policy_accepted semantics.
do $$declare definition text;begin
 select pg_get_functiondef('public.list_record_release_sources(uuid,integer)'::regprocedure) into definition;
 if position('return r;' in definition)=0 then raise exception 'Release source-list definition drifted; v4 migration requires review';end if;
 definition:=replace(definition,'return r;', 'return r||jsonb_build_object(''policy_v4_accepted'',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=4));');
 execute definition;
end $$;
