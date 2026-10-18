-- OWNED LOCAL ONLY. No source rows are fabricated, repaired, or backfilled.
-- HISTORY_SEED_BEGIN
begin;set local timezone='__WRITER_TIMEZONE__';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);
insert into fx select k,gen_random_uuid()from unnest(array['history_foreign_draft','history_foreign_save','history_foreign_sign',
 'history_foreign_lot','history_foreign_receive','history_foreign_dispense'])k;
insert into fx select 'history_foreign_product',id from save_catalog_product(null,null,'Synthetic second product','medication','','tablet',100,true);
select receive_inventory(pg_temp.oid('history_foreign_receive'),pg_temp.oid('history_foreign_lot'),pg_temp.oid('history_foreign_product'),
 'SYNTHETIC-FOREIGN-LOT',current_date+365,'Synthetic clinic',20,'Synthetic independent foreign product stock');
select save_native_prescription_draft(pg_temp.oid('history_foreign_save'),jsonb_build_object('draft_id',pg_temp.oid('history_foreign_draft'),
 'pet_id',pg_temp.oid('pet'),'client_id',pg_temp.oid('client'),'expected_version',null,
 'fields',(select v||jsonb_build_object('product_id',pg_temp.oid('history_foreign_product'),'medication',(v->'medication')||'{"name":"Synthetic second product"}')from data where k='fields')));
select sign_native_prescription(pg_temp.oid('history_foreign_sign'),jsonb_build_object('draft_id',pg_temp.oid('history_foreign_draft'),
 'pet_id',pg_temp.oid('pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign(pg_temp.oid('history_foreign_draft'),1)->>'context_hash',
 'signature_name','Synthetic prescriber','attest_review',true));
select record_native_dispense(pg_temp.oid('history_foreign_dispense'),t||jsonb_build_object('expected_context_hash',preview_native_dispense(t)->>'context_hash',
 'reason','Synthetic actual foreign-product dispensing','attest_alert_review',true,'attest_dispense_review',true))
 from(select jsonb_build_object('authorization_id',pg_temp.oid('history_foreign_sign'),'pet_id',pg_temp.oid('pet'),'slot_index',0,'expected_slot_version',null,
 'invoice_id',pg_temp.oid('invoice'),'quantity','2','allocations',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.oid('history_foreign_lot'),'quantity','2')),'refill',null)t)s;
create function pg_temp.opening_history_sources()returns jsonb language plpgsql stable set timezone='UTC' as $$declare r record;v jsonb;result jsonb:='{}';begin
 for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind in('r','p')
 and(c.relname like 'native_%'or c.relname in('inventory_movements','billing_invoice_items','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources','stock_pickup_sources','stock_correction_sources'))order by c.relname loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from public.%I t',r.relname)into v;
 result:=result||jsonb_build_object(r.relname,v);end loop;return result;end$$;
create temp table opening_history_original_sources(value jsonb);
insert into opening_history_original_sources values(pg_temp.opening_history_sources());
commit;
-- HISTORY_SEED_END

-- HISTORY_ACCEPTANCE_BEGIN
create temp table opening_history_rejections(label text primary key,failure_detail text not null);
create temp table opening_history_assertions(label text primary key);
create function pg_temp.opening_history_assert(value boolean,label text)returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Historical opening assertion failed: %',label;end if;
 insert into opening_history_assertions values(label);end$$;
create function pg_temp.opening_history_reject(label text,command text,expected text)returns void language plpgsql volatile as $$
 declare before_value jsonb:=pg_temp.opening_snapshot();manifest jsonb:=controlled_stock_manifest_snapshot();armed boolean:=false;failure text;begin
 begin
 execute command;armed:=true;perform controlled_stock_validate_opening(pg_temp.oid('engine_opening'));set constraints all immediate;
 raise exception 'Historical mutation unexpectedly accepted: %',label using errcode='P0002';
 exception when check_violation then
 if not armed then raise exception 'Historical mutation blocked before independent validation: %',label using errcode='P0003';end if;
 get stacked diagnostics failure=MESSAGE_TEXT;
 if position(expected in failure)=0 then raise exception 'Wrong historical invariant for %: %',label,failure using errcode='P0003';end if;
 end;
 if before_value is distinct from pg_temp.opening_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then
 raise exception 'Historical corruption probe did not roll back exactly: %',label;end if;
 insert into opening_history_rejections values(label,failure);
