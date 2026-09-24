-- Preserve alert/patient and invoice locks; acquire product before lot for current care.
-- Lot metadata is immutable and undeletable, so an unlocked identity discovery is safe.
-- Receiving already uses product SHARE -> lot UPDATE. Adjustment locks only its lot
-- and never waits for product, so it introduces no reverse product edge.
do $$
declare definition text;old_block text;new_block text;signature text;gate text;
begin
 old_block:=E'  select * into lot from public.inventory_lots where id=(p_request->>''lot_id'')::uuid for update;\n  if not found then raise exception ''Lot not found'' using errcode=''23514''; end if;\n  select * into product from public.catalog_products where id=lot.product_id for share;';
 new_block:=E'  select * into lot from public.inventory_lots where id=(p_request->>''lot_id'')::uuid;\n  if not found then raise exception ''Lot not found'' using errcode=''23514''; end if;\n  select * into product from public.catalog_products where id=lot.product_id for share;\n  select * into lot from public.inventory_lots where id=(p_request->>''lot_id'')::uuid for update;\n  if not found or lot.product_id is distinct from product.id then raise exception ''Lot identity changed'' using errcode=''40001'';end if;';
 select pg_get_functiondef('public.record_patient_treatment(uuid,jsonb)'::regprocedure) into definition;
 if position(old_block in definition)=0 or position('alert_bundle:=public.read_patient_treatment_alerts(pet)' in definition)=0 or position('insert into public.treatment_alert_reviews' in definition)=0 then raise exception 'Treatment definition drifted; inventory locking patch requires review';end if;
 definition:=replace(definition,old_block,new_block);execute definition;
 -- A role revoked while waiting for request serialization must not recover or write.
 gate:=' perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));';
 foreach signature in array array['public.record_patient_treatment(uuid,jsonb)','public.receive_inventory(uuid,uuid,uuid,text,date,text,numeric,text)','public.adjust_inventory(uuid,uuid,numeric,text)'] loop
 select pg_get_functiondef(signature::regprocedure) into definition;
 if position(gate in definition)=0 or position(gate||E'\n perform public.clinical_require_staff();' in definition)>0 then raise exception 'Inventory request gate definition drifted for %',signature;end if;
 definition:=replace(definition,gate,gate||E'\n perform public.clinical_require_staff();');execute definition;
 end loop;
end $$;
