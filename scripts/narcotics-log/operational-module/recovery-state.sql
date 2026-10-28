-- Prospective recovery coordinator. The release builder remains disabled.
-- A mode transition is an immutable audit append plus its catalog projection.
CREATE TABLE narcotics_recovery_v1.heads (
 head_id uuid PRIMARY KEY,
 prior_head_id uuid UNIQUE REFERENCES narcotics_recovery_v1.heads(head_id),
 prior_head_hash text,
 kind text NOT NULL CHECK(kind IN ('installed','armed','source_resumed','epoch_started','released')),
 mode text NOT NULL CHECK(mode IN ('idle','armed')),
 arm_id uuid, epoch_id uuid,
 actor_id uuid, session_id uuid,
 recorded_at timestamptz NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=131072),
 record_hash text NOT NULL CHECK(record_hash ~ '^[0-9a-f]{64}$'),
 CHECK((prior_head_id IS NULL)=(prior_head_hash IS NULL)),
 CHECK((kind='installed')=(prior_head_id IS NULL)),
 CHECK((kind='installed')=(actor_id IS NULL)),
 CHECK((actor_id IS NULL)=(session_id IS NULL)),
 CHECK((mode='idle')=(arm_id IS NULL)),
 CHECK(epoch_id IS NULL OR mode='armed')
);
CREATE UNIQUE INDEX one_installation_head ON narcotics_recovery_v1.heads((true)) WHERE prior_head_id IS NULL;

CREATE FUNCTION narcotics_recovery_v1.catalog_projection() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE description_value text;projection jsonb;
BEGIN
 SELECT d.description INTO STRICT description_value FROM pg_namespace n
 JOIN pg_description d ON d.objoid=n.oid AND d.classoid='pg_namespace'::regclass AND d.objsubid=0
 WHERE n.nspname='narcotics_recovery_v1'AND n.nspowner='postgres'::regrole;
 IF description_value IS NULL OR octet_length(description_value)>2048 THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 projection:=description_value::jsonb;
 IF projection::text IS DISTINCT FROM description_value OR jsonb_typeof(projection)<>'object'
 OR(SELECT count(*)FROM jsonb_object_keys(projection))<>7
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(projection)k WHERE k NOT IN ('schema_version','domain','mode','head_id','head_hash','arm_id','epoch_id'))
 OR(projection->'schema_version')::text IS DISTINCT FROM'1'
 OR projection->>'domain'IS DISTINCT FROM'lrv-narcotics-recovery-mode-v1'
 OR jsonb_typeof(projection->'mode')IS DISTINCT FROM'string'OR projection->>'mode'NOT IN ('idle','armed')
 OR jsonb_typeof(projection->'head_hash')IS DISTINCT FROM'string'OR projection->>'head_hash'!~'^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 -- Keep the before-frontier reader catalog-only with no mutable helper call.
 IF jsonb_typeof(projection->'head_id')IS DISTINCT FROM'string'
 OR projection->>'head_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR(projection->'arm_id'<>'null'::jsonb AND(jsonb_typeof(projection->'arm_id')IS DISTINCT FROM'string'OR projection->>'arm_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))
 OR(projection->'epoch_id'<>'null'::jsonb AND(jsonb_typeof(projection->'epoch_id')IS DISTINCT FROM'string'OR projection->>'epoch_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 IF(projection->>'mode'='idle')IS DISTINCT FROM(projection->'arm_id'='null'::jsonb)
 OR(projection->'epoch_id'<>'null'::jsonb AND projection->>'mode'<>'armed') THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 RETURN projection;
END $$;

CREATE FUNCTION narcotics_recovery_v1.projection_of(p_document jsonb,p_hash text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-mode-v1',
 'head_id',p_document->'head_id','head_hash',p_hash,'mode',p_document->'mode','arm_id',p_document->'arm_id','epoch_id',p_document->'epoch_id')
$$;

CREATE FUNCTION narcotics_recovery_v1.require_head() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE projection jsonb;row_value narcotics_recovery_v1.heads;prior_value narcotics_recovery_v1.heads;total integer:=0;root_count integer:=0;leaf_count integer:=0;selected jsonb;
BEGIN
 -- This function is a POST-frontier check. Its catalog-only caller must never
 -- inspect this audit relation before the complete original121 frontier.
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_register_v1.require_module();
 projection:=narcotics_recovery_v1.catalog_projection();
 FOR row_value IN SELECT h.*FROM narcotics_recovery_v1.heads h ORDER BY h.recorded_at,h.head_id LIMIT 4097 LOOP
  total:=total+1;
  IF total>4096 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  PERFORM narcotics_register_v1.keys(row_value.document,ARRAY['schema_version','domain','head_id','prior_head_id','prior_head_hash','kind','mode','arm_id','epoch_id','actor_id','session_id','recorded_at','body']);
  IF NOT isfinite(row_value.recorded_at) OR(row_value.document->'schema_version')::text IS DISTINCT FROM'1'
  OR row_value.document->>'domain'IS DISTINCT FROM'lrv-narcotics-recovery-head-v1'
  OR row_value.document->'head_id'IS DISTINCT FROM to_jsonb(row_value.head_id)
  OR row_value.document->'prior_head_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.prior_head_id),'null'::jsonb)
  OR row_value.document->'prior_head_hash'IS DISTINCT FROM coalesce(to_jsonb(row_value.prior_head_hash),'null'::jsonb)
  OR row_value.document->>'kind'IS DISTINCT FROM row_value.kind OR row_value.document->>'mode'IS DISTINCT FROM row_value.mode
  OR row_value.document->'arm_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.arm_id),'null'::jsonb)
  OR row_value.document->'epoch_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.epoch_id),'null'::jsonb)
  OR row_value.document->'actor_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.actor_id),'null'::jsonb)
  OR row_value.document->'session_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.session_id),'null'::jsonb)
  OR row_value.document->>'recorded_at'IS DISTINCT FROM narcotics_register_v1.utc(row_value.recorded_at)
  OR jsonb_typeof(row_value.document->'body')IS DISTINCT FROM'object'
  OR row_value.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-head-v1',row_value.document) THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  IF row_value.prior_head_id IS NULL THEN
   root_count:=root_count+1;
   IF row_value.mode<>'idle'OR row_value.epoch_id IS NOT NULL THEN RAISE EXCEPTION 'narcotics_recovery_history_invalid';END IF;
  ELSE
   SELECT *INTO STRICT prior_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=row_value.prior_head_id;
   IF prior_value.record_hash<>row_value.prior_head_hash OR prior_value.recorded_at>row_value.recorded_at THEN
   RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
   IF row_value.kind='armed'AND(prior_value.mode<>'idle'OR row_value.mode<>'armed'OR row_value.arm_id IS DISTINCT FROM row_value.head_id OR row_value.epoch_id IS NOT NULL)
   OR row_value.kind='epoch_started'AND(prior_value.mode<>'armed'OR row_value.mode<>'armed'OR row_value.arm_id IS DISTINCT FROM prior_value.arm_id OR row_value.epoch_id IS DISTINCT FROM row_value.head_id)
   OR row_value.kind IN ('source_resumed','released')AND(prior_value.mode<>'armed'OR row_value.mode<>'idle'OR row_value.epoch_id IS NOT NULL) THEN
   RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM narcotics_recovery_v1.heads h WHERE h.prior_head_id=row_value.head_id)THEN
   leaf_count:=leaf_count+1;
   IF narcotics_recovery_v1.projection_of(row_value.document,row_value.record_hash)IS DISTINCT FROM projection THEN
   RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='23514';END IF;
   selected:=row_value.document||jsonb_build_object('record_hash',row_value.record_hash);
  END IF;
 END LOOP;
 IF total=0 OR root_count<>1 OR leaf_count<>1 OR selected IS NULL THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN selected;
END $$;

CREATE FUNCTION narcotics_recovery_v1.require_exclusive_admission() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted) THEN
 RAISE EXCEPTION 'narcotics_recovery_admission_invalid' USING ERRCODE='42501';END IF;
