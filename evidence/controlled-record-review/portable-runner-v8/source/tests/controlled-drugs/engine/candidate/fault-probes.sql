-- OWNED CLONE ONLY. Temporary fault triggers and temporary manifest changes are
-- inside the same exception subtransaction that must roll back every effect.
-- No deployed GUC, bypass or fault hook is introduced.
create function pg_temp.engine_full_snapshot()returns jsonb language plpgsql volatile as $$
declare r record;v jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,v);end loop;return result;
end $$;
create function pg_temp.engine_injected_fault()returns trigger language plpgsql as $$begin
 raise exception 'OWNED_CONTROLLED_FAULT:%',TG_TABLE_NAME using errcode='P0001';end $$;
create temp table engine_fault_proof(relation text primary key);
do $$declare target text;root uuid;args jsonb;context jsonb;before_value jsonb;d jsonb;begin
 foreach target in array array['inventory_movements','billing_invoice_items','controlled_stock_event_lines','controlled_stock_actions']loop
  root:=gen_random_uuid();args:=jsonb_build_object('request',pg_temp.clinical_request(0.125));
  context:=pg_temp.engine_native_context(root,'record_patient_treatment',args);
  perform prepare_controlled_stock_action(auth.uid(),root,'record_patient_treatment',args,context);
  before_value:=pg_temp.engine_full_snapshot();
  begin
   execute format('create trigger owned_late_fault after insert on public.%I for each row execute function pg_temp.engine_injected_fault()',target);
   d:=controlled_stock_manifest_snapshot();
   alter table controlled_stock_engine_manifests disable trigger immutable;
   update controlled_stock_engine_manifests set definition=d,definition_hash=controlled_stock_hash(d)where revision=1;
   alter table controlled_stock_engine_manifests enable trigger immutable;
   perform controlled_stock_manifest_required();
   perform execute_controlled_stock_action(auth.uid(),root);
   raise exception 'Expected owned late fault did not run'using errcode='P0002';
  exception when raise_exception then
   if sqlerrm<>'OWNED_CONTROLLED_FAULT:'||target then raise;end if;
  end;
  if pg_temp.engine_full_snapshot()is distinct from before_value then
   raise exception 'Injected % failure left source, clinical, billing, container, head or receipt changes',target;end if;
  perform controlled_stock_manifest_required();
  if read_controlled_stock_action(auth.uid(),root)->>'state'<>'prepared'then raise exception 'Fault changed the original pending action';end if;
  perform cancel_controlled_stock_action(auth.uid(),root);
  insert into engine_fault_proof values(target);
 end loop;
end $$;
