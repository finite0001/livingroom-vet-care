create function public.search_inventory_products(p_search text default '',p_limit integer default 101) returns setof public.catalog_products language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if length(p_search)>200 then raise exception 'Search is too long' using errcode='23514'; end if;
 return query select * from public.catalog_products where strpos(lower(name||' '||manufacturer),lower(coalesce(p_search,'')))>0 order by name,id limit greatest(1,least(coalesce(p_limit,101),101));
end $$;
create function public.inventory_lot_balances(p_search text default '',p_product_id uuid default null,p_limit integer default 101)
returns table(id uuid,product_id uuid,product_name text,kind text,unit text,active boolean,lot_number text,expires_on date,location text,balance numeric) language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if length(p_search)>200 then raise exception 'Search is too long' using errcode='23514'; end if;
 return query select l.id,l.product_id,p.name,p.kind,p.unit,p.active,l.lot_number,l.expires_on,l.location,coalesce((select sum(m.quantity) from public.inventory_movements m where m.lot_id=l.id),0)
 from public.inventory_lots l join public.catalog_products p on p.id=l.product_id
 where (p_product_id is null or l.product_id=p_product_id) and strpos(lower(p.name||' '||l.lot_number||' '||l.location),lower(coalesce(p_search,'')))>0
 order by l.expires_on,l.id limit greatest(1,least(coalesce(p_limit,101),101));
end $$;
create function public.create_inventory_product(p_id uuid,p_name text,p_kind text,p_manufacturer text,p_unit text,p_unit_price_cents bigint) returns public.catalog_products language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.catalog_products;
begin
 insert into public.catalog_products(id,name,kind,manufacturer,unit,unit_price_cents,created_by) values(p_id,trim(p_name),p_kind,coalesce(p_manufacturer,''),p_unit,p_unit_price_cents,actor) on conflict(id) do nothing;
 select * into result from public.catalog_products where id=p_id;
 if result.created_by<>actor or row(result.name,result.kind,result.manufacturer,result.unit,result.unit_price_cents) is distinct from row(trim(p_name),p_kind,coalesce(p_manufacturer,''),p_unit,p_unit_price_cents) then raise exception 'Product identifier already used with different metadata' using errcode='23514'; end if;
 return result;
end $$;
revoke all on function public.search_inventory_products(text,integer),public.inventory_lot_balances(text,uuid,integer),public.create_inventory_product(uuid,text,text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.search_inventory_products(text,integer),public.inventory_lot_balances(text,uuid,integer),public.create_inventory_product(uuid,text,text,text,text,bigint) to authenticated;
