-- Owned intake review history, not a public file link or clinical release.
create function public.list_ezyvet_attachment_record_versions(p_request_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;m uuid;external_id text;items jsonb;lastrow jsonb;more boolean;latest uuid;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_request_id is null or p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Exact review history and cursor required' using errcode='23514';end if;
 select * into r from public.ezyvet_attachment_download_requests where id=p_request_id;
 if r.id is null or row(r.actor_id,r.pet_id,r.status) is distinct from row(actor,p_pet_id,'captured'::text) then raise exception 'Owned captured request required' using errcode='42501';end if;
 m:=(r.source_context->'parent'->>'animal_link_id')::uuid;external_id:=r.source_context->>'attachment_external_id';
 select id into latest from public.ezyvet_attachment_record_versions where animal_link_id=m and pet_id=p_pet_id and attachment_external_id=external_id order by version desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(v)-'source_context'||jsonb_build_object('source_context',v.source_context-'attachment_metadata') order by v.created_at desc,v.id desc),'[]') into items
 from(select * from public.ezyvet_attachment_record_versions where animal_link_id=m and pet_id=p_pet_id and attachment_external_id=external_id
 and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) v;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('request_id',p_request_id,'pet_id',p_pet_id,'animal_link_id',m,'attachment_external_id',external_id,'latest_record_id',latest,'records',items,'has_more',more,
 'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
revoke all on function public.list_ezyvet_attachment_record_versions(uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_attachment_record_versions(uuid,uuid,timestamptz,uuid,integer) to authenticated;
