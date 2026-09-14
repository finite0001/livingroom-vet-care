-- Read-only discovery; locked schema9 preview remains authoritative for selection.
create function public.ezyvet_release_attachment_current(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.ezyvet_attachment_record_versions v
 join public.ezyvet_record_links m on m.id=v.animal_link_id and m.resource='animal' and m.pet_id=v.pet_id and m.source_origin=v.source_origin and m.source_site_uid=v.source_site_uid
 join public.pets p on p.id=v.pet_id and p.client_id=m.client_id
 join public.ezyvet_attachment_captures c on c.request_id=v.request_id and c.actor_id=v.actor_id and c.pet_id=v.pet_id and c.capture_hash=v.capture_hash
 join storage.objects o on o.id=c.storage_object_id and o.bucket_id=c.bucket and o.name=c.object_path and o.metadata->>'size'=c.file_size::text and o.metadata->>'mimetype'=c.mime_type
 join public.ezyvet_identity_heads a on a.source_origin=v.source_origin and a.source_site_uid=v.source_site_uid and a.resource='attachment' and a.external_id=v.attachment_external_id
 join public.ezyvet_identity_heads parent on parent.source_origin=v.source_origin and parent.source_site_uid=v.source_site_uid and parent.resource=case v.source_context#>>'{parent,parent_type}' when 'Animal' then 'animal' else 'consult' end and parent.external_id=v.source_context#>>'{parent,parent_external_id}'
 where v.id=p_id and p.client_id=(v.source_context#>>'{parent,client_id}')::uuid and m.external_id=v.source_context#>>'{parent,animal_external_id}'
 and a.snapshot_id=(v.source_context->>'attachment_snapshot_id')::uuid and a.version=(v.source_context->>'attachment_observed_head_version')::integer
 and parent.snapshot_id=(v.source_context#>>'{parent,parent_snapshot_id}')::uuid and parent.version=(v.source_context#>>'{parent,parent_observed_head_version}')::integer
 and not exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version));
$$;
create function public.list_record_release_sources_v9(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;rows jsonb;more boolean;
begin
 perform public.clinical_require_staff();result:=public.list_record_release_sources_v8(p_pet_id,p_offset);
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'recorded_at',v.created_at,'label',v.title||' · API approval version '||v.version,'source_label','ezyVet · '||v.source_site_uid||' · '||(v.source_context#>>'{parent,parent_type}')||' '||(v.source_context#>>'{parent,parent_external_id}'),'record_hash',v.record_hash,'capture_hash',v.capture_hash,'mime_type',c.mime_type,'file_size',c.file_size) order by v.created_at desc,v.id desc),'[]') into rows
 from(select * from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and public.ezyvet_release_attachment_current(id) order by created_at desc,id desc offset p_offset limit 101) v join public.ezyvet_attachment_captures c on c.request_id=v.request_id;
 more:=jsonb_array_length(rows)>100;if more then rows:=rows-100;end if;
 return result||jsonb_build_object('api_attachment_ids',rows,'has_more',result->'has_more'||jsonb_build_object('api_attachment_ids',more),'policy_v9_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=9));
end $$;
create function public.select_all_record_release_sources_v9(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;ids jsonb;
begin
 perform public.clinical_require_staff();result:=public.select_all_record_release_sources_v8(p_pet_id);
 select coalesce(jsonb_agg(id order by id),'[]') into ids from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and public.ezyvet_release_attachment_current(id);
 if jsonb_array_length(ids)>20 then raise exception 'More than20 reviewed API originals; split into explicit packages' using errcode='23514';end if;
 if jsonb_array_length(coalesce(result#>'{selection,document_ids}','[]'))+jsonb_array_length(ids)>24 then raise exception 'More than24 originals; split into explicit packages' using errcode='23514';end if;
 perform public.clinical_require_staff();
 return result||jsonb_build_object('selection',result->'selection'||jsonb_build_object('api_attachment_ids',ids),'scope',(result->>'scope')||'; current latest reviewed API originals only');
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('ezyvet_release_attachment_current','list_record_release_sources_v9','select_all_record_release_sources_v9') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname<>'ezyvet_release_attachment_current' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
