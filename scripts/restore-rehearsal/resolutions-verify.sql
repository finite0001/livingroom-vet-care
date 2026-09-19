-- Read/retry and denied-write checks roll back, preserving all restored rows exactly.
begin;
insert into user_roles(user_id,role) values('__ACTOR__','ADMIN') on conflict do nothing;
do $verify$
declare d public.ezyvet_migration_resolutions;r jsonb;h jsonb;rejected boolean;before_rows jsonb;
begin
 perform set_config('request.jwt.claim.sub','__ACTOR__',true);
 select jsonb_agg(to_jsonb(x) order by id) into before_rows from ezyvet_migration_resolutions x;
 assert jsonb_array_length(before_rows)=4,'Both resolution chains must restore';
 for d in select * from ezyvet_migration_resolutions order by target_key,version loop
  r:=read_ezyvet_migration_resolution(d.id);
  assert r->>'record_hash'=d.record_hash and r->>'reviewed_context_hash'=d.reviewed_context_hash and r->'reviewed_context'=d.reviewed_context,'Restored receipt/context mismatch';
  assert r=save_ezyvet_migration_resolution(d.id,d.scope_id,d.target,d.action,d.reason,d.reviewed_context_hash,d.replaces_id),'Exact historical replay differs';
  assert d.reviewed_context_hash=encode(sha256(convert_to(d.reviewed_context::text,'UTF8')),'hex'),'Restored context hash differs';
  if d.version=2 then
   assert exists(select 1 from ezyvet_migration_resolutions p where p.id=d.replaces_id and p.target_key=d.target_key and p.version=1 and p.action='exclude'),'Restored predecessor differs';
   h:=list_ezyvet_migration_resolutions(d.scope_id,d.target,null,null,1);
   assert h->>'has_more'='true' and h#>>'{resolutions,0,receipt,id}'=d.id::text,'Restored latest history differs';
   h:=list_ezyvet_migration_resolutions(d.scope_id,d.target,(h#>>'{next_cursor,before_at}')::timestamptz,(h#>>'{next_cursor,before_id}')::uuid,1);
   assert h->>'has_more'='false' and h#>>'{resolutions,0,receipt,id}'=d.replaces_id::text,'Restored predecessor pagination differs';
  end if;
  rejected:=false;
  begin update ezyvet_migration_resolutions set reason='Forbidden rewrite' where id=d.id; exception when sqlstate '23514' then rejected:=true;end;
  assert rejected,'Restored immutable history guard missing';
 end loop;
 assert (select jsonb_agg(to_jsonb(x) order by id) from ezyvet_migration_resolutions x)=before_rows,'Recovery changed resolution rows';
 assert not has_function_privilege('anon','public.save_ezyvet_migration_resolution(uuid,uuid,jsonb,text,text,text,uuid)','execute'),'Anonymous save permission restored incorrectly';
 assert not has_function_privilege('service_role','public.save_ezyvet_migration_resolution(uuid,uuid,jsonb,text,text,text,uuid)','execute'),'Worker save permission restored incorrectly';
 assert not has_table_privilege('authenticated','public.ezyvet_migration_resolutions','INSERT,UPDATE,DELETE'),'Direct write grants restored incorrectly';
 -- Revocation must affect recovered history, not just new decisions.
 delete from user_roles where user_id='__ACTOR__' and role='ADMIN';
 rejected:=false;
 begin perform read_ezyvet_migration_resolution((select id from ezyvet_migration_resolutions limit 1));exception when sqlstate '42501' then rejected:=true;end;
 assert rejected,'Restored non-admin recovery must be denied';
end $verify$;
rollback;
