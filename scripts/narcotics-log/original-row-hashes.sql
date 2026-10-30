-- Read-only permanent-row observation; no expected metadata/data is generated.
-- Temporary observer lives only in this separate psql connection, never in an
-- application/constructor session. Exact JSONB text hashes retain numeric scale.
create function pg_temp.closed_row_hashes()returns jsonb language plpgsql as $observe$
 declare r record;value jsonb;result jsonb:='{}';n bigint;total bigint:=0;tables integer:=0;
 begin
  for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_v3')and c.relkind in('r','p')order by n.nspname collate "C",c.relname collate "C"loop
   tables:=tables+1;if tables>1024 then raise exception 'Prototype table bound exceeded';end if;
   execute format('select count(*)from %I.%I',r.nspname,r.relname)into n;
   total:=total+n;if n>10000 or total>100000 then raise exception 'Prototype row bound exceeded';end if;
   execute format('select coalesce(jsonb_agg(h order by h),''[]'')from(select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')as h from %I.%I t)hashed',r.nspname,r.relname)into value;
   result:=result||jsonb_build_object(r.nspname||'.'||r.relname,value);
  end loop;
  if octet_length(result::text)>16777216 then raise exception 'Prototype row observation bound exceeded';end if;
  return result;
 end$observe$;
select pg_temp.closed_row_hashes();
