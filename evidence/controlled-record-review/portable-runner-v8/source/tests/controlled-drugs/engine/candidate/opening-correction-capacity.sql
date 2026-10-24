-- SYNTHETIC OWNED LOCAL ONLY. The runner splits the sections below and uses a
-- fresh SQL backend for every bounded canonical-writer batch. Canonical history
-- commits ONLY in the marked disposable clone. Configuration transactions roll
-- back, then the runner proves the committed four-schema baseline and destroys
-- that clone. No engine, canonical migration, or trusted-pin changes.
-- The private seed contains real synthetic IDs/source values; never publish it.

-- CORRECTION_CAPACITY_PREAMBLE_BEGIN --
reset role;set local timezone='UTC';
create temp table correction_capacity_meta(seed jsonb not null);
create temp table correction_capacity_results(label text primary key,value jsonb not null);
create temp table correction_capacity_baselines(label text primary key,value jsonb not null);
-- Bootstrap already has canonical-prefix fx. Other backends reconstruct fx
-- from the private ids_json BEFORE this preamble; this marker inserts meta only.
-- CORRECTION_CAPACITY_SEED --
create function pg_temp.correction_capacity_id(key text)returns uuid language sql stable as $$select id from fx where k=key$$;
create function pg_temp.correction_capacity_assert(value boolean,label text)returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Correction capacity assertion failed: %',label;end if;
 insert into correction_capacity_results values(label,jsonb_build_object('outcome','accepted_assertion'));
end$$;
create function pg_temp.correction_capacity_snapshot()returns jsonb language plpgsql volatile set timezone='UTC' as $$
declare r record;value jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by n.nspname,c.relname loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into value;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,value);end loop;return result;end$$;
create function pg_temp.correction_capacity_refuse(label text,mutation text,observation text,expected text)returns void language plpgsql volatile as $$
declare before_value jsonb:=pg_temp.correction_capacity_snapshot();manifest jsonb:=controlled_stock_manifest_snapshot();armed boolean:=false;failure text;state text;begin
 begin
  set constraints all deferred;execute mutation;armed:=true;execute observation;
  raise exception 'Capacity observation unexpectedly accepted: %',label using errcode='P0002';
 exception when check_violation then
  get stacked diagnostics failure=MESSAGE_TEXT,state=RETURNED_SQLSTATE;
  if not armed then raise exception 'Capacity mutation failed before observation: %: %',label,failure using errcode='P0003';end if;
  if state is distinct from '23514'or failure is distinct from expected then raise exception 'Wrong capacity guard: %: % %',label,state,failure using errcode='P0003';end if;
 end;
 if before_value is distinct from pg_temp.correction_capacity_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then
  raise exception 'Capacity refusal failed exact four-schema and manifest rollback: %',label;end if;
 insert into correction_capacity_results values(label,jsonb_build_object('outcome','refused','sqlstate',state,'error',failure,'armed_before_observation',true,'four_schema_and_manifest_rollback',true));
end$$;

create function pg_temp.correction_capacity_source()returns jsonb language plpgsql stable as $$declare r text;v jsonb;result jsonb:='{}';begin
 foreach r in array array['native_dispenses','native_dispense_allocations','native_fill_slots','native_fulfillment_operations','inventory_lots','inventory_movements','billing_invoices','billing_invoice_items']loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from public.%I t',r)into v;
  result:=result||jsonb_build_object(r,v);
 end loop;
 return result;
end$$;
-- Fixture-only retained review context. Canonical append still independently
-- verifies the full history for EVERY write. Only redundant producer previews
-- within a bounded batch are replaced; real previews anchor both endpoints.
create function pg_temp.correction_capacity_request(ctx jsonb)returns jsonb language plpgsql volatile as $$begin
 return jsonb_build_object('authorization_id',pg_temp.correction_capacity_id('sign'),'pet_id',pg_temp.correction_capacity_id('pet'),
 'dispense_id',pg_temp.correction_capacity_id('dispense'),'kind','operational_annotation','expected_context_hash',native_fulfillment_hash(ctx),
 'expected_head',ctx->'head','reason','Synthetic reviewed capacity annotation','note','Synthetic capacity note',
 'amends_event_id',null,'pickup_amendment',null,'attest_review',true);
