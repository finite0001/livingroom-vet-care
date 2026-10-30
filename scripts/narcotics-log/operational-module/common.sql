-- Independent operational audit module. No existing relation is changed.
CREATE SCHEMA narcotics_register_v1 AUTHORIZATION postgres;
CREATE SCHEMA narcotics_recovery_v1 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA narcotics_register_v1,narcotics_recovery_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE narcotics_register_v1.descriptor (
 revision integer PRIMARY KEY CHECK (revision=1),
 definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
 definition_hash text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_register_v1.operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('report','form')),
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('saved','abandoned')),
 original_request jsonb, request_hash text,
 session_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 CHECK((state='saved' AND original_request IS NOT NULL AND request_hash IS NOT NULL) OR(state='abandoned' AND original_request IS NULL AND request_hash IS NULL)),
 CHECK(request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_register_v1.reports (
 report_id uuid PRIMARY KEY REFERENCES narcotics_register_v1.operations(operation_id),
 captured_at timestamptz NOT NULL,
 dataset_text text NOT NULL CHECK(octet_length(dataset_text)<=4194304),
 dataset_hash text NOT NULL CHECK(dataset_hash=encode(sha256(convert_to(dataset_text,'UTF8')),'hex')),
 csv_text text NOT NULL CHECK(octet_length(csv_text)<=4194304),
 csv_hash text NOT NULL CHECK(csv_hash=encode(sha256(convert_to(csv_text,'UTF8')),'hex'))
);
CREATE TABLE narcotics_register_v1.form_contents (
 form_id uuid PRIMARY KEY,
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 2097152),
 mime text NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg')),
 byte_length integer NOT NULL CHECK(byte_length=octet_length(original_bytes)),
 sha256 text NOT NULL CHECK(sha256=encode(pg_catalog.sha256(original_bytes),'hex'))
);
CREATE TABLE narcotics_register_v1.form_records (
 form_id uuid PRIMARY KEY REFERENCES narcotics_register_v1.form_contents(form_id),
 operation_id uuid NOT NULL UNIQUE REFERENCES narcotics_register_v1.operations(operation_id),
 actor_id uuid NOT NULL, session_id uuid NOT NULL,
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 event_id uuid, event_hash text,
 kind text NOT NULL CHECK(kind IN ('supplier_receipt','registration','order_form','other')),
 title text NOT NULL, filename text NOT NULL,
 obtained_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 document_text text NOT NULL,
 document_hash text NOT NULL CHECK(document_hash=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
 CHECK((event_id IS NULL)=(event_hash IS NULL))
);

CREATE FUNCTION narcotics_register_v1.reject_history_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'narcotics_history_immutable' USING ERRCODE='23514',DETAIL='',HINT='';END $$;

CREATE FUNCTION narcotics_register_v1.keys(p_value jsonb,p_keys text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_value))<>cardinality(p_keys)
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value)k WHERE NOT k=ANY(p_keys)) THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023',DETAIL='',HINT='';END IF;
END $$;
CREATE FUNCTION narcotics_register_v1.uuid_value(p_value jsonb) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value uuid;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 value:=(p_value#>>'{}')::uuid;
 IF value='00000000-0000-0000-0000-000000000000'::uuid OR value::text IS DISTINCT FROM p_value#>>'{}' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.instant_value(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE value timestamptz;raw text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 value:=raw::timestamptz;
 IF NOT isfinite(value) OR to_char(value,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>raw THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.utc(p_value timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT to_char(p_value,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION narcotics_register_v1.hash(p_domain text,p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('domain',p_domain,'value',p_value)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION narcotics_register_v1.text_value(p_value jsonb,p_limit integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(value) NOT BETWEEN 1 AND p_limit
 OR btrim(value)='' OR value ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.identity(p_actor uuid,p_admin boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;
BEGIN
 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 identity_value:=controlled_review_v3.protocol_identity(p_actor);
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
 OR (p_admin AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p_actor AND r.role='ADMIN')) THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN identity_value;
END $$;
CREATE FUNCTION narcotics_register_v1.authority(p_actor uuid,p_product uuid,p_site uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;authority_value jsonb;
BEGIN
 identity_value:=narcotics_register_v1.identity(p_actor,true);
 authority_value:=controlled_review_v3.ops_admin_authority(p_actor,p_product,'audit');
 IF NOT EXISTS(SELECT 1 FROM public.controlled_stock_sites s WHERE s.id=p_site)
 OR NOT EXISTS(SELECT 1 FROM public.controlled_stock_policy_sites s JOIN public.controlled_stock_policy_versions v ON v.id=s.policy_version_id WHERE v.product_id=p_product AND s.site_id=p_site) THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('identity',identity_value,'audit',authority_value);
END $$;
CREATE FUNCTION narcotics_register_v1.enter_register() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Dedicated admission precedes every old stock lock, including direct calls.
 PERFORM pg_advisory_xact_lock_shared(90271190,0);
 PERFORM pg_advisory_xact_lock(90271040,0);
 PERFORM controlled_count_entry_v1.acquire_shared_product_relation_frontier();
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_v1.require_module();
END $$;
CREATE FUNCTION narcotics_register_v1.operation_lock(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('narcotics-register-operation:'||p_id::text,0));END $$;