END $$;

CREATE FUNCTION narcotics_recovery_v1.enter_recovery() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Refuse a shared-to-exclusive upgrade before any admission/practice wait.
 IF EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ShareLock'AND l.granted)
 AND NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted)THEN
 RAISE EXCEPTION 'narcotics_recovery_admission_invalid' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(90271190,0);
 PERFORM pg_advisory_xact_lock(90271040,0);
 PERFORM controlled_count_entry_v1.acquire_shared_product_relation_frontier();
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_v1.require_module();
END $$;

CREATE FUNCTION narcotics_recovery_v1.append_head(p_kind text,p_id uuid,p_actor uuid,p_body jsonb,p_expected_id uuid,p_expected_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE prior_value jsonb;identity_value jsonb;document_value jsonb;projection jsonb;hash_value text;mode_value text;arm_value uuid;epoch_value uuid;at_value timestamptz;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 prior_value:=narcotics_recovery_v1.require_head();identity_value:=narcotics_register_v1.identity(p_actor,true);
 IF prior_value->>'head_id'IS DISTINCT FROM p_expected_id::text OR prior_value->>'record_hash'IS DISTINCT FROM p_expected_hash
 OR p_id IS NULL OR p_id='00000000-0000-0000-0000-000000000000'::uuid
 OR jsonb_typeof(p_body)IS DISTINCT FROM'object'OR octet_length(p_body::text)>65536 THEN
 RAISE EXCEPTION 'narcotics_recovery_head_changed' USING ERRCODE='PT409';END IF;
 CASE p_kind
 WHEN 'armed'THEN
  IF prior_value->>'mode'<>'idle'THEN RAISE EXCEPTION 'narcotics_recovery_already_armed';END IF;
  mode_value:='armed';arm_value:=p_id;
 WHEN 'epoch_started'THEN
  IF prior_value->>'mode'<>'armed'THEN RAISE EXCEPTION 'narcotics_recovery_not_armed';END IF;
  mode_value:='armed';arm_value:=(prior_value->>'arm_id')::uuid;epoch_value:=p_id;
 WHEN 'source_resumed','released'THEN
  IF prior_value->>'mode'<>'armed'THEN RAISE EXCEPTION 'narcotics_recovery_not_armed';END IF;
  mode_value:='idle';
 ELSE RAISE EXCEPTION 'narcotics_recovery_transition_invalid';END CASE;
 at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-head-v1','head_id',p_id,
 'prior_head_id',p_expected_id,'prior_head_hash',p_expected_hash,'kind',p_kind,'mode',mode_value,'arm_id',arm_value,'epoch_id',epoch_value,
 'actor_id',p_actor,'session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(at_value),'body',p_body);
 hash_value:=narcotics_register_v1.hash('narcotics-recovery-head-v1',document_value);
 INSERT INTO narcotics_recovery_v1.heads VALUES(p_id,p_expected_id,p_expected_hash,p_kind,mode_value,arm_value,epoch_value,p_actor,(identity_value->>'session_id')::uuid,at_value,document_value,hash_value);
 projection:=narcotics_recovery_v1.projection_of(document_value,hash_value);
 EXECUTE format('COMMENT ON SCHEMA narcotics_recovery_v1 IS %L',projection::text);
 RETURN narcotics_recovery_v1.require_head();
END $$;