end$$;
create function pg_temp.correction_capacity_receipt_advance(ctx jsonb,actor uuid,id uuid,req jsonb,receipt jsonb)returns jsonb language plpgsql volatile as $$
declare o public.native_dispense_correction_operations;e public.native_dispense_correction_events;doc jsonb;next_ctx jsonb;begin
 select * into o from native_dispense_correction_operations where native_dispense_correction_operations.id=correction_capacity_receipt_advance.id;
 select * into e from native_dispense_correction_events where native_dispense_correction_events.id=correction_capacity_receipt_advance.id;
 doc:=receipt->'result';
 if ctx is null or actor is null or id is null or req is null or receipt is null
 or o.id is null or e.id is null or actor is distinct from auth.uid()
 or ctx->'version' is distinct from '1'::jsonb
 or ctx->'target' is distinct from jsonb_build_object('authorization_id',pg_temp.correction_capacity_id('sign'),'pet_id',pg_temp.correction_capacity_id('pet'),'dispense_id',pg_temp.correction_capacity_id('dispense'))
 or req is distinct from pg_temp.correction_capacity_request(ctx)
 or receipt is distinct from native_correction_receipt(o)
 or receipt->'version' is distinct from '1'::jsonb or receipt->>'id' is distinct from id::text
 or receipt->>'actor_id' is distinct from actor::text or receipt->'request' is distinct from req
 or o.actor_id is distinct from actor or o.request is distinct from req
 or o.request_hash is distinct from native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor,'operation','append_native_dispense_correction','request',req))
 or o.result is distinct from e.document or doc is distinct from e.document or e.reviewed_context is distinct from ctx
 or e.authorization_id::text is distinct from ctx#>>'{target,authorization_id}'
 or e.pet_id::text is distinct from ctx#>>'{target,pet_id}' or e.dispense_id::text is distinct from ctx#>>'{target,dispense_id}'
 or e.actor_id is distinct from actor or e.kind is distinct from 'operational_annotation'
 or e.sequence is distinct from (ctx#>>'{head,version}')::integer+1
 or e.prior_event_id::text is distinct from ctx#>>'{head,event_id}'
 or o.created_at is distinct from e.created_at
 or doc is distinct from jsonb_build_object('version',1,'id',id,'target',ctx->'target',
  'authorization_hash',ctx->'authorization_hash','dispense_document_hash',ctx->'dispense_document_hash',
  'sequence',e.sequence,'prior_event_id',ctx#>'{head,event_id}','prior_record_hash',ctx#>'{head,record_hash}',
  'actor',native_correction_actor('operational_annotation'),'kind','operational_annotation','reason',req->'reason','note',req->'note',
  'amends_event_id',null,'pickup_amendment',null,'reviewed_context_hash',native_fulfillment_hash(ctx),
  'created_at',e.created_at,'record_hash',e.record_hash)
 or e.record_hash is distinct from native_fulfillment_hash(doc-'record_hash') then
  raise exception 'Correction producer receipt binding mismatch' using errcode='P0001';
 end if;
 -- Only the exact returned receipt supplies the next head. No unrelated context
 -- field is synthesized or changed for operational annotations.
 next_ctx:=jsonb_set(ctx,'{head}',jsonb_build_object('event_id',doc->'id','version',doc->'sequence','record_hash',doc->'record_hash'));
 if next_ctx-'head' is distinct from ctx-'head' then raise exception 'Correction producer receipt binding mismatch' using errcode='P0001';end if;
 return next_ctx;
end$$;
create function pg_temp.correction_capacity_append_to(target integer)returns jsonb language plpgsql volatile as $$
declare n integer;p jsonb;ctx jsonb;original_ctx jsonb;actor uuid;id uuid;req jsonb;receipt jsonb;begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);
 select count(*)into n from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense');
 if target is null or target<1 or target>1001 or n>=target or target-n>32 then raise exception 'Exact advancing correction batch required';end if;
 p:=preview_native_dispense_correction(pg_temp.correction_capacity_id('sign'),pg_temp.correction_capacity_id('pet'),pg_temp.correction_capacity_id('dispense'));
 actor:=auth.uid();ctx:=p->'context';original_ctx:=ctx;
 if actor is null or p->'version' is distinct from '1'::jsonb or p->>'actor_id' is distinct from actor::text
 or ctx->'version' is distinct from '1'::jsonb
 or ctx->'target' is distinct from jsonb_build_object('authorization_id',pg_temp.correction_capacity_id('sign'),'pet_id',pg_temp.correction_capacity_id('pet'),'dispense_id',pg_temp.correction_capacity_id('dispense'))
 or p->>'context_hash' is distinct from native_fulfillment_hash(ctx)
 or ctx->'head' is distinct from coalesce((select jsonb_build_object('event_id',e.id,'version',e.sequence,'record_hash',e.record_hash)from native_dispense_correction_events e where e.dispense_id=pg_temp.correction_capacity_id('dispense')order by sequence desc limit 1),jsonb_build_object('event_id',null,'version',0,'record_hash',null))
 or ctx#>'{head,version}' is distinct from to_jsonb(n)
 or(select count(*)from native_dispense_correction_operations)is distinct from n::bigint then
  raise exception 'Correction producer initial preview mismatch';end if;
 for i in n+1..target loop
  id:=gen_random_uuid();req:=pg_temp.correction_capacity_request(ctx);
  receipt:=append_native_dispense_correction(id,req);
  ctx:=pg_temp.correction_capacity_receipt_advance(ctx,actor,id,req,receipt);
 end loop;
 p:=preview_native_dispense_correction(pg_temp.correction_capacity_id('sign'),pg_temp.correction_capacity_id('pet'),pg_temp.correction_capacity_id('dispense'));
 if p->'version' is distinct from '1'::jsonb or p->>'actor_id' is distinct from actor::text
 or auth.uid()is distinct from actor or p->'context' is distinct from ctx
 or p->>'context_hash' is distinct from native_fulfillment_hash(ctx)
 or ctx-'head' is distinct from original_ctx-'head' or ctx#>'{head,version}' is distinct from to_jsonb(target)
 or(select count(*)from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense'))is distinct from target::bigint
 or(select count(*)from native_dispense_correction_operations)is distinct from target::bigint
 or exists(select 1 from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense')and sequence>n and kind<>'operational_annotation')then
  raise exception 'Correction producer final preview mismatch';end if;
 return jsonb_build_object('kind','controlled-correction-producer-batch-v1','previous_target',n,'target',target,
 'canonical_writes',target-n,'real_previews',2,'actual_receipts_bound',target-n,'only_operational_annotations',true,
 'only_head_advanced',true,'fresh_preview_context_matches',true,'passed',true);
end$$;
create function pg_temp.correction_capacity_verified(target integer)returns boolean language plpgsql stable as $$declare v jsonb;begin
 v:=native_correction_verified(pg_temp.correction_capacity_id('sign'),pg_temp.correction_capacity_id('pet'),pg_temp.correction_capacity_id('dispense'));
 return (select count(*)=target from native_dispense_correction_operations)
 and jsonb_array_length(v->'events')=target and(v#>>'{context,head,version}')::integer=target
 and(select count(*)=target and min(sequence)=1 and max(sequence)=target from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense'))
 and(select count(*)=target from native_dispense_correction_operations o join native_dispense_correction_events e on e.id=o.id where e.dispense_id=pg_temp.correction_capacity_id('dispense'))
 and not exists(select 1 from(select e.*,lag(id)over(order by sequence)previous_id,lag(record_hash)over(order by sequence)previous_hash from native_dispense_correction_events e where dispense_id=pg_temp.correction_capacity_id('dispense'))e
  where e.prior_event_id is distinct from e.previous_id or e.document->>'prior_record_hash'is distinct from e.previous_hash
  or e.record_hash is distinct from native_fulfillment_hash(e.document-'record_hash')
  or e.kind<>'operational_annotation')
 and v#>'{context,head}'=(select jsonb_build_object('event_id',id,'version',sequence,'record_hash',record_hash)from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense')and sequence=target);
end$$;
create function pg_temp.correction_capacity_checkpoint(target integer)returns jsonb language plpgsql volatile as $$declare unchanged boolean;verified boolean;begin
 unchanged:=pg_temp.correction_capacity_source()=(select seed->'source_baseline'from correction_capacity_meta);
 verified:=pg_temp.correction_capacity_verified(target);
 if unchanged is distinct from true or verified is distinct from true then raise exception 'Canonical correction checkpoint failed';end if;
 return jsonb_build_object('kind','controlled-opening-correction-capacity-checkpoint-v1','corrections',target,
 'genuine_canonical_writers',true,'billing_unchanged',unchanged,'native_quantities_unchanged',unchanged,'receipts_and_chain_verified',verified,
 'fingerprint',pg_temp.correction_capacity_snapshot());
end$$;
create function pg_temp.correction_capacity_build_opening(correction_version integer default 1000,retained_boundary jsonb default null)returns void language plpgsql volatile as $$declare boundary jsonb;r record;cid uuid;begin
 if retained_boundary is not null then boundary:=retained_boundary;else
 select jsonb_build_array(controlled_stock_opening_native_entry_for_product(pg_temp.correction_capacity_id('product'),'tablet',pg_temp.correction_capacity_id('dispense'),0,correction_version,0,null))
 into boundary;end if;
 insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 values(pg_temp.correction_capacity_id('engine_opening'),pg_temp.correction_capacity_id('product'),pg_temp.correction_capacity_id('engine_policy'),clock_timestamp(),
 '{"synthetic":true,"not_practice_physical_count":true}',boundary,auth.uid(),pg_temp.correction_capacity_id('engine_session'));
 insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)
 select pg_temp.correction_capacity_id('engine_opening'),m.id,m.lot_id,m.quantity,to_jsonb(m)from inventory_movements m join inventory_lots l on l.id=m.lot_id where l.product_id=pg_temp.correction_capacity_id('product');
 for r in select l.id,coalesce(sum(m.quantity),0)quantity from inventory_lots l left join inventory_movements m on m.lot_id=l.id where l.product_id=pg_temp.correction_capacity_id('product')group by l.id having coalesce(sum(m.quantity),0)>0 loop
  cid:=gen_random_uuid();
  insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
  values(cid,pg_temp.correction_capacity_id('product'),'tablet','Synthetic capacity stock','stock',r.id,pg_temp.correction_capacity_id('engine_site'),pg_temp.correction_capacity_id('engine_location'),auth.uid(),pg_temp.correction_capacity_id('engine_opening'),auth.uid(),pg_temp.correction_capacity_id('engine_session'));
  insert into controlled_stock_cells(id,container_id,lot_id,channel,opening_id,opening_quantity)values(gen_random_uuid(),cid,r.id,'available',pg_temp.correction_capacity_id('engine_opening'),r.quantity);
 end loop;
 -- One synthetic prepared container retains the genuine single allocation.
 -- This is technical fixture configuration, not a practice packaging decision.
 cid:=gen_random_uuid();
 insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 values(cid,pg_temp.correction_capacity_id('product'),'tablet','Synthetic aggregate capacity package','prepared',null,pg_temp.correction_capacity_id('engine_site'),pg_temp.correction_capacity_id('engine_location'),auth.uid(),pg_temp.correction_capacity_id('engine_opening'),auth.uid(),pg_temp.correction_capacity_id('engine_session'));
 insert into controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,opening_id,opening_quantity)
 select gen_random_uuid(),cid,a.lot_id,'prepared',a.dispense_id,a.id,pg_temp.correction_capacity_id('engine_opening'),a.quantity
 from native_dispense_allocations a where a.dispense_id=pg_temp.correction_capacity_id('dispense');
 insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 select id,0,initial_location_id,initial_custodian_id,'onsite'from controlled_stock_containers where opening_id=pg_temp.correction_capacity_id('engine_opening');
 insert into controlled_stock_positions select id,opening_quantity from controlled_stock_cells where opening_id=pg_temp.correction_capacity_id('engine_opening');
end$$;
-- CORRECTION_CAPACITY_PREAMBLE_END --

-- CORRECTION_CAPACITY_BOOTSTRAP_BEGIN --
-- Runner prepends the unchanged canonical native_fulfillment.test.sql prefix,
-- ending immediately before its target INSERT. Its transaction remains open.
do $$begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);end$$;
insert into data select 'correction-capacity-dispense-request',t||jsonb_build_object('expected_context_hash',preview_native_dispense(t)->>'context_hash',
 'reason','Synthetic correction capacity preparation','attest_alert_review',true,'attest_dispense_review',true)
 from(select jsonb_build_object('authorization_id',pg_temp.correction_capacity_id('sign'),'pet_id',pg_temp.correction_capacity_id('pet'),
 'slot_index',0,'expected_slot_version',null,'invoice_id',pg_temp.correction_capacity_id('invoice'),'quantity','0.125',
 'allocations',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.correction_capacity_id('lot2'),'quantity','0.125')),'refill',null)t)s;
