-- Historical delivery evidence remains browseable after source ineligibility.
create function public.read_document_link_history(p_family text,p_source_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();result jsonb;
begin
 if p_family is null or p_family not in ('invoice','record_release') or p_source_id is null then raise exception 'Document family and source are required' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',g.id,'created_at',g.created_at,'expires_at',g.expires_at,'state',g.state,
  'recipient',g.recipient,'receipt_state',o.state
 ) order by g.created_at desc,g.id desc),'[]'::jsonb) into result
 from (select id,created_at,expires_at,state,recipient from public.document_link_grants
  where actor_id=actor and family=p_family and source_id=p_source_id
  order by created_at desc,id desc limit 50) g
 left join public.document_link_outbox_links l on l.grant_id=g.id
 left join public.communication_outbox o on o.id=l.outbox_id;
 return result;
end $$;
revoke all on function public.read_document_link_history(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_document_link_history(text,uuid) to authenticated;
