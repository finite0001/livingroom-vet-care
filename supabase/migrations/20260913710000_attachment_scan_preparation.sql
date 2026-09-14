-- Persist owned scan identity before any provider request or worker lease.
create function public.prepare_ezyvet_attachment_scan(p_id uuid,p_animal_link_id uuid,p_parent_type text,p_parent_snapshot_id uuid,p_parent_payload_hash text,p_parent_observed_head_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();m public.ezyvet_record_links;c public.ezyvet_attachment_runs;r public.ezyvet_import_runs;context jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_parent_type is null or p_parent_type not in ('Animal','Consult') or p_parent_snapshot_id is null or p_parent_payload_hash is null or p_parent_observed_head_version is null or p_parent_observed_head_version<1 then raise exception 'Exact attachment scan identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null then
  if row(c.actor_id,c.animal_link_id,r.requested_by,r.resource,c.parent_context->>'parent_type',c.parent_context->>'parent_snapshot_id',c.parent_context->>'parent_payload_hash',c.parent_context->>'parent_observed_head_version') is distinct from row(actor,p_animal_link_id,actor,'attachment'::text,p_parent_type,p_parent_snapshot_id::text,p_parent_payload_hash,p_parent_observed_head_version::text) then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
  -- Exact retries recover historical identity, without revalidating mutable heads.
  return public.ezyvet_attachment_run_projection(p_id);
 end if;
 if r.id is not null then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal';
 if not found then raise exception 'Reviewed patient mapping required' using errcode='42501';end if;
 context:=public.ezyvet_attachment_parent_context(m.id,m.source_origin,m.source_site_uid,p_parent_type,p_parent_snapshot_id,p_parent_payload_hash,p_parent_observed_head_version);
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by) values(p_id,m.source_origin,m.source_site_uid,'attachment',actor);
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,actor,m.id,(context->>'pet_id')::uuid,context);
 return public.ezyvet_attachment_run_projection(p_id);
end $$;
revoke all on function public.prepare_ezyvet_attachment_scan(uuid,uuid,text,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.prepare_ezyvet_attachment_scan(uuid,uuid,text,uuid,text,integer) to authenticated;