do $$begin perform record_native_dispense(pg_temp.correction_capacity_id('dispense'),(select v from data where k='correction-capacity-dispense-request'));end$$;
select pg_temp.correction_capacity_assert((select count(*)=1 and sum(quantity)=0.125 from native_dispense_allocations)
 and(select count(*)=1 and min(quantity)=0.125 from native_dispenses)
 and(select count(*)=1 and min(quantity)=0.125 from billing_invoice_items),'genuine_single_dispense_single_allocation');
insert into correction_capacity_meta select jsonb_build_object('ids_json',(select jsonb_object_agg(k,id)from fx),'source_baseline',pg_temp.correction_capacity_source());
set constraints all immediate;commit;
select jsonb_build_object('kind','controlled-opening-correction-capacity-seed-v1')||seed from correction_capacity_meta;
-- CORRECTION_CAPACITY_BOOTSTRAP_END --


-- CORRECTION_CAPACITY_PRODUCER_BEGIN --
-- Runner supplies a fresh seeded preamble after committed bootstrap, at zero
-- corrections. This section owns ROLLBACK, emits only the sanitized contract,
-- and must be independently checked against the exact pre-transaction snapshot.
do $$declare batch jsonb;ctx jsonb;actor uuid;id uuid;req jsonb;receipt jsonb;bad jsonb;
 before_value jsonb;manifest jsonb;failure text;state text;refused integer:=0;canonical_refused integer:=0;begin
 if exists(select 1 from native_dispense_correction_events)or exists(select 1 from native_dispense_correction_operations)then
  raise exception 'Correction producer contract requires zero original corrections';end if;
 batch:=pg_temp.correction_capacity_append_to(3);
 if batch is distinct from jsonb_build_object('kind','controlled-correction-producer-batch-v1','previous_target',0,'target',3,
  'canonical_writes',3,'real_previews',2,'actual_receipts_bound',3,'only_operational_annotations',true,
  'only_head_advanced',true,'fresh_preview_context_matches',true,'passed',true)then raise exception 'Correction producer contract batch mismatch';end if;
 set constraints all immediate;
 select o.id,o.actor_id,o.request,native_correction_receipt(o),e.reviewed_context into id,actor,req,receipt,ctx
 from native_dispense_correction_operations o join native_dispense_correction_events e on e.id=o.id where e.sequence=1;
 if pg_temp.correction_capacity_receipt_advance(ctx,actor,id,req,receipt) is distinct from
  jsonb_set(ctx,'{head}',jsonb_build_object('event_id',receipt#>'{result,id}','version',receipt#>'{result,sequence}','record_hash',receipt#>'{result,record_hash}'))then
  raise exception 'Correction producer contract actual receipt mismatch';end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(receipt,'{id}',to_jsonb(gen_random_uuid())),
  jsonb_set(receipt,'{actor_id}',to_jsonb(gen_random_uuid())),
  jsonb_set(receipt,'{request,note}','"forged"'),
  jsonb_set(receipt,'{request_hash}',to_jsonb(repeat('0',64))),
  jsonb_set(receipt,'{result,target,dispense_id}',to_jsonb(gen_random_uuid())),
  jsonb_set(receipt,'{result,sequence}','999'),
  jsonb_set(receipt,'{result,prior_record_hash}',to_jsonb(repeat('0',64))),
  jsonb_set(receipt,'{result,record_hash}',to_jsonb(repeat('0',64)))
 ))loop
  before_value:=pg_temp.correction_capacity_snapshot();manifest:=controlled_stock_manifest_snapshot();
  begin
   perform pg_temp.correction_capacity_receipt_advance(ctx,actor,id,req,bad);
   raise exception 'Correction producer mutation unexpectedly accepted' using errcode='P0002';
  exception when sqlstate 'P0001' then
   get stacked diagnostics failure=MESSAGE_TEXT,state=RETURNED_SQLSTATE;
   if failure is distinct from 'Correction producer receipt binding mismatch'or state is distinct from 'P0001'then raise exception 'Wrong correction producer receipt refusal';end if;
   refused:=refused+1;
  end;
  if before_value is distinct from pg_temp.correction_capacity_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then
   raise exception 'Correction producer receipt refusal failed exact rollback';end if;
 end loop;
 -- These two requests reach the UNCHANGED canonical writer, not the fixture
 -- receipt guard. Their admission/history side effects must roll back exactly.
 -- Migration 20260928190000 changes permanent review conflicts to PT409;
 -- the original September 16 writer's historical 40001 is not current behavior.
 ctx:=(preview_native_dispense_correction(pg_temp.correction_capacity_id('sign'),pg_temp.correction_capacity_id('pet'),pg_temp.correction_capacity_id('dispense')))->'context';
 req:=pg_temp.correction_capacity_request(ctx);
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(req,'{expected_head,version}','4'),
  jsonb_set(req,'{expected_context_hash}',to_jsonb(case when req->>'expected_context_hash'=repeat('0',64)then repeat('1',64)else repeat('0',64)end))
 ))loop
  before_value:=pg_temp.correction_capacity_snapshot();manifest:=controlled_stock_manifest_snapshot();
  begin
   perform append_native_dispense_correction(gen_random_uuid(),bad);
   raise exception 'Correction producer bad canonical context unexpectedly accepted' using errcode='P0002';
  exception when sqlstate 'PT409' then
   get stacked diagnostics failure=MESSAGE_TEXT,state=RETURNED_SQLSTATE;
   if failure is distinct from 'Correction review context changed'or state is distinct from 'PT409'then raise exception 'Wrong correction producer canonical refusal';end if;
   canonical_refused:=canonical_refused+1;
  end;
  if before_value is distinct from pg_temp.correction_capacity_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then
   raise exception 'Correction producer canonical refusal failed exact rollback';end if;
 end loop;
 if refused<>8 or canonical_refused<>2 or pg_temp.correction_capacity_verified(3)is distinct from true then raise exception 'Correction producer contract counts mismatch';end if;
 insert into correction_capacity_results values('producer_contract',jsonb_build_object('kind','controlled-correction-producer-contract-v1',
 'passed',true,'successful_rolled_back_writes',3,'receipt_mutation_refusals',8,'canonical_context_refusals',2,'batch_real_previews',2,
 'original_counts_zero',true,'mutation_refusals_rolled_back_exactly',true));
