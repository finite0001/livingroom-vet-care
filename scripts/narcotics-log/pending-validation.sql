-- Transactional mandatory work, never a stored assertion of validity.
CREATE TABLE controlled_count_v1.pending_products(
 transaction_id bigint NOT NULL CHECK(transaction_id>0),
 product_id uuid NOT NULL CHECK(product_id<>'00000000-0000-0000-0000-000000000000'::uuid),
 PRIMARY KEY(transaction_id,product_id)
);
ALTER TABLE controlled_count_v1.pending_products ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION controlled_count_v1.pending_scope_required()RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE context_value jsonb;scope_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 SELECT to_jsonb(c)INTO STRICT context_value FROM public.controlled_stock_execution_contexts c
 WHERE c.backend_pid=pg_backend_pid();
 -- This is a pure source mapping check, including the legal post-parent
 -- reconciliation mapping. The unchanged fact BEFORE guard authorizes writes.
 PERFORM controlled_count_entry_v1.context_phase_mapping_values(context_value);
 IF context_value->'backend_pid'IS DISTINCT FROM to_jsonb(pg_backend_pid())
 OR context_value->'server_started_at'IS DISTINCT FROM to_jsonb(pg_postmaster_start_time())
 OR context_value->'transaction_id'IS DISTINCT FROM to_jsonb(txid_current())
 OR context_value->'transaction_started_at'IS DISTINCT FROM to_jsonb(transaction_timestamp())
 OR context_value->'statement_started_at'IS DISTINCT FROM to_jsonb(statement_timestamp())
 OR context_value->>'phase'IS DISTINCT FROM'count_operating'THEN
  RAISE EXCEPTION 'count_context_invalid'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 scope_value:=context_value->'count_scope';
 IF controlled_count_v1.count_wire_uuid(scope_value->'product_id')IS NOT TRUE THEN
  RAISE EXCEPTION 'count_context_invalid'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 RETURN scope_value;
END $$;

CREATE FUNCTION controlled_count_v1.collect_pending_product()RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE scope_value jsonb;
BEGIN
 IF TG_TABLE_SCHEMA IS DISTINCT FROM'controlled_count_v1'OR TG_LEVEL IS DISTINCT FROM'ROW'
 OR NOT(TG_TABLE_NAME=ANY(ARRAY['operations','cycles','snapshots','statements','outcomes','cancellations',
 'causes','open_causes','resolutions','reconciliation_preparations','reconciliation_approvals',
 'reconciliation_executions','reconciliation_confirmations','reconciliation_execution_causes']))
 OR(TG_OP IS DISTINCT FROM'INSERT'AND NOT(TG_TABLE_NAME='open_causes'AND TG_OP='DELETE'))THEN
  RAISE EXCEPTION 'count_source_invalid'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 scope_value:=controlled_count_v1.pending_scope_required();
 INSERT INTO controlled_count_v1.pending_products(transaction_id,product_id)
 VALUES(txid_current(),(scope_value->>'product_id')::uuid)
 ON CONFLICT(transaction_id,product_id)DO NOTHING;
 RETURN NULL;
END $$;

CREATE FUNCTION controlled_count_v1.pending_product_write_guard()RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
DECLARE scope_value jsonb;
BEGIN
 IF TG_TABLE_SCHEMA IS DISTINCT FROM'controlled_count_v1'OR TG_TABLE_NAME IS DISTINCT FROM'pending_products'
 OR TG_OP IS DISTINCT FROM'INSERT'OR TG_LEVEL IS DISTINCT FROM'ROW'THEN
  RAISE EXCEPTION 'count_immutable_record'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 scope_value:=controlled_count_v1.pending_scope_required();
 IF NEW.transaction_id IS DISTINCT FROM txid_current()
 OR NEW.product_id IS DISTINCT FROM(scope_value->>'product_id')::uuid THEN
  RAISE EXCEPTION 'count_context_invalid'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION controlled_count_v1.pending_product_delete_guard()RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 IF TG_TABLE_SCHEMA IS DISTINCT FROM'controlled_count_v1'OR TG_TABLE_NAME IS DISTINCT FROM'pending_products'
 OR TG_OP IS DISTINCT FROM'DELETE'OR TG_LEVEL IS DISTINCT FROM'ROW'
 OR OLD.transaction_id IS DISTINCT FROM txid_current()THEN
  RAISE EXCEPTION 'count_source_invalid'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 -- Every deletion, including an explicit early clear, MUST validate all final
 -- history, saved closures and actual unresolved membership for this product.
 PERFORM controlled_count_v1.product_live_causes(OLD.product_id);
 RETURN OLD;
END $$;

CREATE FUNCTION controlled_count_v1.flush_pending_product()RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 IF TG_TABLE_SCHEMA IS DISTINCT FROM'controlled_count_v1'OR TG_TABLE_NAME IS DISTINCT FROM'pending_products'
 OR TG_OP IS DISTINCT FROM'INSERT'OR TG_LEVEL IS DISTINCT FROM'ROW'
 OR NEW.transaction_id IS DISTINCT FROM txid_current()THEN
  RAISE EXCEPTION 'count_source_invalid'USING ERRCODE='P0001',DETAIL='',HINT='';END IF;
 -- Missing work can only have been removed through the full DELETE guard.
 -- A newly enqueued item for the same key is checked against CURRENT data.
 DELETE FROM controlled_count_v1.pending_products p
 WHERE p.transaction_id=NEW.transaction_id AND p.product_id=NEW.product_id;
 RETURN NULL;
END $$;

CREATE TRIGGER pending_product_insert_update BEFORE INSERT OR UPDATE ON controlled_count_v1.pending_products
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.pending_product_write_guard();
CREATE TRIGGER pending_product_no_truncate BEFORE TRUNCATE ON controlled_count_v1.pending_products
FOR EACH STATEMENT EXECUTE FUNCTION controlled_count_v1.pending_product_write_guard();
CREATE TRIGGER pending_product_validate_delete BEFORE DELETE ON controlled_count_v1.pending_products
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.pending_product_delete_guard();
CREATE CONSTRAINT TRIGGER pending_product_consistency AFTER INSERT ON controlled_count_v1.pending_products
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.flush_pending_product();

CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.operations
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.cycles
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.snapshots
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.statements
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.outcomes
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.cancellations
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.causes
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT OR DELETE ON controlled_count_v1.open_causes
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.resolutions
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.reconciliation_preparations
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.reconciliation_approvals
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.reconciliation_executions
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.reconciliation_confirmations
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
CREATE TRIGGER count_pending_product AFTER INSERT ON controlled_count_v1.reconciliation_execution_causes
FOR EACH ROW EXECUTE FUNCTION controlled_count_v1.collect_pending_product();
