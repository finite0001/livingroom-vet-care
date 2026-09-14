-- Active-staff chart access is limited to explicitly reviewed API source records.
create function public.read_ezyvet_attachment_chart(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();items jsonb;more boolean;lastrow jsonb;
begin
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Patient and exact history cursor required' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('record',to_jsonb(v)-'source_context'||jsonb_build_object('source_context',v.source_context-'attachment_metadata'),
  'is_latest',not exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version),
  'source_current',exists(select 1 from public.ezyvet_record_links m join public.pets p on p.id=m.pet_id
   join public.ezyvet_identity_heads a on a.source_origin=m.source_origin and a.source_site_uid=m.source_site_uid and a.resource='attachment' and a.external_id=v.attachment_external_id
   join public.ezyvet_identity_heads parent on parent.source_origin=m.source_origin and parent.source_site_uid=m.source_site_uid and parent.resource=case when v.source_context->'parent'->>'parent_type'='Animal' then 'animal' else 'consult' end and parent.external_id=v.source_context->'parent'->>'parent_external_id'
   where m.id=v.animal_link_id and m.resource='animal' and m.pet_id=v.pet_id and m.client_id=p.client_id and p.client_id=(v.source_context->'parent'->>'client_id')::uuid
    and m.source_origin=v.source_origin and m.source_site_uid=v.source_site_uid and m.external_id=v.source_context->'parent'->>'animal_external_id'
    and a.snapshot_id=(v.source_context->>'attachment_snapshot_id')::uuid and a.version=(v.source_context->>'attachment_observed_head_version')::integer
    and parent.snapshot_id=(v.source_context->'parent'->>'parent_snapshot_id')::uuid and parent.version=(v.source_context->'parent'->>'parent_observed_head_version')::integer)) order by v.created_at desc,v.id desc),'[]') into items
 from(select * from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) v;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1)->'record';
 return jsonb_build_object('pet_id',p_pet_id,'records',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
create function public.get_ezyvet_attachment_chart_original(p_record_id uuid,p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();v public.ezyvet_attachment_record_versions;c public.ezyvet_attachment_captures;
begin
 select * into v from public.ezyvet_attachment_record_versions where id=p_record_id and pet_id=p_pet_id;
 if not found then raise exception 'Reviewed patient attachment required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_captures where request_id=v.request_id and pet_id=v.pet_id and capture_hash=v.capture_hash;
 if not found then raise exception 'Captured original unavailable' using errcode='40001';end if;
 return jsonb_build_object('record',to_jsonb(v)-'source_context'||jsonb_build_object('source_context',v.source_context-'attachment_metadata'),'capture',to_jsonb(c)-'lease_id');
end $$;
create function public.ezyvet_reviewed_attachment_storage_read(p_path text) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_active_staff(auth.uid()) and exists(select 1 from public.ezyvet_attachment_record_versions v join public.ezyvet_attachment_captures c on c.request_id=v.request_id and c.pet_id=v.pet_id and c.capture_hash=v.capture_hash where c.object_path=p_path and c.bucket='ezyvet-attachments');
$$;
revoke all on function public.read_ezyvet_attachment_chart(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_ezyvet_attachment_chart_original(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ezyvet_reviewed_attachment_storage_read(text) from public,anon,authenticated,service_role;
grant execute on function public.read_ezyvet_attachment_chart(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_ezyvet_attachment_chart_original(uuid,uuid) to authenticated;
grant execute on function public.ezyvet_reviewed_attachment_storage_read(text) to authenticated;
create policy "Read staff-reviewed API attachment originals" on storage.objects for select to authenticated using(bucket_id='ezyvet-attachments' and public.ezyvet_reviewed_attachment_storage_read(name));