end$$;
select value from correction_capacity_results where label='producer_contract';
rollback;
-- CORRECTION_CAPACITY_PRODUCER_END --

-- CORRECTION_CAPACITY_POSITIVE_BEGIN --
-- Runner begins a fresh seeded backend after the measured 1000-event batch.
do $$begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);end$$;
select pg_temp.correction_capacity_assert(pg_temp.correction_capacity_verified(1000),'genuine1000_receipts_hashes_contiguous_chain');
select pg_temp.correction_capacity_assert(pg_temp.correction_capacity_source()=(select seed->'source_baseline'from correction_capacity_meta),'annotations_preserve_exact_source_quantities_and_billing');
-- A real retry enters the canonical writer in this fresh backend. Prove its
-- one expected admission explicitly; no audit relation is omitted or normalized.
insert into correction_capacity_baselines values('before_replay',pg_temp.correction_capacity_snapshot());
do $$declare prior_count bigint;receipt jsonb;original public.native_dispense_correction_operations;
 prior_admissions jsonb;actual_admissions jsonb;expected_admissions jsonb;expected_fingerprint jsonb;
 expected_admission public.stock_writer_admissions;expected_audit_hash text;begin
 select * into original from native_dispense_correction_operations where id=(select id from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense')and sequence=1000);
 select count(*)into prior_count from native_dispense_correction_events;
 select coalesce(jsonb_agg(to_jsonb(a)order by a.backend_pid),'[]')into prior_admissions from stock_writer_admissions a;
 expected_admission:=row(pg_backend_pid(),pg_postmaster_start_time(),txid_current(),transaction_timestamp(),statement_timestamp(),
  'append_native_dispense_correction',original.id,auth.uid())::public.stock_writer_admissions;
 if exists(select 1 from stock_writer_admissions where backend_pid=expected_admission.backend_pid)
  or expected_admission.actor_id is distinct from original.actor_id then
  raise exception 'Replay must use its own new backend and original actor';end if;
 select jsonb_agg(value order by(value->>'backend_pid')::integer)into expected_admissions
 from jsonb_array_elements(prior_admissions||jsonb_build_array(to_jsonb(expected_admission)));
 receipt:=append_native_dispense_correction(original.id,original.request);
 select coalesce(jsonb_agg(to_jsonb(a)order by a.backend_pid),'[]')into actual_admissions from stock_writer_admissions a;
 select encode(sha256(convert_to(string_agg(value::text,'|'order by value::text),'UTF8')),'hex')into expected_audit_hash
 from jsonb_array_elements(expected_admissions);
 expected_fingerprint:=jsonb_set((select value from correction_capacity_baselines where label='before_replay'),
  '{public.stock_writer_admissions}',jsonb_build_object('count',jsonb_array_length(expected_admissions),'hash',expected_audit_hash));
 perform pg_temp.correction_capacity_assert(receipt=native_correction_receipt(original)
  and(select count(*)from native_dispense_correction_events)=prior_count
  and(select count(*)from native_dispense_correction_operations)=1000
  and pg_temp.correction_capacity_source()=(select seed->'source_baseline'from correction_capacity_meta)
  and actual_admissions=expected_admissions
  and pg_temp.correction_capacity_snapshot()=expected_fingerprint,'exact1000th_replay_same_receipt_no_extra_event');
 insert into correction_capacity_baselines values('expected_after_replay',expected_fingerprint);
end$$;
-- Shared canonical writer lock must end before the separate exclusive freeze.
set constraints all immediate;commit;begin;set local timezone='UTC';
insert into correction_capacity_baselines values('canonical1000',pg_temp.correction_capacity_snapshot());
do $$begin
 if(select value from correction_capacity_baselines where label='canonical1000')is distinct from
   (select value from correction_capacity_baselines where label='expected_after_replay')then
  raise exception 'Committed replay must preserve its exact expected four-schema fingerprint';end if;
end$$;
-- PRIVATE: the runner binds checkpoint1000 to before_replay, and the final
-- configuration rollback to after_replay. Never publish this record as coverage.
select jsonb_build_object('kind','controlled-opening-correction-capacity-replay-baseline-v1',
 'before_replay',(select value from correction_capacity_baselines where label='before_replay'),
 'after_replay',(select value from correction_capacity_baselines where label='canonical1000'),
 'expected_admission_only',true,'prior_admission_rows_preserved',true,'new_admission_rows',1);
savepoint correction_capacity_unconfigured;
-- CORRECTION_CAPACITY_PRIVATE_CONFIGURATION --
select pg_temp.correction_capacity_build_opening(1000);
select controlled_stock_validate_opening(pg_temp.correction_capacity_id('engine_opening'));
select controlled_stock_validate_product(pg_temp.correction_capacity_id('product'));
set constraints all immediate;
select pg_temp.correction_capacity_assert((select native_custody_boundary#>'{0,correction_head}'=(select jsonb_build_object('event_id',id,'version',sequence,'record_hash',record_hash)from native_dispense_correction_events where sequence=1000)
 and jsonb_array_length(native_custody_boundary)=1 and octet_length(native_custody_boundary::text)<=1048576 from controlled_stock_openings where id=pg_temp.correction_capacity_id('engine_opening')),'genuine1000_exact_retained_head_fullopening');
select pg_temp.correction_capacity_assert((select count(*)=1 and sum(opening_quantity)=0.125 from controlled_stock_cells where channel='prepared')
 and not exists(select 1 from native_return_events)and not exists(select 1 from native_return_discrepancy_events)and not exists(select 1 from native_pickups),
 'single_prepared_allocation_no_other_lifecycle_family');
select pg_temp.correction_capacity_assert(not exists(select 1 from controlled_stock_state_events where state='active')and not exists(select 1 from controlled_stock_events)
 and exists(select 1 from controlled_stock_state_events where state='opening_frozen'and opening_id is null),'unattached_frozen_noactivation');
-- Explicit privileged fault injection changes only the retained OPENING JSON.
-- Its immutable trigger is disabled only inside each refusal subtransaction;
-- every expected failure rolls that DDL and row mutation back before fingerprint
-- checks. No native source history trigger or canonical row is changed.
select pg_temp.correction_capacity_refuse('forged_retained_correction_head',
 $q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,correction_head,record_hash}',to_jsonb(repeat('0',64)))$q$,
 $q$select controlled_stock_validate_opening(pg_temp.correction_capacity_id('engine_opening'))$q$,
 'Stored opening custody must equal the canonical retained native prefix');
