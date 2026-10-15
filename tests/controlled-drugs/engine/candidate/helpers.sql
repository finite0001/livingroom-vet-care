create function public.controlled_stock_keys(value jsonb,keys text[])returns void
language plpgsql immutable set search_path=public,pg_temp as $$begin
 if jsonb_typeof(value)is distinct from 'object'
 or(select count(*)from jsonb_object_keys(value))<>cardinality(keys)
 or exists(select 1 from jsonb_object_keys(value)k where not(k=any(keys)))then
  raise exception 'Exact controlled-operation fields required'using errcode='23514';end if;
end $$;
create function public.controlled_stock_uuid(value jsonb)returns uuid
language plpgsql immutable set search_path=public,pg_temp as $$declare result uuid;begin
 if jsonb_typeof(value)is distinct from 'string'then raise exception 'Canonical controlled UUID required'using errcode='23514';end if;
 begin result:=(value#>>'{}')::uuid;exception when invalid_text_representation then
  raise exception 'Canonical controlled UUID required'using errcode='23514';end;
 if result::text is distinct from value#>>'{}'or result='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'Canonical controlled UUID required'using errcode='23514';end if;return result;
end $$;
create function public.controlled_stock_decimal(value jsonb,allow_zero boolean default false)returns numeric
language plpgsql immutable set search_path=public,pg_temp as $$declare result numeric;begin
 if jsonb_typeof(value)is distinct from 'string'or value#>>'{}'!~'^-?(0|[1-9][0-9]{0,10})([.][0-9]{1,3})?$'then
  raise exception 'Exact stock decimal string required; maximum three decimal places'using errcode='23514';end if;
 result:=(value#>>'{}')::numeric;
 if not allow_zero and result=0 then raise exception 'Nonzero controlled quantity required'using errcode='23514';end if;
 return result;
end $$;
create function public.controlled_stock_text(value jsonb,maximum integer,multiline boolean default false)returns text
language plpgsql immutable set search_path=public,pg_temp as $$declare result text;begin
 if jsonb_typeof(value)is distinct from 'string'then raise exception 'Bounded controlled text required'using errcode='23514';end if;
 result:=value#>>'{}';
 if char_length(result)not between 1 and maximum or result<>btrim(result,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
 or exists(select 1 from regexp_split_to_table(result,'')c where not((multiline and ascii(c)in(9,10))or(ascii(c)>=32 and ascii(c)<>127)))then
  raise exception 'Use clean bounded controlled text'using errcode='23514';end if;return result;
end $$;
create function public.controlled_stock_actor(expected_actor uuid default null)returns uuid
language plpgsql volatile security definer set search_path=public,pg_temp as $$declare actor uuid:=auth.uid();begin
 if current_setting('transaction_isolation')<>'read committed'then
  raise exception 'Controlled stock requires READ COMMITTED isolation'using errcode='23514';end if;
 if auth.jwt()->>'role'is distinct from 'authenticated'or actor is null
 or public.clinical_require_staff()is distinct from actor
 or(expected_actor is not null and actor is distinct from expected_actor)then
  raise exception 'Matched active controlled-record staff required'using errcode='42501';end if;
 -- Called again in a fresh command after every blocking resource/container wait.
 perform public.next_visit_review_session();return actor;
end $$;
create function public.controlled_stock_writer(value text)returns void
language plpgsql immutable set search_path=public,pg_temp as $$begin
 if value is null or value not in('receive_inventory','adjust_inventory','record_patient_treatment',
 'record_native_dispense','record_native_dispense_return','record_native_dispense_return_v2',
 'record_anesthesia_drug_administration','record_native_return_discrepancy',
 'record_native_pickup','append_native_dispense_correction')then
  raise exception 'Reviewed controlled producer required'using errcode='23514';end if;
end $$;
create function public.controlled_stock_immutable()returns trigger
language plpgsql set search_path=public,pg_temp as $$begin
 raise exception 'Controlled stock evidence is immutable'using errcode='23514';
end $$;

create function public.controlled_stock_hash(value jsonb)returns text
language sql immutable set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(value::text,'UTF8')),'hex')
$$;
create function public.controlled_stock_identity(p_product uuid)returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',id,'name',name,'kind',kind,'manufacturer',manufacturer,'unit',unit)
 from public.catalog_products where id=p_product
$$;
create function public.controlled_stock_gate(p_actor uuid,p_id uuid)returns uuid
language plpgsql volatile set search_path=public,pg_temp as $$declare actor uuid;begin
 if p_actor is null or p_id is null or p_id='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'Matched controlled operation actor and UUID required'using errcode='42501';end if;
 actor:=public.controlled_stock_actor(p_actor);
 perform pg_advisory_xact_lock_shared(90271040,0);
 perform public.controlled_stock_actor(actor);
 perform pg_advisory_xact_lock(hashtextextended('controlled-stock-operation:'||p_id::text,0));
 perform public.controlled_stock_actor(actor);
 perform public.controlled_stock_manifest_required();
 return actor;
end $$;
create function public.controlled_stock_product_gate(p_actor uuid,p_product uuid)returns void
language plpgsql volatile set search_path=public,pg_temp as $$begin
 if p_product is null then raise exception 'Controlled product identity required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('controlled-stock-product:'||p_product::text,0));
 perform public.controlled_stock_actor(p_actor);
end $$;
create function public.controlled_stock_exclusive()returns void
language plpgsql volatile set search_path=public,pg_temp as $$declare actor uuid:=public.controlled_stock_actor();begin
 if exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'
  and classid=90271040 and objid=0 and objsubid=2 and mode='ShareLock'and granted)then
  raise exception 'Finish the shared stock transaction before exclusive freeze'using errcode='23514';end if;
 perform pg_advisory_xact_lock(90271040,0);
 perform public.controlled_stock_actor(actor);
 if not exists(select 1 from public.user_roles where user_id=actor and role in('DVM','ADMIN'))then
  raise exception 'Current controlled configuration reviewer required'using errcode='42501';end if;
end $$;
create function public.controlled_stock_root_exists(p_id uuid)returns boolean
language sql volatile set search_path=public,pg_temp as $$
 select exists(select 1 from public.inventory_movements where id=p_id)
 or exists(select 1 from public.patient_treatments where id=p_id)
 or exists(select 1 from public.anesthesia_drug_administrations where id=p_id)
 or exists(select 1 from public.native_fulfillment_operations where id=p_id)
 or exists(select 1 from public.native_dispenses where id=p_id)
 or exists(select 1 from public.native_pickups where id=p_id)
 or exists(select 1 from public.native_return_operations where id=p_id)
 or exists(select 1 from public.native_return_events where id=p_id)
 or exists(select 1 from public.native_return_discrepancy_operations where id=p_id)
 or exists(select 1 from public.native_return_discrepancy_events where id=p_id)
 or exists(select 1 from public.native_dispense_correction_operations where id=p_id)
 or exists(select 1 from public.native_dispense_correction_events where id=p_id)
$$;
create function public.controlled_stock_current()returns public.controlled_stock_execution_contexts
language plpgsql volatile set search_path=public,pg_temp as $$declare r public.controlled_stock_execution_contexts;begin
 select * into r from public.controlled_stock_execution_contexts where backend_pid=pg_backend_pid()
 and server_started_at=pg_postmaster_start_time()and transaction_id=txid_current()
 and transaction_started_at=transaction_timestamp()and statement_started_at=statement_timestamp()
 and actor_id=auth.uid()and session_id::text=auth.jwt()->>'session_id'and phase='executing';
 return r;
end $$;
