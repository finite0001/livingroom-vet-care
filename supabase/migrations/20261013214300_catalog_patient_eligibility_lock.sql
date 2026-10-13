-- Migration180 is already installed on staging. Preserve its canonical source and
-- acquire the inherited care gate before checking the current patient species.
do $$declare body text;needle text:=' perform public.native_rx_keys(p_values,array[';begin
 body:=pg_get_functiondef('public.save_catalog_appointment(uuid,uuid,uuid,integer,jsonb)'::regprocedure);
 if position('public.care_eligibility_lock()' in body)>0 or position(needle in body)=0 then
  raise exception 'Unexpected managed booking source; inspect before changing lock order';
 end if;
 -- Existing order: schedule semaphore, exact receipt recovery, care semaphore,
 -- patient/type validation, appointment row lock, canonical save.
 body:=replace(body,needle,E' perform public.care_eligibility_lock();\n'||needle);
 execute body;
end $$;