select pg_temp.correction_capacity_refuse('missing_retained_correction_head',
 $q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_build_array((native_custody_boundary->0)-'correction_head')$q$,
 $q$select controlled_stock_validate_opening(pg_temp.correction_capacity_id('engine_opening'))$q$,
 'Exact controlled-operation fields required');
select jsonb_build_object('kind','controlled-opening-correction-capacity-positive-v1','corrections',1000,'genuine_dispenses',1,'genuine_max_allocations',1,
 'full_opening_validated',true,'unattached_frozen_only',true,'genuine_canonical_writers',true,'receipts_and_chain_verified',true,
 'billing_unchanged',true,'native_quantities_unchanged',true,'exact_replay_no_extra_event',true,'separate_scenario_not_simultaneous_maxima',true,
 'sql_checks',(select count(*)from correction_capacity_results),'refusals',2,
 'outcomes',(select jsonb_agg(jsonb_build_object('label',label)||value order by label)from correction_capacity_results),
 'retained_boundary',(select native_custody_boundary from controlled_stock_openings where id=pg_temp.correction_capacity_id('engine_opening')));
rollback to savepoint correction_capacity_unconfigured;
-- The positive output does not claim this later independent rollback assertion.
select pg_temp.correction_capacity_assert(pg_temp.correction_capacity_snapshot()=(select value from correction_capacity_baselines where label='canonical1000'),'positive_configuration_exact_four_schema_rollback');
commit;
-- CORRECTION_CAPACITY_POSITIVE_END --

