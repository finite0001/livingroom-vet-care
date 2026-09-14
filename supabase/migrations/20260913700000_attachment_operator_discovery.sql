-- Bounded operator discovery. Historical observations remain visible after source
-- changes; fresh prepare/capture RPCs remain the authority for action eligibility.
create function public.get_ezyvet_attachment_animal_parent(p_animal_link_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal';
 if not found then raise exception 'Reviewed patient mapping required' using errcode='42501';end if;
 select * into h from public.ezyvet_identity_heads where source_origin=m.source_origin and source_site_uid=m.source_site_uid and resource='animal' and external_id=m.external_id;
 if not found then return null;end if;
 select * into s from public.ezyvet_import_snapshots where id=h.snapshot_id;
 return public.ezyvet_attachment_parent_context(m.id,m.source_origin,m.source_site_uid,'Animal',s.id,s.payload_hash,h.version);
end $$;

create function public.list_ezyvet_attachment_observations(p_run_id uuid,p_pet_id uuid,p_after_page integer default null,p_after_snapshot_id uuid default null,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_runs;items jsonb;more boolean;lastrow jsonb;parent_current boolean;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_run_id is null or p_pet_id is null or p_limit is null or p_limit not between 1 and 10
  or (p_after_page is null)<>(p_after_snapshot_id is null) or (p_after_page is not null and p_after_page not between 1 and 1000) then raise exception 'Invalid attachment observation cursor' using errcode='23514';end if;
 select * into r from public.ezyvet_attachment_runs where run_id=p_run_id;
 if r.run_id is null or row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Attachment observation identity mismatch' using errcode='42501';end if;
 select exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=r.parent_context->>'source_origin' and h.source_site_uid=r.parent_context->>'source_site_uid'
  and h.resource=case r.parent_context->>'parent_type' when 'Animal' then 'animal' else 'consult' end
  and h.external_id=r.parent_context->>'parent_external_id' and h.snapshot_id=(r.parent_context->>'parent_snapshot_id')::uuid and h.version=(r.parent_context->>'parent_observed_head_version')::integer)
  and exists(select 1 from public.pets where id=r.pet_id and client_id=(r.parent_context->>'client_id')::uuid) into parent_current;
 select coalesce(jsonb_agg(jsonb_build_object(
  'run_id',p_run_id,'pet_id',r.pet_id,'page',page,'snapshot_id',id,'payload_hash',payload_hash,'observed_head_version',head_version,
  'external_id',external_id,'current_snapshot_id',current_snapshot_id,'current_head_version',current_head_version,
  'is_current',coalesce(current_snapshot_id=id and current_head_version=head_version,false),
  'metadata',jsonb_build_object('name',left(payload->>'name',400),'mime_type',left(payload->>'mime_type',200),'file_id',left(payload->>'file_id',200),
   'notes',left(payload->>'notes',4000),'notes_truncated',coalesce(length(payload->>'notes')>4000,false),'name_truncated',coalesce(length(payload->>'name')>400,false))
 ) order by page,id),'[]') into items
 from(select o.page,o.head_version,s.id,s.payload_hash,s.external_id,s.payload,h.snapshot_id current_snapshot_id,h.version current_head_version
  from public.ezyvet_attachment_page_observations o join public.ezyvet_import_snapshots s on s.id=o.snapshot_id
  left join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource='attachment' and h.external_id=s.external_id
  where o.run_id=p_run_id and (p_after_page is null or (o.page,s.id)>(p_after_page,p_after_snapshot_id)) order by o.page,s.id limit p_limit+1) selected;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('run_id',p_run_id,'pet_id',r.pet_id,'parent_context',r.parent_context,'parent_is_current',parent_current,'observations',items,
  'has_more',more,'next_cursor',case when more then jsonb_build_object('after_page',lastrow->'page','after_snapshot_id',lastrow->'snapshot_id') else null end);
end $$;

create function public.list_ezyvet_attachment_cleanups(p_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;items jsonb;more boolean;lastrow jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid attachment cleanup cursor' using errcode='23514';end if;
 select * into r from public.ezyvet_attachment_download_requests where id=p_id;
 if r.id is null or row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Cleanup identity mismatch' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('attempt',to_jsonb(selected)-'receipt'-'lease_id','receipt',receipt,
  'lease_active',receipt is null and lease_until>now()) order by created_at desc,id desc),'[]') into items
 from(select a.*,to_jsonb(c) receipt from public.ezyvet_attachment_cleanup_attempts a left join public.ezyvet_attachment_cleanup_receipts c on c.cleanup_id=a.id
  where a.request_id=p_id and a.actor_id=actor and (p_before_at is null or (a.created_at,a.id)<(p_before_at,p_before_id)) order by a.created_at desc,a.id desc limit p_limit+1) selected;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1)->'attempt';
 return jsonb_build_object('request_id',p_id,'pet_id',p_pet_id,'cleanups',items,'has_more',more,
  'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('get_ezyvet_attachment_animal_parent','list_ezyvet_attachment_observations','list_ezyvet_attachment_cleanups') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
