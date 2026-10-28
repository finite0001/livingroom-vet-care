CREATE FUNCTION narcotics_register_v1.result_of(p_operation uuid,p_actor uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE operation_value narcotics_register_v1.operations;report_value narcotics_register_v1.reports;
 form_value narcotics_register_v1.form_records;content_value narcotics_register_v1.form_contents;
 dataset jsonb;kind_value text;before_authority jsonb;request_value jsonb;data_value jsonb;
BEGIN
 SELECT * INTO operation_value FROM narcotics_register_v1.operations o WHERE o.operation_id=p_operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('schema_version',1,'state','not_found','kind',p_kind,'operation_id',p_operation);END IF;
 IF operation_value.actor_id<>p_actor OR operation_value.kind<>p_kind THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 before_authority:=narcotics_register_v1.authority(p_actor,operation_value.product_id,operation_value.site_id);
 IF operation_value.state='abandoned' THEN RETURN jsonb_build_object('schema_version',1,'state','abandoned','kind',p_kind,'operation_id',p_operation);END IF;
 IF p_kind='report' THEN
  SELECT * INTO STRICT report_value FROM narcotics_register_v1.reports r WHERE r.report_id=p_operation;
  dataset:=report_value.dataset_text::jsonb;
  IF dataset->'request' IS DISTINCT FROM operation_value.original_request OR dataset->>'report_id'<>p_operation::text
  OR report_value.dataset_hash<>encode(sha256(convert_to(report_value.dataset_text,'UTF8')),'hex')
  OR report_value.csv_hash<>encode(sha256(convert_to(report_value.csv_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  FOR kind_value IN SELECT jsonb_array_elements_text(dataset->'authorization_kinds') LOOP
   PERFORM controlled_review_v3.read_scope_authorization(p_actor,operation_value.product_id,operation_value.site_id,kind_value,false);
  END LOOP;
  IF jsonb_array_length(dataset->'counts')>0 THEN PERFORM controlled_count_v1.current_principal(p_actor,operation_value.product_id,operation_value.site_id,'read');END IF;
  request_value:=operation_value.original_request;
  data_value:=jsonb_build_object('captured_at',narcotics_register_v1.utc(report_value.captured_at),'dataset_text',report_value.dataset_text,'dataset_hash',report_value.dataset_hash,
   'dataset_utf8_bytes',octet_length(report_value.dataset_text),'csv_text',report_value.csv_text,'csv_hash',report_value.csv_hash,'csv_utf8_bytes',octet_length(report_value.csv_text));
 ELSIF p_kind='form' THEN
  SELECT * INTO STRICT form_value FROM narcotics_register_v1.form_records f WHERE f.operation_id=p_operation;
  SELECT * INTO STRICT content_value FROM narcotics_register_v1.form_contents c WHERE c.form_id=form_value.form_id;
  IF form_value.actor_id<>p_actor OR form_value.product_id<>operation_value.product_id OR form_value.site_id<>operation_value.site_id
  OR form_value.document_hash<>encode(sha256(convert_to(form_value.document_text,'UTF8')),'hex')
  OR content_value.sha256<>encode(sha256(content_value.original_bytes),'hex') OR content_value.byte_length<>octet_length(content_value.original_bytes) THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  IF form_value.event_id IS NOT NULL THEN PERFORM narcotics_register_v1.event_authority(p_actor,form_value.product_id,form_value.site_id,form_value.event_id);END IF;
  request_value:=operation_value.original_request||jsonb_build_object('base64',replace(encode(content_value.original_bytes,'base64'),E'\n',''));
  data_value:=jsonb_build_object('form_id',form_value.form_id,'document_text',form_value.document_text,'document_hash',form_value.document_hash,
   'sha256',content_value.sha256,'byte_length',content_value.byte_length,'mime',content_value.mime,'filename',form_value.filename);
 ELSE RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 IF operation_value.request_hash<>narcotics_register_v1.hash('narcotics-register-'||p_kind||'-request-v1',request_value)
 OR narcotics_register_v1.authority(p_actor,operation_value.product_id,operation_value.site_id) IS DISTINCT FROM before_authority THEN
 RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('schema_version',1,'state','saved','kind',p_kind,'operation_id',p_operation,'actor_id',p_actor,
  'original_session_id',operation_value.session_id,'recorded_at',narcotics_register_v1.utc(operation_value.recorded_at),
  'request_metadata',operation_value.original_request,'request_hash',operation_value.request_hash,'data',data_value);
END $$;
CREATE FUNCTION narcotics_register_v1.read_operation(p_request jsonb,p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.identity(actor_value,true);
 PERFORM narcotics_register_v1.operation_lock(operation_value);
 RETURN narcotics_register_v1.result_of(operation_value,actor_value,p_kind);
END $$;
CREATE FUNCTION narcotics_register_v1.close_operation(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;kind_value text;identity_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','kind']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' OR p_request->>'kind' NOT IN ('report','form') THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');kind_value:=p_request->>'kind';
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_v1.operation_lock(operation_value);
 IF NOT EXISTS(SELECT 1 FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value) THEN
  identity_value:=narcotics_register_v1.identity(actor_value,true);
  INSERT INTO narcotics_register_v1.operations(operation_id,actor_id,kind,product_id,site_id,state,session_id,recorded_at)
  VALUES(operation_value,actor_value,kind_value,product_value,site_value,'abandoned',(identity_value->>'session_id')::uuid,clock_timestamp());
 ELSE
  IF NOT EXISTS(SELECT 1 FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value AND o.product_id=product_value AND o.site_id=site_value) THEN RAISE EXCEPTION 'narcotics_request_mismatch' USING ERRCODE='22023';END IF;
 END IF;
 RETURN narcotics_register_v1.result_of(operation_value,actor_value,kind_value);
END $$;
CREATE FUNCTION narcotics_register_v1.create_report(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;identity_value jsonb;prior narcotics_register_v1.operations;
 dataset_value jsonb;dataset_text text;csv_text text;request_hash text;response_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','from_at','to_at']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_v1.operation_lock(operation_value);
 request_hash:=narcotics_register_v1.hash('narcotics-register-report-request-v1',p_request);
 SELECT * INTO prior FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value;
 IF FOUND THEN
  IF prior.state<>'saved' OR prior.kind<>'report' OR prior.actor_id<>actor_value OR prior.request_hash<>request_hash OR prior.original_request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'narcotics_request_closed_or_changed' USING ERRCODE='PT409';END IF;
  RETURN narcotics_register_v1.result_of(operation_value,actor_value,'report');
 END IF;
 dataset_value:=narcotics_register_v1.make_dataset(p_request);dataset_text:=dataset_value::text;csv_text:=narcotics_register_v1.csv(dataset_value);
 identity_value:=narcotics_register_v1.identity(actor_value,true);
 INSERT INTO narcotics_register_v1.operations VALUES(operation_value,actor_value,'report',product_value,site_value,'saved',p_request,request_hash,(identity_value->>'session_id')::uuid,clock_timestamp());
 INSERT INTO narcotics_register_v1.reports VALUES(operation_value,(dataset_value->>'captured_at')::timestamptz,dataset_text,encode(sha256(convert_to(dataset_text,'UTF8')),'hex'),csv_text,encode(sha256(convert_to(csv_text,'UTF8')),'hex'));
 response_value:=narcotics_register_v1.result_of(operation_value,actor_value,'report');
 IF octet_length(response_value::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN response_value;
END $$;
CREATE FUNCTION narcotics_register_v1.form_bytes(p_mime text,p_base64 text) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value bytea;length_value integer;
BEGIN
 IF p_base64 IS NULL OR length(p_base64) NOT BETWEEN 4 AND 2796204 OR length(p_base64)%4<>0
 OR p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' OR p_mime NOT IN ('application/pdf','image/png','image/jpeg') THEN RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 value:=decode(p_base64,'base64');length_value:=octet_length(value);
 IF length_value NOT BETWEEN 1 AND 2097152 OR replace(encode(value,'base64'),E'\n','')<>p_base64 THEN RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 IF (p_mime='application/pdf' AND(substring(value FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') OR position(convert_to('%%EOF','UTF8') IN substring(value FROM greatest(1,length_value-64)))=0))
 OR(p_mime='image/png' AND(substring(value FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') OR substring(value FROM length_value-11 FOR 12)<>decode('0000000049454e44ae426082','hex')))
 OR(p_mime='image/jpeg' AND(substring(value FROM 1 FOR 3)<>decode('ffd8ff','hex') OR substring(value FROM length_value-1 FOR 2)<>decode('ffd9','hex'))) THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.preserve_form(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;event_value uuid;
 kind_value text;title_value text;filename_value text;mime_value text;obtained_value timestamptz;recorded_value timestamptz;
 raw_value bytea;raw_hash text;request_hash text;event_hash text;identity_value jsonb;authority_value jsonb;prior narcotics_register_v1.operations;document_value jsonb;document_text text;
BEGIN
 IF octet_length(p_request::text)>3145728 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','event_id','kind','title','filename','obtained_at','mime','base64']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');
 IF p_request->'event_id'<>'null'::jsonb THEN event_value:=narcotics_register_v1.uuid_value(p_request->'event_id');END IF;
 kind_value:=narcotics_register_v1.text_value(p_request->'kind',32);title_value:=narcotics_register_v1.text_value(p_request->'title',200);filename_value:=narcotics_register_v1.text_value(p_request->'filename',200);
 IF kind_value NOT IN ('supplier_receipt','registration','order_form','other') OR filename_value ~ '[/\\]' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 obtained_value:=narcotics_register_v1.instant_value(p_request->'obtained_at');mime_value:=narcotics_register_v1.text_value(p_request->'mime',100);
 IF obtained_value>clock_timestamp() OR jsonb_typeof(p_request->'base64') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 raw_value:=narcotics_register_v1.form_bytes(mime_value,p_request->>'base64');raw_hash:=encode(sha256(raw_value),'hex');request_hash:=narcotics_register_v1.hash('narcotics-register-form-request-v1',p_request);
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();authority_value:=narcotics_register_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_v1.operation_lock(operation_value);
 SELECT * INTO prior FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value;
 IF FOUND THEN
  IF prior.state<>'saved' OR prior.kind<>'form' OR prior.actor_id<>actor_value OR prior.request_hash<>request_hash OR prior.original_request IS DISTINCT FROM p_request-'base64' THEN RAISE EXCEPTION 'narcotics_request_closed_or_changed' USING ERRCODE='PT409';END IF;
  RETURN narcotics_register_v1.result_of(operation_value,actor_value,'form');
 END IF;
 IF event_value IS NOT NULL THEN
  PERFORM narcotics_register_v1.event_authority(actor_value,product_value,site_value,event_value);
  PERFORM controlled_review_v3.read_scalar_base(controlled_review_v3.read_collect_visible_scalar(event_value));
  SELECT e.record_hash INTO STRICT event_hash FROM public.controlled_stock_events e WHERE e.id=event_value;
 END IF;
 identity_value:=narcotics_register_v1.identity(actor_value,true);recorded_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'form_id',operation_value,'operation_id',operation_value,'request_metadata',p_request-'base64','request_hash',request_hash,
  'actor_id',actor_value,'session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(recorded_value),'obtained_at_basis','staff_reported',
  'event_hash',event_hash,'sha256',raw_hash,'byte_length',octet_length(raw_value),'mime',mime_value);
 document_text:=document_value::text;
 IF narcotics_register_v1.authority(actor_value,product_value,site_value) IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 INSERT INTO narcotics_register_v1.operations VALUES(operation_value,actor_value,'form',product_value,site_value,'saved',p_request-'base64',request_hash,(identity_value->>'session_id')::uuid,recorded_value);
 INSERT INTO narcotics_register_v1.form_contents VALUES(operation_value,raw_value,mime_value,octet_length(raw_value),raw_hash);
 INSERT INTO narcotics_register_v1.form_records VALUES(operation_value,operation_value,actor_value,(identity_value->>'session_id')::uuid,product_value,site_value,event_value,event_hash,kind_value,title_value,filename_value,obtained_value,recorded_value,document_text,encode(sha256(convert_to(document_text,'UTF8')),'hex'));
 RETURN narcotics_register_v1.result_of(operation_value,actor_value,'form');
END $$;
CREATE FUNCTION narcotics_register_v1.download_form(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;form_id_value uuid;form_value narcotics_register_v1.form_records;content_value narcotics_register_v1.form_contents;authority_value jsonb;data_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','form_id']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');form_id_value:=narcotics_register_v1.uuid_value(p_request->'form_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.identity(actor_value,true);
 SELECT * INTO STRICT form_value FROM narcotics_register_v1.form_records f WHERE f.form_id=form_id_value;
 authority_value:=narcotics_register_v1.authority(actor_value,form_value.product_id,form_value.site_id);
 IF form_value.event_id IS NOT NULL THEN PERFORM narcotics_register_v1.event_authority(actor_value,form_value.product_id,form_value.site_id,form_value.event_id);END IF;
 SELECT * INTO STRICT content_value FROM narcotics_register_v1.form_contents c WHERE c.form_id=form_id_value;
 IF content_value.sha256<>encode(sha256(content_value.original_bytes),'hex') OR content_value.byte_length<>octet_length(content_value.original_bytes)
 OR form_value.document_hash<>encode(sha256(convert_to(form_value.document_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
 data_value:=jsonb_build_object('schema_version',1,'form_id',form_id_value,'filename',form_value.filename,'mime',content_value.mime,'byte_length',content_value.byte_length,
  'sha256',content_value.sha256,'base64',replace(encode(content_value.original_bytes,'base64'),E'\n',''),'document_text',form_value.document_text,'document_hash',form_value.document_hash);
 IF narcotics_register_v1.authority(actor_value,form_value.product_id,form_value.site_id) IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN data_value;
END $$;
