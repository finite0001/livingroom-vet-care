-- Pure quantity accounting only: no correction writes, stock compensation, or authority grant.
create function public.native_return_quantity_allocations(p_allocations jsonb) returns void
language plpgsql immutable security definer set search_path=public as $$
declare a jsonb; previous text:='';
begin
 if jsonb_typeof(p_allocations) is distinct from 'array' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
 if jsonb_array_length(p_allocations) not between 1 and 100 then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(p_allocations) loop
  if jsonb_typeof(a) is distinct from 'object' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  if (select array_agg(k order by k) from jsonb_object_keys(a) k) is distinct from array['allocation_id','lot_id','quantity']::text[]
   or jsonb_typeof(a->'allocation_id') is distinct from 'string' or jsonb_typeof(a->'lot_id') is distinct from 'string'
   or (a->>'allocation_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (a->>'lot_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (a->>'allocation_id') collate "C" <= previous collate "C"
   or jsonb_typeof(a->'quantity') is distinct from 'string'
   or (a->>'quantity') !~ '^(0|[1-9][0-9]{0,10})\.[0-9]{3}$'
  then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  if (a->>'quantity')::numeric<=0 then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  previous:=a->>'allocation_id';
 end loop;
end;$$;
revoke all on function public.native_return_quantity_allocations(jsonb) from public,anon,authenticated,service_role;

create function public.native_return_quantity_replay(p_originals jsonb,p_events jsonb) returns jsonb
language plpgsql immutable security definer set search_path=public as $$
declare sources jsonb:='{}'; totals jsonb:='{}'; histories jsonb:='{}'; intakes jsonb:='{}'; ordinary jsonb:='{}';
 intake_order text[]:='{}'; ordinary_order text[]:='{}'; seen jsonb:='{}';
 e jsonb;a jsonb;s jsonb;t jsonb;c jsonb;h jsonb;target jsonb; b jsonb; n numeric; remaining numeric; seq integer:=0;
 aid text;eid text;root text;act text;expected text;key text;k text;target_id text;
 allocations jsonb:='[]'; intake_result jsonb:='[]'; correction_result jsonb:='[]'; history_result jsonb:='[]'; rows jsonb;
begin
 perform public.native_return_quantity_allocations(p_originals);
 if jsonb_typeof(p_events) is distinct from 'array' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(p_originals) loop
  aid:=a->>'allocation_id';sources:=sources||jsonb_build_object(aid,a);
  totals:=totals||jsonb_build_object(aid,jsonb_build_object('received',0.000,'held',0.000,'disposed',0.000,'restocked',0.000));
  histories:=histories||jsonb_build_object(aid,jsonb_build_object('intake',0.000,'disposed',0.000,'restocked',0.000,'retractIntake',0.000,'retractDisposed',0.000,'retractRestocked',0.000));
 end loop;
 for e in select value from jsonb_array_elements(p_events) loop
  seq:=seq+1;
  if jsonb_typeof(e) is distinct from 'object' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  if (select array_agg(keys.k order by keys.k) from jsonb_object_keys(e) as keys(k)) is distinct from array['action','allocations','correction_target_id','id','intake_id','sequence']::text[]
   or jsonb_typeof(e->'id') is distinct from 'string' or (e->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or seen ? (e->>'id') or e->'sequence' is distinct from to_jsonb(seq)
   or jsonb_typeof(e->'action') is distinct from 'string' or (e->>'action') not in('intake','dispose','restock','retract_intake','retract_disposal','retract_restock')
  then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  perform public.native_return_quantity_allocations(e->'allocations');
  eid:=e->>'id';act:=e->>'action';target:=null;target_id:=null;
  if act like 'retract_%' then
   if jsonb_typeof(e->'correction_target_id') is distinct from 'string' or jsonb_typeof(e->'intake_id') is distinct from 'string'
    or (e->>'correction_target_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (e->>'intake_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   target_id:=e->>'correction_target_id';target:=ordinary->target_id;
   expected:=case act when 'retract_intake' then 'intake' when 'retract_disposal' then 'dispose' else 'restock' end;
   if target is null or target#>>'{event,action}' is distinct from expected then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   root:=case when expected='intake' then target#>>'{event,id}' else target#>>'{event,intake_id}' end;
   if e->>'intake_id' is distinct from root then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  else
   if e->'correction_target_id' is distinct from 'null'::jsonb then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   if act='intake' then
    if e->'intake_id' is distinct from 'null'::jsonb then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
    root:=eid;intakes:=intakes||jsonb_build_object(root,'{}'::jsonb);intake_order:=array_append(intake_order,root);
   else
    if jsonb_typeof(e->'intake_id') is distinct from 'string' or (e->>'intake_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
    root:=e->>'intake_id';
   end if;
  end if;
  if not intakes ? root then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  for a in select value from jsonb_array_elements(e->'allocations') loop
   aid:=a->>'allocation_id';s:=sources->aid;n:=(a->>'quantity')::numeric;t:=totals->aid;h:=histories->aid;
   if s is null or s->'lot_id' is distinct from a->'lot_id' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   c:=intakes#>array[root,aid];
   if act='intake' then c:=jsonb_build_object('received',0.000,'held',0.000,'disposed',0.000,'restocked',0.000);end if;
   if c is null then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   if target is not null then
    remaining:=(target#>>array['remaining',aid])::numeric;
    if remaining is null or remaining<n then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
    target:=jsonb_set(target,array['remaining',aid],to_jsonb(remaining-n));
   end if;
   if act='intake' and (t->>'received')::numeric+n>(s->>'quantity')::numeric
    or act in('dispose','restock','retract_intake') and (c->>'held')::numeric<n
    or act='retract_disposal' and (c->>'disposed')::numeric<n
    or act='retract_restock' and (c->>'restocked')::numeric<n
   then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   -- Apply identical deltas to the allocation total and its owning intake.
   foreach k in array array['total','current'] loop
    b:=case k when 'total' then t else c end;
    if act in('intake','retract_intake') then
     remaining:=case act when 'intake' then n else -n end;
     b:=jsonb_set(jsonb_set(b,'{received}',to_jsonb((b->>'received')::numeric+remaining)),'{held}',to_jsonb((b->>'held')::numeric+remaining));
    else
     key:=case when act in('dispose','retract_disposal') then 'disposed' else 'restocked' end;
     remaining:=case when act in('dispose','restock') then n else -n end;
     b:=jsonb_set(jsonb_set(b,array[key],to_jsonb((b->>key)::numeric+remaining)),'{held}',to_jsonb((b->>'held')::numeric-remaining));
    end if;
    if k='total' then t:=b;else c:=b;end if;
   end loop;
   key:=case act when 'intake' then 'intake' when 'dispose' then 'disposed' when 'restock' then 'restocked' when 'retract_intake' then 'retractIntake' when 'retract_disposal' then 'retractDisposed' else 'retractRestocked' end;
   h:=jsonb_set(h,array[key],to_jsonb((h->>key)::numeric+n));
   totals:=jsonb_set(totals,array[aid],t);histories:=jsonb_set(histories,array[aid],h);intakes:=jsonb_set(intakes,array[root,aid],c);
  end loop;
  if target is not null then ordinary:=jsonb_set(ordinary,array[target_id],target);
  else
   select jsonb_object_agg(value->>'allocation_id',(value->>'quantity')::numeric) into b from jsonb_array_elements(e->'allocations');
   ordinary:=ordinary||jsonb_build_object(eid,jsonb_build_object('event',e,'remaining',b));ordinary_order:=array_append(ordinary_order,eid);
  end if;
  seen:=seen||jsonb_build_object(eid,true);
 end loop;
 for s in select value from jsonb_array_elements(p_originals) loop
  aid:=s->>'allocation_id';t:=totals->aid;h:=histories->aid;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('allocation_id',aid,'lot_id',s->'lot_id','dispensed_quantity',s->'quantity','returned_quantity',round((t->>'received')::numeric,3)::text,'remaining_returnable_quantity',round((s->>'quantity')::numeric-(t->>'received')::numeric,3)::text,'held_quantity',round((t->>'held')::numeric,3)::text,'disposed_quantity',round((t->>'disposed')::numeric,3)::text,'restocked_quantity',round((t->>'restocked')::numeric,3)::text));
  history_result:=history_result||jsonb_build_array(jsonb_build_object('allocation_id',aid,'lot_id',s->'lot_id','gross_intake_quantity',round((h->>'intake')::numeric,3)::text,'gross_disposed_quantity',round((h->>'disposed')::numeric,3)::text,'gross_restocked_quantity',round((h->>'restocked')::numeric,3)::text,'retracted_intake_quantity',round((h->>'retractIntake')::numeric,3)::text,'retracted_disposed_quantity',round((h->>'retractDisposed')::numeric,3)::text,'retracted_restocked_quantity',round((h->>'retractRestocked')::numeric,3)::text));
 end loop;
 foreach root in array intake_order loop
  rows:='[]';
  for aid,c in select entry.key,entry.value from jsonb_each(intakes->root) entry order by entry.key collate "C" loop
   rows:=rows||jsonb_build_array(jsonb_build_object('allocation_id',aid,'lot_id',sources#>array[aid,'lot_id'],'quantity',round((c->>'received')::numeric,3)::text,'held_quantity',round((c->>'held')::numeric,3)::text,'disposed_quantity',round((c->>'disposed')::numeric,3)::text,'restocked_quantity',round((c->>'restocked')::numeric,3)::text));
  end loop;
  intake_result:=intake_result||jsonb_build_array(jsonb_build_object('id',root,'allocations',rows));
 end loop;
 foreach eid in array ordinary_order loop
  select jsonb_agg(jsonb_build_object('allocation_id',entry.key,'quantity',round(entry.value::text::numeric,3)::text) order by entry.key collate "C") into rows from jsonb_each(ordinary#>array[eid,'remaining']) entry;
  correction_result:=correction_result||jsonb_build_array(jsonb_build_object('event_id',eid,'allocations',rows));
 end loop;
 return jsonb_build_object('allocations',allocations,'intakes',intake_result,'correction_remaining',correction_result,'historical',history_result);
end;$$;
revoke all on function public.native_return_quantity_replay(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Existing version-one balance readers deliberately retain their set-based prefix
-- calculations. The verifier invokes those readers for every historical prefix;
-- replaying the complete prefix on each call would multiply operational cost.
-- Future correction writes must introduce a verifier that computes prefixes once.
