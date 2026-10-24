insert into a2_ids select '__LABEL__.product',id from save_catalog_product(null,null,'A2 __LABEL__ synthetic medication','medication','','tablet',100,true);
select save_native_prescription_draft(pg_temp.a2_id('__LABEL__.save'),jsonb_build_object('draft_id',pg_temp.a2_id('__LABEL__.draft'),
 'pet_id',pg_temp.a2_id('pet'),'client_id',pg_temp.a2_id('client'),'expected_version',null,'fields',jsonb_build_object(
 'encounter_id',null,'medication',jsonb_build_object('name','A2 __LABEL__ synthetic medication','strength','Synthetic strength','form','Synthetic form',
 'directions','Synthetic directions only','route','Synthetic route'),'quantity_per_fill','2','unit','tablet','refills_authorized',0,
 'fulfillment_mode','practice_stock','product_id',pg_temp.a2_id('__LABEL__.product'),'starts_on',(now() at time zone 'America/Denver')::date,'expires_on','2099-12-31')));
select sign_native_prescription(pg_temp.a2_id('__LABEL__.sign'),jsonb_build_object('draft_id',pg_temp.a2_id('__LABEL__.draft'),'pet_id',pg_temp.a2_id('pet'),
 'expected_version',1,'expected_context_hash',preview_native_prescription_sign(pg_temp.a2_id('__LABEL__.draft'),1)->>'context_hash',
 'signature_name','Synthetic a2 prescriber','attest_review',true));
select receive_inventory(pg_temp.a2_id('__LABEL__.receive1'),pg_temp.a2_id('__LABEL__.lot1'),pg_temp.a2_id('__LABEL__.product'),'A2-__LABEL__-1',current_date+365,'Synthetic local fixture',3.000,'Synthetic genuine188 receipt');
select receive_inventory(pg_temp.a2_id('__LABEL__.receive2'),pg_temp.a2_id('__LABEL__.lot2'),pg_temp.a2_id('__LABEL__.product'),'A2-__LABEL__-2',current_date+365,'Synthetic local fixture',3.000,'Synthetic genuine188 receipt');
select create_billing_invoice(pg_temp.a2_id('__LABEL__.invoice'),pg_temp.a2_id('client'));
insert into a2_data values('__LABEL__.dispense',jsonb_build_object('authorization_id',pg_temp.a2_id('__LABEL__.sign'),'pet_id',pg_temp.a2_id('pet'),
 'slot_index',0,'expected_slot_version',null,'invoice_id',pg_temp.a2_id('__LABEL__.invoice'),'quantity','2.000',
 'allocations',(select jsonb_agg(jsonb_build_object('lot_id',pg_temp.a2_id('__LABEL__.lot'||n),'quantity','1.000')order by pg_temp.a2_id('__LABEL__.lot'||n))from generate_series(1,2)n),'refill',null));
select record_native_dispense(pg_temp.a2_id('__LABEL__.dispense'),v||jsonb_build_object('expected_context_hash',preview_native_dispense(v)->>'context_hash',
 'reason','Synthetic genuine188 dispense','attest_alert_review',true,'attest_dispense_review',true)) from a2_data where k='__LABEL__.dispense';

insert into a2_ids select '__LABEL__.allocation'||n,a.id from generate_series(1,2)n join public.native_dispense_allocations a
 on a.dispense_id=pg_temp.a2_id('__LABEL__.dispense') and a.lot_id=pg_temp.a2_id('__LABEL__.lot'||n);
insert into a2_ids select '__LABEL__.movement'||n,a.movement_id from generate_series(1,2)n join public.native_dispense_allocations a
 on a.id=pg_temp.a2_id('__LABEL__.allocation'||n);
insert into a2_ids select '__LABEL__.charge',invoice_item_id from public.native_dispenses where id=pg_temp.a2_id('__LABEL__.dispense');
