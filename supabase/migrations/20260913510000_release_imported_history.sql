-- Schema6 adds explicit outside narratives and unavoidable compact lineage for native findings.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in(1,2,3,4,5,6));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history'));
create function public.release_problem_has_import_provenance(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.ezyvet_problem_extractions where problem_id=p_id);
$$;
create function public.release_imported_history_refs(p_refs jsonb,p_selection jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(v||jsonb_build_object('narrative_included',coalesce(p_selection->'imported_history_ids','[]') @> jsonb_build_array(v->>'id')) order by v->>'id'),'[]') from jsonb_array_elements(p_refs) v;
$$;
create function public.release_preview_v6_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;ids jsonb;selected_id uuid;head record;histories jsonb:='[]';extractions jsonb:='[]';entry jsonb;review jsonb;reviews jsonb;all_ids uuid[];k text;older_count integer:=0;family_ids jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in ('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids'] loop
  family_ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(family_ids)<>'array' or jsonb_array_length(family_ids)>100 or exists(select 1 from jsonb_array_elements(family_ids) v where jsonb_typeof(v)<>'string') or(select count(*)<>count(distinct v::uuid) from jsonb_array_elements_text(family_ids) v) then raise exception 'Bounded unique source selections required' using errcode='23514';end if;
  older_count:=older_count+jsonb_array_length(family_ids);
 end loop;
 ids:=coalesce(p_selection->'imported_history_ids','[]');
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>100 or exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or(select count(*)<>count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Select at most100 distinct imported history versions' using errcode='23514';end if;
 perform 1 from public.pets where id=p_pet_id for share;
 -- Full narratives and compact provenance share the same source-lock and identity checks.
 select coalesce(array_agg(distinct history_id),'{}') into all_ids from(
  select v::uuid history_id from jsonb_array_elements_text(ids) v
  union all select h.history_id from public.ezyvet_problem_history_sources h join public.ezyvet_problem_extractions e on e.id=h.extraction_id where e.problem_id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'problem_ids','[]')) v)
  union all select (x->>'reviewed_history_id')::uuid from public.ezyvet_history_discrepancy_reviews r join public.ezyvet_problem_extractions e on e.id=r.extraction_id cross join lateral jsonb_array_elements(r.reviewed_sources) x where e.problem_id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'problem_ids','[]')) v)
 ) selected;
 for head in select distinct sh.source_origin,sh.source_site_uid,sh.resource,sh.external_id from public.ezyvet_imported_histories h join public.ezyvet_identity_heads sh on sh.source_origin=h.source_origin and sh.source_site_uid=h.source_site_uid and ((sh.resource='history' and sh.external_id=h.history_external_id) or(sh.resource='consult' and sh.external_id=h.original->>'consult_id')) where h.id=any(all_ids) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=head.source_origin and source_site_uid=head.source_site_uid and resource=head.resource and external_id=head.external_id for share;
 end loop;
 foreach selected_id in array all_ids loop
  if not exists(select 1 from public.ezyvet_imported_histories where ezyvet_imported_histories.id=selected_id and pet_id=p_pet_id) or public.ezyvet_history_identity_valid(selected_id) is distinct from true then raise exception 'Current patient/source identity required for historical disclosure' using errcode='23514';end if;
 end loop;
 if older_count=0 and jsonb_array_length(ids)>0 then
  -- Reuse original patient/recipient validation, with no implicitly selected clinical content.
  result:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,'{}');s:=result->'snapshot';
  foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries','lab_reports','external_records'] loop s:=s||jsonb_build_object(k,'[]'::jsonb);end loop;
 else result:=public.release_preview_v5_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection-'imported_history_ids');s:=result->'snapshot';end if;
 for selected_id in select v::uuid from jsonb_array_elements_text(ids) v order by v::uuid loop histories:=histories||jsonb_build_array(public.ezyvet_imported_history_projection(selected_id));end loop;
 for entry in select public.ezyvet_extraction_projection(e.id) from public.ezyvet_problem_extractions e where e.pet_id=p_pet_id and e.problem_id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'problem_ids','[]')) v) order by e.id loop
  reviews:='[]';for review in select value from jsonb_array_elements(entry#>'{discrepancy,review_history}') loop
   reviews:=reviews||jsonb_build_array(review||jsonb_build_object('sources',public.release_imported_history_refs(review->'sources',p_selection)));
  end loop;
  entry:=entry||jsonb_build_object('sources',public.release_imported_history_refs(entry->'sources',p_selection));entry:=jsonb_set(entry,'{discrepancy,review_history}',reviews);
  extractions:=extractions||jsonb_build_array(entry);
 end loop;
 s:=s||jsonb_build_object('schema_version',6,'selection',coalesce(s->'selection','{}')||jsonb_build_object('imported_history_ids',ids),'imported_histories',histories,'problem_source_extractions',extractions);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
end $$;
create function public.preview_record_release_v6(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_preview_v6_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;
do $$declare d text;needle text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=5 then';if strpos(d,needle)=0 then raise exception 'Expected schema5 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=6 then preview:=public.release_preview_v6_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=5 then');
 d:=replace(d,'p_reviewed_snapshot->>''schema_version''<>''5''','p_reviewed_snapshot->>''schema_version'' not in (''5'',''6'')');
 needle:='if preview->''snapshot'' is distinct from p_reviewed_snapshot';if strpos(d,needle)=0 then raise exception 'Expected exact confirmation comparison missing';end if;
 d:=replace(d,needle,'if p_reviewed_snapshot->>''schema_version''<>''6'' and exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->''problem_ids'',''[]'')) v where public.release_problem_has_import_provenance(v::uuid)) then raise exception ''Review imported problem lineage with release schema6'' using errcode=''23514'';end if; '||needle);
 needle:='''lab_report_ids'',''external_record_ids''] loop';if strpos(d,needle)=0 then raise exception 'Expected source registry loop missing';end if;
 d:=replace(d,needle,'''lab_report_ids'',''external_record_ids'',''imported_history_ids''] loop');
 d:=replace(d,'when ''external_record_ids'' then ''external_record'' else','when ''external_record_ids'' then ''external_record'' when ''imported_history_ids'' then ''imported_history'' else');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''5'' then';if strpos(d,needle)=0 then raise exception 'Expected schema5 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''6'' then current_preview:=public.release_preview_v6_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''5'' then');
 d:=replace(d,'r.snapshot->>''schema_version''<>''5''','r.snapshot->>''schema_version'' not in (''5'',''6'')');
 needle:='return jsonb_build_object(''release''';if strpos(d,needle)=0 then raise exception 'Expected release read envelope missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''<>''6'' and exists(select 1 from public.record_release_sources s where s.release_id=r.id and s.source_kind=''problem'' and public.release_problem_has_import_provenance(s.source_id)) then eligible:=false;why:=''Selected problem now requires imported source lineage review'';end if; '||needle);execute d;
 -- Existing independently verified original-byte membership applies to schema6 as well.
 select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname='verify_release_source_original_v5';
 if d is null or strpos(d,'is distinct from ''5''')=0 then raise exception 'Expected schema5 byte verification guard missing';end if;
 execute replace(d,'is distinct from ''5''','is distinct from ''5'' and p_snapshot->>''schema_version'' is distinct from ''6''');
