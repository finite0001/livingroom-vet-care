do $$declare request jsonb;args jsonb;context jsonb;containers jsonb;receipt jsonb;begin
 request:=jsonb_build_object('authorization_id',pg_temp.a2_id('pickup.sign'),'pet_id',pg_temp.a2_id('pet'),'dispense_id',pg_temp.a2_id('pickup.dispense'),
 'expected_context_hash',public.preview_native_pickup(pg_temp.a2_id('pickup.dispense'),pg_temp.a2_id('pet'),null)->>'context_hash',
 'recipient_name','Synthetic A2 recipient','recipient_relationship','Owner','reason','Synthetic A2 complete pickup','attest_handoff',true,'refill_close',null);
 args:=jsonb_build_object('request',request);
 -- Each explicit allocation maps to its own container and one -1.000 line.
 -- No adapter, current-position inference or full-effect duplication chooses it.
 select jsonb_agg(jsonb_build_object('id',pg_temp.a2_id('pickup.prepared'||n),'expected_version',0,'create',null,
 'after',jsonb_build_object('status','handed_off','location_id',null,'custodian_id',null),
 'lines',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.a2_id('pickup.lot'||n),'channel','prepared',
 'dispense_id',pg_temp.a2_id('pickup.dispense'),'intake_id',null,'quantity_delta','-1.000')))
 order by pg_temp.a2_id('pickup.prepared'||n))into containers from generate_series(1,2)n;
 context:=jsonb_build_object('version',1,'product_id',pg_temp.a2_id('pickup.product'),'policy_version_id',pg_temp.a2_id('pickup.policy'),
 'state_head_id',pg_temp.a2_id('pickup.active'),'opening_id',pg_temp.a2_id('pickup.opening'),
 'basis',jsonb_build_object('kind','physical_record','observed_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'note','Synthetic A2 complete pickup observation'),'containers',containers);
 perform public.prepare_controlled_stock_action(auth.uid(),pg_temp.a2_id('K_managed_pickup_of_188_package'),'record_native_pickup',args,context);
 receipt:=public.execute_controlled_stock_action(auth.uid(),pg_temp.a2_id('K_managed_pickup_of_188_package'));
 insert into a2_native_receipts values('K_managed_pickup_of_188_package',receipt);
end $$;
