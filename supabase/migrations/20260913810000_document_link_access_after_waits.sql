-- Grant locks preserve immutable intent, but staff roles and wall-clock expiry
-- can change while source or access-budget locks are awaited.
do $$declare definition text;needle text;
begin
 select pg_get_functiondef('public.document_link_current(uuid)'::regprocedure) into definition;
 needle:='return s;';
 if strpos(definition,needle)=0 then raise exception 'Expected document link current return missing';end if;
 definition:=replace(definition,needle,'if not public.is_active_staff(g.actor_id) or g.expires_at<=clock_timestamp() then raise exception ''Document link unavailable'' using errcode=''42501'';end if; '||needle);
 execute definition;
 select pg_get_functiondef('public.retrieve_document_link(uuid,text,integer)'::regprocedure) into definition;
 needle:='if used is null then raise exception ''Unavailable'' using errcode=''42501'';end if;';
 if strpos(definition,needle)=0 then raise exception 'Expected document link budget guard missing';end if;
 definition:=replace(definition,needle,needle||' if not public.is_active_staff(g.actor_id) or g.expires_at<=clock_timestamp() then raise exception ''Document link unavailable'' using errcode=''42501'';end if;');
 execute definition;
end $$;
comment on function public.document_link_current(uuid) is 'Rechecks approving staff and expiry after source waits.';
comment on function public.retrieve_document_link(uuid,text,integer) is 'Rechecks approving staff and expiry after access-budget waits.';
