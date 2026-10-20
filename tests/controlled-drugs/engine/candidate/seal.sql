-- Every family below is private. No activation/configuration RPC is granted.
do $$declare r record;name text;columns text;begin
 for r in select c.relname,a.attname,a.atttypid from pg_class c join pg_attribute a on a.attrelid=c.oid
  where c.relnamespace='public'::regnamespace and c.relkind='r'and left(c.relname,17)='controlled_stock_'
   and a.attnum>0 and not a.attisdropped and a.atttypid in('numeric'::regtype,'timestamptz'::regtype,'uuid'::regtype)loop
  if r.atttypid='numeric'::regtype then
   execute format('alter table public.%I add constraint %I check(%I::text not in(''NaN'',''Infinity'',''-Infinity''))',r.relname,'cs_finite_'||r.attname,r.attname);
  elsif r.atttypid='timestamptz'::regtype then
   execute format('alter table public.%I add constraint %I check(isfinite(%I))',r.relname,'cs_finite_'||r.attname,r.attname);
  else execute format('alter table public.%I add constraint %I check(%I<>''00000000-0000-0000-0000-000000000000''::uuid)',r.relname,'cs_nonzero_'||r.attname,r.attname);end if;
 end loop;
 for r in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'and left(c.relname,17)='controlled_stock_'loop
  name:=r.relname;
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  if name in('controlled_stock_states','controlled_stock_container_heads','controlled_stock_positions')then
   execute format('create trigger controlled_guard before insert or update or delete on public.%I for each row execute function public.controlled_stock_projection_guard()',name);
   execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.controlled_stock_projection_guard()',name);
  elsif name='controlled_stock_execution_contexts'then
   execute format('create trigger controlled_guard before insert or update or delete on public.%I for each row execute function public.controlled_stock_execution_guard()',name);
   execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.controlled_stock_execution_guard()',name);
  else
   execute format('create trigger immutable before update or delete on public.%I for each row execute function public.controlled_stock_immutable()',name);
   execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.controlled_stock_immutable()',name);
   if name<>'controlled_stock_engine_manifests'then
    execute format('create trigger controlled_guard before insert on public.%I for each row execute function public.controlled_stock_insert_guard()',name);
   end if;
  end if;
  if name<>'controlled_stock_engine_manifests'then
   execute format('create constraint trigger controlled_stock_consistency after insert or update on public.%I deferrable initially deferred for each row execute function public.controlled_stock_deferred()',name);
  end if;
 end loop;
 foreach name in array array['inventory_movements','native_return_events','native_return_discrepancy_events','native_pickups','native_dispense_correction_events']loop
  execute format('create trigger controlled_stock_source_required before insert on public.%I for each row execute function public.controlled_stock_source_required()',name);
  execute format('create constraint trigger controlled_stock_source_consistency after insert on public.%I deferrable initially deferred for each row execute function public.controlled_stock_deferred()',name);
 end loop;
 for r in select c.conrelid,c.conkey,c.conname from pg_constraint c join pg_class t on t.oid=c.conrelid
  where c.contype='f'and t.relnamespace='public'::regnamespace and left(t.relname,17)='controlled_stock_'loop
  if not exists(select 1 from pg_index i where i.indrelid=r.conrelid and i.indisvalid and i.indnkeyatts>=cardinality(r.conkey)
   and array(select k.attnum from unnest(i.indkey)with ordinality k(attnum,seq)where k.seq<=cardinality(r.conkey)order by k.seq)=r.conkey)then
   select string_agg(quote_ident(a.attname),','order by k.ordinality)into columns
    from unnest(r.conkey)with ordinality k(attnum,ordinality)join pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.attnum;
   execute format('create index %I on %s(%s)','cs_fk_'||substr(md5(r.conrelid::regclass::text||':'||r.conname),1,24),r.conrelid::regclass,columns);
  end if;
 end loop;
