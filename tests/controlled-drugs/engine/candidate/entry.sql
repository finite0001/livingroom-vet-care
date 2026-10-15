create or replace function public.stock_writer_enter(p_writer text,p_source_id uuid)returns void
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid;manifest public.stock_writer_manifests;prior public.stock_writer_admissions;
 reservation public.controlled_stock_preparations;context public.controlled_stock_execution_contexts;has_prior boolean;
begin
 if current_setting('transaction_isolation')<>'read committed'then raise exception 'Stock mutation requires READ COMMITTED isolation'using errcode='23514';end if;
 if p_source_id is null then raise exception 'Stable stock operation required'using errcode='23514';end if;
 actor:=public.clinical_require_staff();
 perform pg_advisory_xact_lock_shared(90271040,0);actor:=public.clinical_require_staff();
 -- Shared with prepare/read/cancel/execute, before every old resource lock.
 perform pg_advisory_xact_lock(hashtextextended('controlled-stock-operation:'||p_source_id::text,0));
 actor:=public.clinical_require_staff();
 if exists(select 1 from public.controlled_stock_policy_versions)then perform public.controlled_stock_manifest_required();end if;
 select * into manifest from public.stock_writer_manifests where writer=p_writer order by version desc limit 1;
 if not found or manifest.definition_sha256 is distinct from encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(manifest.signature)),'UTF8')),'hex')then
  raise exception 'Stock writer coverage changed; reviewed manifest required'using errcode='23514';end if;
 select * into prior from public.stock_writer_admissions where backend_pid=pg_backend_pid()and server_started_at=pg_postmaster_start_time()
  and transaction_id=txid_current()and transaction_started_at=transaction_timestamp()and statement_started_at=statement_timestamp()and actor_id=actor;
 has_prior:=found;
 select * into reservation from public.controlled_stock_preparations where id=p_source_id;
 if found then
  perform public.controlled_stock_actor(actor);context:=public.controlled_stock_current();
  if context.operation_id=p_source_id and context.actor_id=actor and reservation.actor_id=actor
   and context.writer=reservation.writer and(p_writer=context.writer or
    (context.writer='record_anesthesia_drug_administration'and p_writer='record_patient_treatment'and has_prior
     and prior.writer=context.writer and prior.source_id=p_source_id and prior.actor_id=actor))then null;
  elsif reservation.writer=p_writer and reservation.actor_id=actor
   and exists(select 1 from public.controlled_stock_actions where id=p_source_id and actor_id=actor and writer=p_writer)then null;
  else raise exception 'Controlled UUID is reserved; use its owned review and recovery protocol'using errcode='23514';end if;
 end if;
 if has_prior and prior.writer='record_anesthesia_drug_administration'and p_writer='record_patient_treatment'and prior.source_id=p_source_id then
  if reservation.id is not null and(context.operation_id is distinct from p_source_id or context.writer is distinct from prior.writer)then
   raise exception 'Nested controlled treatment requires the actual outer executing context'using errcode='23514';end if;
  return;
 end if;
 insert into public.stock_writer_admissions values(pg_backend_pid(),pg_postmaster_start_time(),txid_current(),transaction_timestamp(),statement_timestamp(),p_writer,p_source_id,actor)
 on conflict(backend_pid)do update set server_started_at=excluded.server_started_at,transaction_id=excluded.transaction_id,
  transaction_started_at=excluded.transaction_started_at,statement_started_at=excluded.statement_started_at,
  writer=excluded.writer,source_id=excluded.source_id,actor_id=excluded.actor_id;
end $$;
create function public.controlled_stock_source_required()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare product uuid;products uuid[];context public.controlled_stock_execution_contexts;
 admission public.stock_writer_admissions;r public.controlled_stock_preparations;
begin
 if TG_TABLE_NAME='inventory_movements'then select product_id into product from public.inventory_lots where id=NEW.lot_id;
 else
  select array_agg(distinct l.product_id)into products from public.native_dispense_allocations a
   join public.inventory_lots l on l.id=a.lot_id where a.dispense_id=NEW.dispense_id;
  if cardinality(products)is distinct from 1 then raise exception 'Exact native source product membership required'using errcode='23514';end if;
  product:=products[1];
 end if;
 -- Ever-managed identity remains covered in frozen/suspended/retired states.
 if not exists(select 1 from public.controlled_stock_policy_versions where product_id=product)then return NEW;end if;
 perform public.controlled_stock_actor();context:=public.controlled_stock_current();admission:=public.stock_writer_current();
 if context.operation_id is null or context.operation_id is distinct from admission.source_id
  or context.writer is distinct from admission.writer or context.actor_id is distinct from admission.actor_id then
  raise exception 'Managed stock requires its actual owned executing context'using errcode='23514';end if;
 select * into r from public.controlled_stock_preparations where id=context.operation_id and actor_id=context.actor_id and writer=context.writer;
 if r.id is null or r.product_id is distinct from product then raise exception 'Managed source does not match its owned product'using errcode='23514';end if;
 if TG_TABLE_NAME<>'inventory_movements'and NEW.id<>r.id then raise exception 'Owned native source UUID mismatch'using errcode='23514';end if;
 perform public.controlled_stock_permission(context.actor_id,r.writer,r.canonical_arguments,r.context);
 return NEW;
end $$;
