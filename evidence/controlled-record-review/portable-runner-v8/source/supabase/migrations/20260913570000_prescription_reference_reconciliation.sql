-- Private deterministic reference accounting for the forthcoming review context.
-- A matched list is not clinical approval or a consistent-export guarantee.
create function public.ezyvet_prescription_reference_id(p_value jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select case
  when jsonb_typeof(p_value)='string' and p_value#>>'{}' ~ '^(0|[1-9][0-9]*)$' then p_value#>>'{}'
  when jsonb_typeof(p_value)='number' then case
   when (p_value#>>'{}')::numeric between 0 and 9007199254740991
    and trunc((p_value#>>'{}')::numeric)=(p_value#>>'{}')::numeric
   then trunc((p_value#>>'{}')::numeric)::text end
 end;
$$;

create function public.ezyvet_reconcile_prescription_items(p_source jsonb,p_observed jsonb,p_scan_complete boolean)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare source_present boolean:=coalesce(jsonb_typeof(p_source)='array',false);
 expected_ids text[]:='{}';observed_ids text[]:='{}';source_duplicates text[]:='{}';observed_duplicates text[]:='{}';
 invalid_source jsonb:='[]';invalid_observed jsonb:='[]';missing_ids text[];unexpected_ids text[];
 entry record;reference_id text;matched boolean;
begin
 if p_observed is null or jsonb_typeof(p_observed)<>'array' then
  raise exception 'Observed prescription references must be an array' using errcode='23514';
 end if;
 if source_present then
  for entry in select value,ordinality from jsonb_array_elements(p_source) with ordinality loop
   reference_id:=public.ezyvet_prescription_reference_id(entry.value);
   if reference_id is null then invalid_source:=invalid_source||jsonb_build_array(jsonb_build_object('index',entry.ordinality-1,'value',entry.value));
   elsif reference_id=any(expected_ids) then
    if not reference_id=any(source_duplicates) then source_duplicates:=array_append(source_duplicates,reference_id);end if;
   else expected_ids:=array_append(expected_ids,reference_id);end if;
  end loop;
 else invalid_source:=jsonb_build_array(jsonb_build_object('index',-1,'value',p_source));end if;
 for entry in select value,ordinality from jsonb_array_elements(p_observed) with ordinality loop
  reference_id:=public.ezyvet_prescription_reference_id(entry.value);
  if reference_id is null then invalid_observed:=invalid_observed||jsonb_build_array(jsonb_build_object('index',entry.ordinality-1,'value',entry.value));
  elsif reference_id=any(observed_ids) then
   if not reference_id=any(observed_duplicates) then observed_duplicates:=array_append(observed_duplicates,reference_id);end if;
  else observed_ids:=array_append(observed_ids,reference_id);end if;
 end loop;
 select coalesce(array_agg(id order by ord),'{}') into missing_ids from unnest(expected_ids) with ordinality as refs(id,ord) where not id=any(observed_ids);
 select coalesce(array_agg(id order by ord),'{}') into unexpected_ids from unnest(observed_ids) with ordinality as refs(id,ord) where not id=any(expected_ids);
 matched:=source_present and p_scan_complete is true and cardinality(missing_ids)=0 and cardinality(unexpected_ids)=0
  and cardinality(source_duplicates)=0 and cardinality(observed_duplicates)=0 and invalid_source='[]'::jsonb and invalid_observed='[]'::jsonb;
 return jsonb_build_object('status',case when matched then 'matched' else 'unresolved' end,
  'sourceListPresent',source_present,'scanComplete',p_scan_complete is true,
  'expectedIds',expected_ids,'observedIds',observed_ids,'missingIds',missing_ids,'unexpectedIds',unexpected_ids,
  'duplicateSourceIds',source_duplicates,'duplicateObservedIds',observed_duplicates,
  'invalidSourceReferences',invalid_source,'invalidObservedReferences',invalid_observed);
end;
$$;
revoke all on function public.ezyvet_prescription_reference_id(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ezyvet_reconcile_prescription_items(jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
