CREATE FUNCTION narcotics_register_v1.module_properties(p_register text,p_recovery text,p_canonical_register text,p_canonical_recovery text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;reference_value boolean:=p_register<>p_canonical_register;
BEGIN
 SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_object_agg(n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))a))) FROM pg_namespace n WHERE n.nspname IN(p_register,p_recovery)),
 'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'role',pg_get_userbyid(d.defaclrole),'kind',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY n.nspname,d.defaclrole,d.defaclobjtype),'[]'::jsonb) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'relations',(SELECT coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
  'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',to_jsonb(c.reloptions),'is_partition',c.relispartition,
  'dropped_columns',(SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND a.attisdropped),
  'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
   'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE(SELECT ns.nspname||'.'||co.collname FROM pg_collation co JOIN pg_namespace ns ON ns.oid=co.collnamespace WHERE co.oid=a.attcollation)END,
   'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',q.conname,'kind',q.contype,'deferrable',q.condeferrable,'deferred',q.condeferred,'validated',q.convalidated,'definition',pg_get_constraintdef(q.oid,false)) ORDER BY q.conname),'[]'::jsonb) FROM pg_constraint q WHERE q.conrelid=c.oid),
  'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',ci.relname,'definition',pg_get_indexdef(i.indexrelid,0,false),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY ci.relname),'[]'::jsonb) FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=c.oid),
  'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)END ORDER BY r) FROM unnest(p.polroles)r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid),
  'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled,'type',t.tgtype,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  -- RI trigger names contain installation OIDs. Compare every semantic RI
  -- registration instead; no observed trigger name becomes a source literal.
  'internal_triggers',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM(SELECT jsonb_build_object('function',p.proname,'type',t.tgtype,'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,'constraint',q.conname,'referenced_relation',rn.nspname||'.'||rc.relname,'args',encode(t.tgargs,'hex'))value FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid LEFT JOIN pg_constraint q ON q.oid=t.tgconstraint LEFT JOIN pg_class rc ON rc.oid=t.tgconstrrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE t.tgrelid=c.oid AND t.tgisinternal)registrations),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a)) ORDER BY n.nspname,c.relname),'{}'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'types',(SELECT coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'category',t.typcategory,'owner',pg_get_userbyid(t.typowner),'not_null',t.typnotnull,'defined',t.typisdefined,'relation',CASE WHEN t.typrelid=0 THEN NULL ELSE(SELECT rn.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace rn ON rn.oid=c.relnamespace WHERE c.oid=t.typrelid)END,'base_type',CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod)END,'default',t.typdefault,'acl',t.typacl::text,
  'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)) ORDER BY n.nspname,t.typname),'{}'::jsonb) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'functions',(SELECT coalesce(jsonb_object_agg(CASE WHEN reference_value AND p.proname=ANY(__PUBLIC_FACADE_NAMES__) THEN 'public' ELSE n.nspname END||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',jsonb_build_object(
  'name',p.proname,'schema',CASE WHEN reference_value AND p.proname=ANY(__PUBLIC_FACADE_NAMES__) THEN 'public' ELSE n.nspname END,
  'arg_types',oidvectortypes(p.proargtypes),'arg_names',to_jsonb(p.proargnames),'all_arg_types',(SELECT jsonb_agg(format_type(t,NULL) ORDER BY ord) FROM unnest(p.proallargtypes)WITH ORDINALITY AS types(t,ord)),
  'arg_modes',to_jsonb(p.proargmodes),'return_type',format_type(p.prorettype,NULL),'setof',p.proretset,'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,
  'kind',p.prokind,'variadic',p.provariadic::integer,'support',p.prosupport::oid::integer,'sqlbody_null',p.prosqlbody IS NULL,'owner',pg_get_userbyid(p.proowner),'cost',p.procost,'rows',p.prorows,
  'defaults',pg_get_expr(p.proargdefaults,0),'configuration',to_jsonb(p.proconfig),'probin',p.probin,'argument_count',p.pronargs,'default_count',p.pronargdefaults,
  'body_sha256',encode(sha256(convert_to(replace(replace(p.prosrc,p_register,p_canonical_register),p_recovery,p_canonical_recovery),'UTF8')),'hex'),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a)) ORDER BY n.nspname,p.proname,oidvectortypes(p.proargtypes)),'{}'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN(p_register,p_recovery) OR(NOT reference_value AND n.nspname='public' AND p.proname ~ '^(list_narcotics_|create_narcotics_|read_narcotics_|close_narcotics_|preserve_narcotics_|download_narcotics_|narcotics_recovery_)')))
 INTO result;
 RETURN replace(replace(result::text,p_register,p_canonical_register),p_recovery,p_canonical_recovery)::jsonb;
END $$;
CREATE FUNCTION narcotics_register_v1.require_module() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_register_v1.descriptor;actual jsonb;
BEGIN
 SELECT * INTO STRICT saved FROM narcotics_register_v1.descriptor d WHERE d.revision=1;
 IF saved.definition_hash<>narcotics_register_v1.hash('narcotics-operational-module-v1',saved.definition) THEN RAISE EXCEPTION 'narcotics_module_invalid' USING ERRCODE='23514';END IF;
 actual:=narcotics_register_v1.module_properties('narcotics_register_v1','narcotics_recovery_v1','narcotics_register_v1','narcotics_recovery_v1');
 IF actual IS DISTINCT FROM saved.definition THEN RAISE EXCEPTION 'narcotics_module_invalid' USING ERRCODE='23514';END IF;
END $$;
