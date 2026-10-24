-- Gate A extractor body. Protocol must retain this body unchanged and validate
-- the parent event before using it. No mutable head/location or policy-site fallbacks.
create function pg_temp.review_historical_site(p_event_id uuid)returns uuid
language plpgsql volatile set search_path=pg_catalog,public,pg_temp as $site$
declare target public.controlled_stock_events; total bigint; matched bigint;
 sites uuid[]; wrong_product boolean;
begin
 select * into strict target from public.controlled_stock_events where id=p_event_id;
 if target.event_kind not in('receive_inventory','adjust_inventory','record_native_dispense_return_v2:retract_disposal') then
  raise exception 'Unsupported secondary-review historical event kind' using errcode='23514';
 end if;
 select count(*),count(c.id),array_agg(distinct c.controlling_site_id),
  coalesce(bool_or(c.product_id is distinct from target.product_id),false)
 into total,matched,sites,wrong_product
 from public.controlled_stock_container_transitions t
 left join public.controlled_stock_containers c on c.id=t.container_id
 where t.event_id=target.id;
 if total=0 or matched<>total or wrong_product or cardinality(sites)<>1 or sites[1] is null then
  raise exception 'Exactly one retained controlling site is required' using errcode='23514';
 end if;
 return sites[1];
end
$site$;
