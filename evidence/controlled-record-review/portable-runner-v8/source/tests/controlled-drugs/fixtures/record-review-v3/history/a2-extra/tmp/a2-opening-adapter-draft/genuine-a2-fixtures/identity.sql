create function pg_temp.a2_identity(expected text) returns void language plpgsql as $$
declare claims jsonb; begin
 if session_user<>'postgres' or current_setting('session_replication_role')<>'origin'
 or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
 or nullif(current_setting('request.jwt.claim.role',true),'') is not null
 or nullif(current_setting('request.jwt.claim.email',true),'') is not null then
 raise exception 'A2 exact ordinary session and legacy JWT state required' using errcode='23514';end if;
 if expected='ordinary' then
  if current_user<>'postgres' or current_setting('role')<>'none' or auth.uid() is not null or auth.role() is not null or auth.email() is not null
  or nullif(current_setting('request.jwt.claims',true),'') is not null then raise exception 'A2 ordinary identity differs' using errcode='23514';end if;
 elsif expected in('historical_writer','controlled_owner') then
  claims:=jsonb_build_object('sub',pg_temp.a2_id('actor'),'role','authenticated');
  if expected='controlled_owner' then claims:=claims||jsonb_build_object('session_id',pg_temp.a2_id('session'));end if;
  if current_user<>(case expected when 'historical_writer' then 'authenticated' else 'postgres' end)
  or current_setting('role')<>(case expected when 'historical_writer' then 'authenticated' else 'none' end)
  or current_setting('request.jwt.claims',true)::jsonb is distinct from claims
  or auth.uid() is distinct from pg_temp.a2_id('actor') or auth.role() is distinct from 'authenticated' or auth.email() is not null then
  raise exception 'A2 fixed synthetic writer identity differs' using errcode='23514';end if;
 else raise exception 'A2 undeclared identity mode' using errcode='23514';end if;
end $$;
