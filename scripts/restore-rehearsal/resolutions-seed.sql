-- Owned synthetic restore source only. Existing fixture actor receives a temporary role.
do $fixture$
declare a uuid:='__ACTOR__'; had_admin boolean;s public.ezyvet_migration_scopes;b uuid;i jsonb;t jsonb;c jsonb;prior jsonb;receipt jsonb;k text;
begin
 select exists(select 1 from user_roles where user_id=a and role='ADMIN') into had_admin;
 if not had_admin then insert into user_roles(user_id,role) values(a,'ADMIN');end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 for k in select unnest(array['scope','observation']) loop
  if k='scope' then
   select * into strict s from ezyvet_migration_scopes where resource='prescriptionitem' and disposition='excluded';
   t:=jsonb_build_object('kind','scope','binding_id',null,'page',null,'ordinal',null,'snapshot_id',null,'evidence_hash',null);
  else
   select * into strict s from ezyvet_migration_scopes where resource='attachment';
   select id into strict b from ezyvet_migration_bindings where scope_id=s.id;
   i:=list_ezyvet_migration_items(b)->'items'->0;
   t:=jsonb_build_object('kind','observation','binding_id',b,'page',(i->>'page')::integer,'ordinal',(i->>'ordinal')::integer,'snapshot_id',i->>'snapshot_id','evidence_hash',i->>'evidence_hash');
  end if;
  c:=read_ezyvet_migration_resolution_context(s.id,t);
  prior:=save_ezyvet_migration_resolution(gen_random_uuid(),s.id,t,'exclude','Synthetic restore exclusion',c->>'context_hash',null);
  c:=read_ezyvet_migration_resolution_context(s.id,t);
  receipt:=save_ezyvet_migration_resolution(gen_random_uuid(),s.id,t,'reopen','Synthetic restore reopened review',c->>'context_hash',(prior->>'id')::uuid);
  assert receipt->>'version'='2' and receipt->>'replaces_id'=prior->>'id','Expected two-version restore chain';
 end loop;
 assert (select count(*) from ezyvet_migration_resolutions)=4,'Expected both populated resolution chains';
 if not had_admin then delete from user_roles where user_id=a and role='ADMIN';end if;
end $fixture$;