end $$;
-- Inherited provenance retains immediate source-only events under the newer snapshots.
do $$declare name text;d text;needle text;replacement text;begin
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  if name='invalidate_release_source_provenance' then needle:='r.snapshot->>''schema_version''=''5''';replacement:='r.snapshot->>''schema_version'' in (''5'',''6'')';
  else needle:='r.snapshot->>''schema_version''=''4''';replacement:='r.snapshot->>''schema_version'' in (''4'',''5'',''6'')';end if;
  if d is null or strpos(d,needle)=0 then raise exception 'Expected inherited provenance event guard missing: %',name;end if;execute replace(d,needle,replacement);
 end loop;
end $$;
create function public.invalidate_imported_history_release() returns trigger language plpgsql security definer set search_path=public as $$
declare target_history uuid;target_extraction uuid;target_origin text;target_site text;target_resource text;target_external text;begin
 if TG_TABLE_NAME='ezyvet_identity_heads' then
  if NEW.resource not in ('history','consult') or row(NEW.snapshot_id,NEW.version) is not distinct from row(OLD.snapshot_id,OLD.version) then return NEW;end if;
  target_origin:=NEW.source_origin;target_site:=NEW.source_site_uid;target_resource:=NEW.resource;target_external:=NEW.external_id;
 elsif TG_TABLE_NAME='ezyvet_problem_history_sources' then target_extraction:=NEW.extraction_id;target_history:=NEW.history_id;
 elsif TG_TABLE_NAME='ezyvet_history_discrepancy_reviews' then target_extraction:=NEW.extraction_id;
 else target_history:=NEW.id;end if;
 -- Only append events: never acquire patient/gate/release UPDATE locks behind a source head.
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),r.id,'source_changed','Imported clinical source lineage changed; review a fresh package',auth.uid() from public.record_releases r where exists(
  select 1 from public.record_release_sources rs where rs.release_id=r.id and(
   (rs.source_kind='imported_history' and (rs.source_id=target_history or exists(select 1 from public.ezyvet_imported_histories h where h.id=rs.source_id and h.source_origin=target_origin and h.source_site_uid=target_site and ((target_resource='history' and h.history_external_id=target_external) or(target_resource='consult' and h.original->>'consult_id'=target_external)))))
   or(rs.source_kind='problem' and exists(select 1 from public.ezyvet_problem_extractions e left join public.ezyvet_problem_history_sources s on s.extraction_id=e.id left join public.ezyvet_imported_histories h on h.id=s.history_id where e.problem_id=rs.source_id and (e.id=target_extraction or h.id=target_history or(h.source_origin=target_origin and h.source_site_uid=target_site and ((target_resource='history' and h.history_external_id=target_external) or(target_resource='consult' and h.original->>'consult_id'=target_external))))))
  ));return NEW;
