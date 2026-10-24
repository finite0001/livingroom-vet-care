-- Schema9 adds an explicit API original family. Existing snapshots are immutable.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in(1,2,3,4,5,6,7,8,9));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history','imported_vaccination','imported_prescription','api_attachment'));

-- Private composition is shared by authenticated wrappers and actor-authorized workers.
-- Keep direct EXECUTE revoked; authenticated calls still recheck staff after locks.
do $$declare signature text;definition text;expected integer;
begin
 foreach signature in array array['public.ezyvet_validate_release_attachments(uuid,jsonb)','public.release_preview_v9_internal(uuid,uuid,text,text,jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  expected:=case when signature like '%validate%' then 3 else 2 end;
  if (length(definition)-length(replace(definition,'perform public.clinical_require_staff();','')))/length('perform public.clinical_require_staff();')<>expected then raise exception 'Expected private staff boundaries missing: %',signature;end if;
  execute replace(definition,'perform public.clinical_require_staff();','if auth.role() is distinct from ''service_role'' then perform public.clinical_require_staff();end if;');
 end loop;
end $$;

create function public.preview_record_release_v9(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin perform public.clinical_require_staff();result:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);perform public.clinical_require_staff();return result;end $$;

do $$declare d text;needle text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=8 then';if strpos(d,needle)=0 then raise exception 'Expected schema8 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=9 then preview:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=8 then');
 d:=replace(d,'p_reviewed_snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'')','p_reviewed_snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'',''9'')');
 d:=replace(d,'p_reviewed_snapshot->>''schema_version'' not in (''6'',''7'',''8'')','p_reviewed_snapshot->>''schema_version'' not in (''6'',''7'',''8'',''9'')');
 needle:='''imported_vaccination_ids'',''imported_prescription_ids''] loop';if strpos(d,needle)=0 then raise exception 'Expected schema8 source registry missing';end if;
 d:=replace(d,needle,'''imported_vaccination_ids'',''imported_prescription_ids'',''api_attachment_ids''] loop');
 d:=replace(d,'when ''imported_prescription_ids'' then ''imported_prescription'' else','when ''imported_prescription_ids'' then ''imported_prescription'' when ''api_attachment_ids'' then ''api_attachment'' else');
 needle:='insert into public.record_releases(';if strpos(d,needle)=0 then raise exception 'Expected release insertion missing';end if;
 d:=replace(d,needle,'perform public.clinical_require_staff(); '||needle);execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''8'' then';if strpos(d,needle)=0 then raise exception 'Expected schema8 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''9'' then current_preview:=public.release_preview_v9_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''8'' then');
 d:=replace(d,'r.snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'')','r.snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'',''9'')');
 d:=replace(d,'r.snapshot->>''schema_version'' not in (''6'',''7'',''8'')','r.snapshot->>''schema_version'' not in (''6'',''7'',''8'',''9'')');
 needle:='exception when sqlstate ''23514'' or sqlstate ''42501'' then';if strpos(d,needle)=0 then raise exception 'Expected current-source recovery exception boundary missing';end if;
 d:=replace(d,needle,'exception when sqlstate ''23514'' or sqlstate ''42501'' or sqlstate ''40001'' then');execute d;
end $$;
do $$declare name text;d text;needle text;replacement text;begin
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  if name='invalidate_release_source_provenance' then needle:='in (''5'',''6'',''7'',''8'')';replacement:='in (''5'',''6'',''7'',''8'',''9'')';else needle:='in (''4'',''5'',''6'',''7'',''8'')';replacement:='in (''4'',''5'',''6'',''7'',''8'',''9'')';end if;
  if d is null or strpos(d,needle)=0 then raise exception 'Expected inherited provenance event guard missing: %',name;end if;execute replace(d,needle,replacement);
 end loop;
end $$;

