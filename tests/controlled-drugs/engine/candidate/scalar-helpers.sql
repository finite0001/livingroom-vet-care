-- PRIVATE LOCAL CANDIDATE ONLY. These three original scalar helpers deliberately
-- change from SQL to PL/pgSQL to bound retained SQL-function execution memory.
-- Every expression, argument/return type, IMMUTABLE classification, non-STRICT
-- invocation, SECURITY INVOKER and search_path=public is preserved. The installer
-- must first verify the unchanged trusted original catalog; independent captured
-- SQL oracles verify results and all other pg_proc attributes after installation.
-- CREATE OR REPLACE preserves existing owner/ACL. No UTC override, grants,
-- canonical migration, trusted-reference regeneration or hosted installation.
create or replace function public.native_fulfillment_hash(v jsonb)returns text
language plpgsql immutable security invoker set search_path=public as $$
begin
 return encode(sha256(convert_to(v::text,'UTF8')),'hex');
end$$;
create or replace function public.native_fulfillment_decimal(n numeric)returns text
language plpgsql immutable security invoker set search_path=public as $$
begin
 return to_char(n,'FM999999999999999999999999999999990.000');
end$$;
create or replace function public.native_fulfillment_receipt(r public.native_fulfillment_operations)returns jsonb
language plpgsql immutable security invoker set search_path=public as $$
begin
 return jsonb_build_object('version',1,'id',r.id,'actor_id',r.actor_id,'operation',r.operation,'request',r.request,'request_hash',r.request_hash,'result',r.result,'created_at',r.created_at);
end$$;