end $$;
create trigger release_imported_source_head after update on public.ezyvet_identity_heads for each row execute function public.invalidate_imported_history_release();
create trigger release_imported_history after insert on public.ezyvet_imported_histories for each row execute function public.invalidate_imported_history_release();
create trigger release_problem_imported_source after insert on public.ezyvet_problem_history_sources for each row execute function public.invalidate_imported_history_release();
create trigger release_imported_discrepancy after insert on public.ezyvet_history_discrepancy_reviews for each row execute function public.invalidate_imported_history_release();
create function public.list_record_release_sources_v6(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;rows jsonb;more boolean;begin
 perform public.clinical_require_staff();result:=public.list_record_release_sources_v5(p_pet_id,p_offset);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'recorded_at',approved_at,'label','Imported history '||history_external_id||' · version '||version,'source_label','ezyVet · '||source_site_uid) order by approved_at desc,id desc),'[]') into rows from(select * from public.ezyvet_imported_histories where pet_id=p_pet_id and public.ezyvet_history_identity_valid(id) order by approved_at desc,id desc offset p_offset limit 101) selected;
 more:=jsonb_array_length(rows)>100;if more then rows:=rows-100;end if;
 return result||jsonb_build_object('imported_history_ids',rows,'has_more',result->'has_more'||jsonb_build_object('imported_history_ids',more),'policy_v6_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=6));
end $$;
create function public.select_all_record_release_sources_v6(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;ids jsonb;begin
 perform public.clinical_require_staff();result:=public.select_all_record_release_sources_v5(p_pet_id);
 select coalesce(jsonb_agg(id order by id),'[]') into ids from public.ezyvet_imported_histories where pet_id=p_pet_id and public.ezyvet_history_identity_valid(id);
 if jsonb_array_length(ids)>100 then raise exception 'More than100 imported histories; split into explicit packages' using errcode='23514';end if;
 return result||jsonb_build_object('selection',result->'selection'||jsonb_build_object('imported_history_ids',ids));
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('release_problem_has_import_provenance','release_imported_history_refs','release_preview_v6_internal','preview_record_release_v6','invalidate_imported_history_release','list_record_release_sources_v6','select_all_record_release_sources_v6') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('preview_record_release_v6','list_record_release_sources_v6','select_all_record_release_sources_v6') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
