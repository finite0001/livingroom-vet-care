-- Private pre-upgrade catalog snapshot; no data rows or caller authority.
create function pg_temp.controlled_stock_prior_snapshot()returns jsonb
language sql volatile set search_path=public,pg_temp set timezone='UTC' as $$
 select jsonb_build_object('version',1,'functions',(
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
    'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))order by a.attnum)
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

revoke all on function pg_temp.controlled_stock_prior_snapshot() from public,anon,authenticated,service_role;
