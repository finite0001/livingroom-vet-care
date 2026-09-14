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
