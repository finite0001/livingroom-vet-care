-- Backup/receiver comparison only: these observed values never supply expected
-- source metadata, permissions, authority or a release decision. Call in a
-- separate owned observer connection after source/ledger verification. Create
-- this temporary function BEFORE beginning the read-only snapshot transaction;
-- invoke SELECT pg_temp.recovery_observation() inside that transaction.
CREATE FUNCTION pg_temp.recovery_observation() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $observe$
DECLARE item record;row_count bigint;total_rows bigint:=0;table_count integer:=0;
 sequence_count integer:=0;value jsonb;relations jsonb:='{}';sequences jsonb:='{}';answer jsonb;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN
 RAISE EXCEPTION 'Read-only recovery observation required';END IF;
 -- Include every retained non-system schema. In particular, do not repeat
 -- the historical observer's omission of the count, workflow and audit data.
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname!~'^pg_'AND n.nspname<>'information_schema'AND c.relkind='f')THEN
 RAISE EXCEPTION 'Foreign data cannot be certified by this local backup observer';END IF;
 FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname!~'^pg_'AND n.nspname<>'information_schema'AND c.relkind IN ('r','p','m')
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C" LOOP
  table_count:=table_count+1;
  IF table_count>1024 THEN RAISE EXCEPTION 'Recovery table observation bound exceeded';END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I',item.nspname,item.relname)INTO row_count;
  total_rows:=total_rows+row_count;
  IF row_count>10000 OR total_rows>100000 THEN RAISE EXCEPTION 'Recovery row observation bound exceeded';END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(h ORDER BY h),''[]''::jsonb) FROM '
   ||'(SELECT encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')h FROM %I.%I t)hashed',item.nspname,item.relname)INTO value;
  relations:=relations||jsonb_build_object(item.nspname||'.'||item.relname,value);
  IF octet_length(relations::text)>16777216 THEN RAISE EXCEPTION 'Recovery observation byte bound exceeded';END IF;
 END LOOP;
 FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname!~'^pg_'AND n.nspname<>'information_schema'AND c.relkind='S'
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C" LOOP
  sequence_count:=sequence_count+1;
  IF sequence_count>1024 THEN RAISE EXCEPTION 'Recovery sequence observation bound exceeded';END IF;
  EXECUTE format('SELECT jsonb_build_object(''last_value'',last_value,''is_called'',is_called) FROM %I.%I',item.nspname,item.relname)INTO value;
  sequences:=sequences||jsonb_build_object(item.nspname||'.'||item.relname,value);
 END LOOP;
 answer:=jsonb_build_object('schema_version',1,'domain','lrv-recovery-complete-data-observation-v1',
  'relations',relations,'sequences',sequences);
 IF octet_length(answer::text)>16777216 THEN RAISE EXCEPTION 'Recovery observation byte bound exceeded';END IF;
 RETURN answer;
END $observe$;