-- CORRECTION_CAPACITY_OVERLIMIT_BEGIN --
-- Runner has committed real append_to(1001) in a separate fresh backend first.
select pg_temp.correction_capacity_assert(pg_temp.correction_capacity_verified(1001)
 and pg_temp.correction_capacity_source()=(select seed->'source_baseline'from correction_capacity_meta),'genuine1001st_canonical_writer_and_unchanged_quantities');
select jsonb_build_object('kind','controlled-opening-correction-capacity-canonical-baseline-v1','fingerprint',pg_temp.correction_capacity_snapshot(),
 'corrections',(select count(*)from native_dispense_correction_events),'native_dispenses',(select count(*)from native_dispenses),
 'canonical_fixture_committed_inside_owned_clone',true);
-- CORRECTION_CAPACITY_PRIVATE_CONFIGURATION --
-- This projector refuses before it can build a shortened entry. Reuse only
-- the exact positive boundary captured before the real 1001st canonical write;
-- the runner injects it privately into seed.retained_boundary.
-- Build each invalid opening only inside its own refusal subtransaction. Its
-- rollback removes both the trial rows and pending deferred-trigger events.
-- No invalid opening survives between probes and no trigger DDL is required.
select pg_temp.correction_capacity_refuse('genuine1001_actual_count_retained1000',
 $q$select pg_temp.correction_capacity_build_opening(1000,(select seed->'retained_boundary'from correction_capacity_meta))$q$,
 $q$select controlled_stock_validate_opening(pg_temp.correction_capacity_id('engine_opening'))$q$,
 'Native history exceeds opening candidate limit; no truncation permitted');
