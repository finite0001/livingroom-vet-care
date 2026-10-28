-- Owned ZERO-prefix receiver only, with ingress stopped. pg_restore creates
-- objects as its restore role before applying archived owners/ACLs. Supabase's
-- schema-local creator defaults otherwise add grants absent from the original
-- restricted ACLs. Remove those FUTURE-OBJECT defaults before restore; restore
-- every original archived ACL/default afterward without rewriting the archive.
DO $owned_empty_restore_defaults$
DECLARE role_value text;object_value text;row_value record;
BEGIN
 IF current_user<>'supabase_admin'OR current_database()<>'postgres'
 OR to_regnamespace('controlled_count_v1')IS NOT NULL THEN
 RAISE EXCEPTION 'owned_empty_receiver_required';END IF;
 IF to_regclass('supabase_migrations.schema_migrations')IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations)THEN
   RAISE EXCEPTION 'owned_empty_receiver_required';END IF;
 END IF;
 FOR row_value IN SELECT pg_get_userbyid(d.defaclrole)owner_name,d.defaclobjtype,
  CASE WHEN a.grantee=0 THEN 'PUBLIC'ELSE pg_get_userbyid(a.grantee)END grantee_name
 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl)a
 WHERE d.defaclnamespace='public'::regnamespace LOOP
  IF row_value.owner_name NOT IN('postgres','supabase_admin')
  OR row_value.defaclobjtype NOT IN('r','S','f','T')
  OR row_value.grantee_name NOT IN('PUBLIC','postgres','supabase_admin','anon','authenticated','service_role')THEN
  RAISE EXCEPTION 'unexpected_empty_receiver_defaults';END IF;
 END LOOP;
 FOREACH role_value IN ARRAY ARRAY['postgres','supabase_admin']LOOP
  FOREACH object_value IN ARRAY ARRAY['TABLES','SEQUENCES','FUNCTIONS','TYPES']LOOP
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM PUBLIC,postgres,supabase_admin,anon,authenticated,service_role',role_value,object_value);
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl)a
 WHERE d.defaclnamespace='public'::regnamespace AND d.defaclrole=ANY(ARRAY['postgres'::regrole,'supabase_admin'::regrole]))THEN
 RAISE EXCEPTION 'empty_receiver_defaults_not_cleared';END IF;
END $owned_empty_restore_defaults$;