end$$;
select pg_temp.opening_history_assert(pg_temp.opening_history_sources()=(select value from opening_history_original_sources),'original native documents operations source hashes unchanged during opening construction');
select pg_temp.opening_history_assert((select count(*)from native_dispenses where id=pg_temp.oid('history_foreign_dispense'))=1,'genuinely populated second product dispense exists');
select pg_temp.opening_history_assert((select unit from catalog_products where id=pg_temp.oid('history_foreign_product'))=(select unit from catalog_products where id=pg_temp.oid('product')),'foreign product uses the same stock unit');
select pg_temp.opening_history_assert(controlled_stock_opening_native_entry_for_product(pg_temp.oid('history_foreign_product'),'tablet',pg_temp.oid('history_foreign_dispense'),0,0,0,null)->>'dispense_id'=pg_temp.oid('history_foreign_dispense')::text,'foreign dispense independently has valid complete canonical provenance');
select pg_temp.opening_history_assert((select count(*)from stock_movement_sources s join native_dispense_allocations a on a.movement_id=s.movement_id where a.dispense_id=pg_temp.oid('history_foreign_dispense')and s.source_id=pg_temp.oid('history_foreign_dispense')and s.writer='record_native_dispense')=1,'foreign movement has its real independent source ID');
-- IDs below all refer to real, independently verified other-product history.
select pg_temp.opening_history_reject('actual_foreign_dispense',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,dispense_id}',to_jsonb(pg_temp.oid('history_foreign_dispense')::text))$q$,'Exact original opening dispense operation, product and stock unit required');
select pg_temp.opening_history_reject('actual_foreign_allocation',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,allocations,0,allocation_id}',to_jsonb((select id::text from native_dispense_allocations where dispense_id=pg_temp.oid('history_foreign_dispense'))))$q$,'Stored opening custody must equal the canonical retained native prefix');
select pg_temp.opening_history_reject('actual_foreign_movement',$q$insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)select pg_temp.oid('engine_opening'),m.id,m.lot_id,m.quantity,to_jsonb(m)from inventory_movements m join native_dispense_allocations a on a.movement_id=m.id where a.dispense_id=pg_temp.oid('history_foreign_dispense')$q$,'Exact original opening movement snapshots required');
select pg_temp.opening_history_reject('actual_foreign_source_id',$q$alter table stock_movement_sources disable trigger immutable;update stock_movement_sources set source_id=pg_temp.oid('history_foreign_dispense')where movement_id=(select movement_id from native_dispense_allocations where dispense_id=pg_temp.oid('dispense')limit 1)$q$,'Canonical stock source does not match movement');
select pg_temp.opening_history_reject('actual_foreign_lot_cell',$q$alter table controlled_stock_cells disable trigger immutable;update controlled_stock_cells set lot_id=pg_temp.oid('history_foreign_lot')where id=(select id from controlled_stock_cells where channel='prepared'and dispense_id=pg_temp.oid('dispense')limit 1)$q$,'Exact opening container/cell product, unit and provenance required');
-- Each timestamp mutation changes only a result-slot field; original doc remains.
-- Typed frame checks must reject invalid encodings or a different instant.
do $$declare kind text;path text;value jsonb;command text;expected text;begin
 foreach kind in array array['opened_changed_instant','closed_changed_instant','opened_missing','closed_missing','opened_null','closed_null',
 'opened_malformed','closed_malformed','opened_no_offset','closed_no_offset','opened_infinity','closed_infinity','opened_number','closed_number','non_time_slot_field','extra_slot_key']loop
 path:=case when kind like 'closed_%'then 'closed_at'else 'opened_at'end;
 if kind in('opened_changed_instant','closed_changed_instant')then
 value:=to_jsonb('2031-01-01T00:00:00+00:00'::text);
 elsif kind like '%_null'then value:='null';
 elsif kind like '%_malformed'then value:=to_jsonb('not-a-timestamp'::text);
 elsif kind like '%_no_offset'then value:=to_jsonb('2026-10-18T12:00:00'::text);
 elsif kind like '%_infinity'then value:=to_jsonb('infinity'::text);
 elsif kind like '%_number'then value:='123';
 else value:=null;end if;
 expected:='Original dispense slot timestamps must retain exact finite instants';
 if kind like '%_missing'then
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{slot}'',(result->''slot'')-%L)where id=%L::uuid',path,case when kind like 'closed_%'then pg_temp.oid('dispense3')else pg_temp.oid('dispense')end);
 expected:='Original dispense result must retain its exact slot and refill frame';
 elsif kind='non_time_slot_field'then
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{slot,remaining_quantity}'',''"123.000"'')where id=%L::uuid',pg_temp.oid('dispense'));
 expected:='Original dispense result must retain its exact slot and refill frame';
 elsif kind='extra_slot_key'then
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{slot,extra_key}'',''true'')where id=%L::uuid',pg_temp.oid('dispense'));
 expected:='Original dispense result must retain its exact slot and refill frame';
 else
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,array[''slot'',%L],%L::jsonb)where id=%L::uuid',path,value::text,case when kind like 'closed_%'then pg_temp.oid('dispense3')else pg_temp.oid('dispense')end);
 end if;
 perform pg_temp.opening_history_reject(kind,'alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;'||command,expected);
 end loop;