select pg_temp.correction_capacity_refuse('genuine1001_actual_count_retained0',
 $q$select pg_temp.correction_capacity_build_opening(0,(select jsonb_set(seed->'retained_boundary','{0,correction_head}',jsonb_build_object('event_id',null,'version',0,'record_hash',null))from correction_capacity_meta))$q$,
 $q$select controlled_stock_validate_opening(pg_temp.correction_capacity_id('engine_opening'))$q$,
 'Native history exceeds opening candidate limit; no truncation permitted');
select jsonb_build_object('kind','controlled-opening-correction-capacity-observation-v1','corrections',1001,'genuine_dispenses',1,'genuine_max_allocations',1,
 'genuine1001st_canonical_writer_succeeded',true,'retained1000_and_zero_refused_without_truncation',true,
 'sql_checks',(select count(*)from correction_capacity_results),'refusals',2,
 'outcomes',(select jsonb_agg(jsonb_build_object('label',label)||value order by label)from correction_capacity_results),
 'synthetic_only',true,'hosted_writes',0,'clinical_or_register_activation',false,'configuration_transactions_rolled_back',true,
 'canonical_fixture_committed_inside_owned_clone',true,'canonical_fixture_removed_by_owned_clone_cleanup',true);
rollback;
-- CORRECTION_CAPACITY_OVERLIMIT_END --
