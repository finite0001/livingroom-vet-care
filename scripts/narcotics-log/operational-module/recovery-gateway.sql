-- Apply only to the verified owned/native receiver while REST ingress is
-- inaccessible or drained. A reload notification does not drain old requests.
-- pg_dump does not preserve this role configuration; repeat the exact check
-- and installation before reopening a restored receiver.
DO $recovery_gateway_configuration$
DECLARE observed jsonb;expected jsonb:='[{"role":"authenticator","database":null,"setting":"pgrst.db_pre_request=public.narcotics_recovery_admission_v1"}]'::jsonb;
BEGIN
 IF current_user<>'postgres'OR to_regprocedure('public.narcotics_recovery_admission_v1()')IS NULL THEN
 RAISE EXCEPTION 'narcotics_recovery_gateway_installation_invalid';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'database',d.datname,'setting',setting)
  ORDER BY r.rolname,d.datname,setting),'[]'::jsonb)INTO observed
 FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase
 CROSS JOIN LATERAL unnest(s.setconfig)config(setting)
 WHERE(s.setdatabase=0 OR d.datname='postgres')AND(
  setting LIKE'pgrst.%'OR((r.rolname IN('authenticator','anon','authenticated','service_role')OR s.setrole=0)
   AND split_part(setting,'=',1)IN('search_path','role','session_authorization')));
 IF observed<>'[]'::jsonb AND observed IS DISTINCT FROM expected THEN
 RAISE EXCEPTION 'narcotics_recovery_existing_gateway_configuration';END IF;
 IF observed='[]'::jsonb THEN
  ALTER ROLE authenticator SET pgrst.db_pre_request='public.narcotics_recovery_admission_v1';
 END IF;
END $recovery_gateway_configuration$;
SELECT pg_notify('pgrst','reload config');
SELECT pg_notify('pgrst','reload schema');