create function public.invalidate_api_attachment_release() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_NAME='ezyvet_identity_heads' then
  if NEW.resource not in('animal','attachment') or row(NEW.snapshot_id,NEW.version) is not distinct from row(OLD.snapshot_id,OLD.version) then return NEW;end if;
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed API attachment source changed; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_attachment_record_versions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='api_attachment' and v.source_origin=NEW.source_origin and v.source_site_uid=NEW.source_site_uid and ((NEW.resource='attachment' and v.attachment_external_id=NEW.external_id) or (NEW.resource='animal' and v.source_context#>>'{parent,parent_type}'='Animal' and v.source_context#>>'{parent,parent_external_id}'=NEW.external_id)));
 elsif TG_TABLE_NAME='ezyvet_record_links' then
  if row(NEW.source_origin,NEW.source_site_uid,NEW.resource,NEW.external_id,NEW.pet_id,NEW.client_id) is not distinct from row(OLD.source_origin,OLD.source_site_uid,OLD.resource,OLD.external_id,OLD.pet_id,OLD.client_id) then return NEW;end if;
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed API attachment mapping changed; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_attachment_record_versions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='api_attachment' and v.animal_link_id=NEW.id);
 else
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed API attachment superseded; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_attachment_record_versions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='api_attachment' and v.animal_link_id=NEW.animal_link_id and v.attachment_external_id=NEW.attachment_external_id);
 end if;
 return NEW;
end $$;
create trigger release_api_attachment_source after update on public.ezyvet_identity_heads for each row execute function public.invalidate_api_attachment_release();
create trigger release_api_attachment_mapping after update on public.ezyvet_record_links for each row execute function public.invalidate_api_attachment_release();
create trigger release_api_attachment_approval after insert on public.ezyvet_attachment_record_versions for each row execute function public.invalidate_api_attachment_release();
-- A retained receipt is immutable, but access to it still requires current staff
-- authority after waiting. Preserve exact request replay and old snapshot contracts.
do $$declare definition text;needle text;
begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into definition;
 needle:='perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));';
 if strpos(definition,needle)=0 then raise exception 'Expected release operation lock missing';end if;
 definition:=replace(definition,needle,needle||' perform public.clinical_require_staff();');
 if strpos(definition,'return result;')=0 then raise exception 'Expected release receipt return missing';end if;
 definition:=replace(definition,'return result;','perform public.clinical_require_staff(); return result;');
 execute definition;
end $$;
comment on function public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean) is 'Rechecks active staff after operation waits and before returning.';
create or replace function public.read_record_release(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 result:=public.release_read_internal(p_id);
 perform public.clinical_require_staff();
 return result;
end $$;
comment on function public.read_record_release(uuid) is 'Rechecks active staff after release/source waits.';

-- Worker contexts must recheck the stored actor after source/Storage lock waits.
do $$declare definition text;needle text;
begin
 select pg_get_functiondef('public.release_email_context(uuid)'::regprocedure) into definition;
 needle:='return b;';
 if strpos(definition,needle)=0 then raise exception 'Expected email context return missing';end if;
 execute replace(definition,needle,'if not public.is_active_staff(r.actor_id) then raise exception ''Release email actor is unavailable'' using errcode=''42501'';end if; '||needle);
 select pg_get_functiondef('public.document_link_current(uuid)'::regprocedure) into definition;
 needle:='return s;';
 if strpos(definition,needle)=0 then raise exception 'Expected document link context return missing';end if;
 execute replace(definition,needle,'if g.expires_at<=clock_timestamp() or not public.is_active_staff(g.actor_id) then raise exception ''Document link unavailable'' using errcode=''42501'';end if; '||needle);
end $$;
revoke all on function public.preview_record_release_v9(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_record_release_v9(uuid,uuid,text,text,jsonb) to authenticated;
revoke all on function public.invalidate_api_attachment_release() from public,anon,authenticated,service_role;
-- No policy row is enabled or accepted by this migration.