end $$;
create function public.controlled_stock_manifest_snapshot()returns jsonb
language sql volatile set search_path=public,pg_temp as $$
 select jsonb_build_object('version',2,'functions',(
  select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
   'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee)end,
    'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable)order by x.grantee::regrole::text,x.grantor::regrole::text,x.privilege_type)
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))x),'configuration',to_jsonb(p.proconfig),'definer',p.prosecdef)order by p.oid::regprocedure::text)
  from pg_proc p where p.pronamespace='public'::regnamespace and(
   left(p.proname,17)='controlled_stock_'or left(p.proname,17)='controlled_draft_'or left(p.proname,6)='stock_'
   or p.proname like 'native_rx_%'or p.proname like 'native_fulfillment_%'or p.proname like 'native_return_%'
   or p.proname like 'native_reconciliation_%'or p.proname like 'native_correction_%'
   or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action',
    'receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration','record_native_dispense','record_native_pickup',
    'record_native_dispense_return','record_native_dispense_return_v2','record_native_return_discrepancy','append_native_dispense_correction',
    'clinical_require_staff','is_active_staff','next_visit_review_session','inventory_guard','has_role','protect_profile_privileges',
    'list_controlled_drafts','read_controlled_draft','read_controlled_draft_review','prepare_controlled_draft_review','execute_controlled_draft_review','cancel_controlled_draft_review'))),
 'relations',(
  select jsonb_object_agg(c.relname,jsonb_build_object('rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),
   'acl',(select jsonb_agg(jsonb_build_object('grantee',case when x.grantee=0 then 'PUBLIC'else pg_get_userbyid(x.grantee)end,
    'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable)order by x.grantee::regrole::text,x.grantor::regrole::text,x.privilege_type)
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x),
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
    'column_acl',(select coalesce(jsonb_agg(jsonb_build_object(
     'grantee',case when x.grantee=0 then 'PUBLIC'else pg_get_userbyid(x.grantee)end,
     'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable)
     order by(case when x.grantee=0 then 'PUBLIC'else pg_get_userbyid(x.grantee)end)collate "C",
      pg_get_userbyid(x.grantor)collate "C",x.privilege_type collate "C",x.is_grantable),'[]'::jsonb)
     from aclexplode(a.attacl)x))order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,
    'roles',(select jsonb_agg(case when r=0 then 'PUBLIC'else pg_get_userbyid(r)end order by case when r=0 then 'PUBLIC'else pg_get_userbyid(r)end)from unnest(p.polroles)r),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))order by p.polname),'[]'::jsonb)from pg_policy p where p.polrelid=c.oid),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,true))order by k.conname),'[]'::jsonb)from pg_constraint k where k.conrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true))order by t.tgname),'[]'::jsonb)from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid)order by i.indexrelid::regclass::text),'[]'::jsonb)from pg_index i where i.indrelid=c.oid))order by c.relname)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'and(
   left(c.relname,17)='controlled_stock_'or left(c.relname,17)='controlled_draft_'or left(c.relname,6)='stock_'
   or c.relname in('inventory_movements','inventory_lots','catalog_products','patient_treatments','anesthesia_drug_administrations',
    'native_return_events','native_return_operations','native_return_stock_links','native_return_compensation_links',
    'native_return_discrepancy_events','native_return_discrepancy_operations','native_return_discrepancy_correction_links',
    'native_pickups','native_dispenses','native_dispense_allocations','native_fulfillment_operations',
    'native_dispense_correction_events','native_dispense_correction_operations'))))
$$;
create function public.controlled_stock_manifest_required()returns void
language plpgsql volatile set search_path=public,pg_temp as $$declare m public.controlled_stock_engine_manifests;begin
 select * into m from public.controlled_stock_engine_manifests order by revision desc limit 1;
 if m.revision is null or m.definition_hash<>public.controlled_stock_hash(m.definition)
  or m.definition is distinct from public.controlled_stock_manifest_snapshot()then
  raise exception 'Controlled coverage, code or grants changed; reviewed engine manifest required'using errcode='23514';end if;
end $$;
