-- Restore fidelity only, with verified owned receiver ingress still closed.
-- PG17 pg_dump prints BETWEEN as >=/<=; reparsing flattens the inner AND.
-- Recreate ONLY the known witness CHECK with its frozen source BETWEEN spelling.
-- No archive, historical descriptor, expected metadata or ACL is rewritten.
DO $restore_original_witness_check$
DECLARE original_definition text:='CHECK ((((name IS NULL) OR (((char_length(name) >= 1) AND (char_length(name) <= 200)) AND (octet_length(name) <= 800))) AND ((recorder_name IS NULL) OR (((char_length(recorder_name) >= 1) AND (char_length(recorder_name) <= 200)) AND (octet_length(recorder_name) <= 800))) AND ((preparation IS NULL) OR ((jsonb_typeof(preparation) = ''object''::text) AND (octet_length((preparation)::text) <= 1572864))) AND ((request IS NULL) OR ((jsonb_typeof(request) = ''object''::text) AND (octet_length((request)::text) <= 8192))) AND ((receipt IS NULL) OR ((jsonb_typeof(receipt) = ''object''::text) AND (octet_length((receipt)::text) <= 8192))) AND (jsonb_typeof(document) = ''object''::text) AND (octet_length((document)::text) <= 2097152)))';
 flattened_definition text:='CHECK ((((name IS NULL) OR ((char_length(name) >= 1) AND (char_length(name) <= 200) AND (octet_length(name) <= 800))) AND ((recorder_name IS NULL) OR ((char_length(recorder_name) >= 1) AND (char_length(recorder_name) <= 200) AND (octet_length(recorder_name) <= 800))) AND ((preparation IS NULL) OR ((jsonb_typeof(preparation) = ''object''::text) AND (octet_length((preparation)::text) <= 1572864))) AND ((request IS NULL) OR ((jsonb_typeof(request) = ''object''::text) AND (octet_length((request)::text) <= 8192))) AND ((receipt IS NULL) OR ((jsonb_typeof(receipt) = ''object''::text) AND (octet_length((receipt)::text) <= 8192))) AND (jsonb_typeof(document) = ''object''::text) AND (octet_length((document)::text) <= 2097152)))'; observed text;
BEGIN
 IF current_user<>'postgres'OR current_database()<>'postgres'
 OR to_regclass('controlled_count_v1.descriptor')IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='controlled_stock_workflow_v1'AND c.relname='witness_operations'
  AND c.relkind='r'AND c.relowner='postgres'::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition)THEN
 RAISE EXCEPTION 'owned_restored_witness_table_required';END IF;
 SELECT pg_get_constraintdef(c.oid,false)INTO STRICT observed FROM pg_constraint c
 WHERE c.conrelid='controlled_stock_workflow_v1.witness_operations'::regclass
 AND c.conname='stock_witness_bounds'AND c.contype='c'AND NOT c.condeferrable AND NOT c.condeferred
 AND c.convalidated AND c.conislocal AND c.coninhcount=0 AND NOT c.connoinherit;
 IF observed=original_definition THEN RETURN;END IF;
 IF observed IS DISTINCT FROM flattened_definition THEN
 RAISE EXCEPTION 'unrecognized_restored_witness_check';END IF;
 ALTER TABLE controlled_stock_workflow_v1.witness_operations DROP CONSTRAINT stock_witness_bounds;
 ALTER TABLE controlled_stock_workflow_v1.witness_operations ADD CONSTRAINT stock_witness_bounds CHECK ((name IS NULL OR (char_length(name) BETWEEN 1 AND 200 AND octet_length(name) <= 800)) AND (recorder_name IS NULL OR (char_length(recorder_name) BETWEEN 1 AND 200 AND octet_length(recorder_name) <= 800)) AND (preparation IS NULL OR (jsonb_typeof(preparation) = 'object' AND octet_length(CAST(preparation AS text)) <= 1572864)) AND (request IS NULL OR (jsonb_typeof(request) = 'object' AND octet_length(CAST(request AS text)) <= 8192)) AND (receipt IS NULL OR (jsonb_typeof(receipt) = 'object' AND octet_length(CAST(receipt AS text)) <= 8192)) AND jsonb_typeof(document) = 'object' AND octet_length(CAST(document AS text)) <= 2097152);
 IF(SELECT pg_get_constraintdef(c.oid,false)FROM pg_constraint c
 WHERE c.conrelid='controlled_stock_workflow_v1.witness_operations'::regclass AND c.conname='stock_witness_bounds')IS DISTINCT FROM original_definition THEN
 RAISE EXCEPTION 'original_witness_check_not_restored';END IF;
END $restore_original_witness_check$;
