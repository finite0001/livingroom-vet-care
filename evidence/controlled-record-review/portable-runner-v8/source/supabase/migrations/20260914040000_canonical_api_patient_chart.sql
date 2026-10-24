-- Chart discovery exposes reviewed history, not capture ownership or file access.
create function public.read_ezyvet_attachment_chart(
 p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();items jsonb;more boolean;lastrow jsonb;
begin
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then
  raise exception 'Patient and exact history cursor required' using errcode='23514';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'record',to_jsonb(v)-'source_context',
  'is_latest',not exists(select 1 from public.ezyvet_attachment_record_versions newer
    where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version),
  'source_current',public.ezyvet_attachment_capture_current(v.request_id)
 ) order by v.created_at desc,v.id desc),'[]') into items
 from(select * from public.ezyvet_attachment_record_versions where pet_id=p_pet_id
  and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id))
  order by created_at desc,id desc limit p_limit+1) v;
 more:=jsonb_array_length(items)>p_limit;
 if more then items:=items-p_limit;end if;
 lastrow:=items->(jsonb_array_length(items)-1)->'record';
 return jsonb_build_object('pet_id',p_pet_id,'records',items,'has_more',more,
  'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
revoke all on function public.read_ezyvet_attachment_chart(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_ezyvet_attachment_chart(uuid,timestamptz,uuid,integer) to authenticated;
