-- The current-source helper already rechecks actor/expiry after source waits.
-- Retrieval has a later access-budget wait and must recheck before returning bytes.
do $$declare definition text;needle text;
begin
 select pg_get_functiondef('public.retrieve_document_link(uuid,text,integer)'::regprocedure) into definition;
 needle:='if used is null then raise exception ''Unavailable'' using errcode=''42501'';end if;';
 if strpos(definition,needle)=0 then raise exception 'Expected document link budget guard missing';end if;
 execute replace(definition,needle,needle||' if not public.is_active_staff(g.actor_id) or g.expires_at<=clock_timestamp() then raise exception ''Document link unavailable'' using errcode=''42501'';end if;');
end $$;
comment on function public.retrieve_document_link(uuid,text,integer) is 'Rechecks approving staff and wall-clock expiry after access-budget waits; denied retrieval rolls back the counter.';