end$$;
-- Missing and nonnull closed_at are independently invalid for a partial fill.
select pg_temp.opening_history_reject('partial_closed_at_missing',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set result=jsonb_set(result,'{slot}',(result->'slot')-'closed_at')where id=pg_temp.oid('dispense')$q$,'Original dispense result must retain its exact slot and refill frame');
select pg_temp.opening_history_reject('partial_closed_at_nonnull',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set result=jsonb_set(result,'{slot,closed_at}','"2026-10-18T12:00:00+00:00"')where id=pg_temp.oid('dispense')$q$,'Original dispense slot timestamps must retain exact finite instants');
-- The first primary fill carries a real linked-refill event written in this zone.
select pg_temp.opening_history_assert((select result#>>'{refill_event,id}'from native_fulfillment_operations where id=pg_temp.oid('dispense'))=(select document->>'refill_event_id'from native_dispenses where id=pg_temp.oid('dispense')),'real linked-refill result exists on first partial fill');
do $$declare kind text;command text;value jsonb;expected text;begin
 foreach kind in array array['refill_changed_instant','refill_created_missing','refill_created_null','refill_created_malformed','refill_created_no_offset','refill_created_infinity','refill_created_number','non_time_refill_field','extra_refill_key']loop
 expected:='Original dispense refill timestamp must retain its exact finite instant';
 if kind='refill_created_missing'then
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{refill_event}'',(result->''refill_event'')-''created_at'')where id=%L::uuid',pg_temp.oid('dispense'));
 expected:='Original dispense result must retain its exact slot and refill frame';
 elsif kind='non_time_refill_field'then
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{refill_event,reason}'',''"Changed non-time refill reason"'')where id=%L::uuid',pg_temp.oid('dispense'));
 expected:='Original dispense result must retain its exact slot and refill frame';
 elsif kind='extra_refill_key'then
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{refill_event,extra_key}'',''true'')where id=%L::uuid',pg_temp.oid('dispense'));
 expected:='Original dispense result must retain its exact slot and refill frame';
 else
 value:=case kind when 'refill_changed_instant'then to_jsonb('2031-01-01T00:00:00+00:00'::text)when 'refill_created_null'then 'null'::jsonb
 when 'refill_created_malformed'then to_jsonb('not-a-timestamp'::text)when 'refill_created_no_offset'then to_jsonb('2026-10-18T12:00:00'::text)
 when 'refill_created_infinity'then to_jsonb('infinity'::text)else '123'::jsonb end;
 command:=format('update native_fulfillment_operations set result=jsonb_set(result,''{refill_event,created_at}'',%L::jsonb)where id=%L::uuid',value::text,pg_temp.oid('dispense'));
 end if;
 perform pg_temp.opening_history_reject(kind,'alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;'||command,expected);
 end loop;
end$$;
-- A same-instant offset rewrite passes typed frame checks but MUST fail the
-- retained opening operation hash, demonstrating the two independent boundaries.
select pg_temp.opening_history_reject('same_instant_offset_rewrite_after_opening',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set result=jsonb_set(result,'{slot,opened_at}',to_jsonb(to_char((result#>>'{slot,opened_at}')::timestamptz at time zone 'Pacific/Honolulu','YYYY-MM-DD"T"HH24:MI:SS.US')||'-10:00'))where id=pg_temp.oid('dispense')$q$,'Stored opening custody must equal the canonical retained native prefix');
select pg_temp.opening_history_assert(pg_temp.opening_history_sources()=(select value from opening_history_original_sources),'all new historical refusal subtransactions preserve exact original source rows');
-- HISTORY_ACCEPTANCE_END
