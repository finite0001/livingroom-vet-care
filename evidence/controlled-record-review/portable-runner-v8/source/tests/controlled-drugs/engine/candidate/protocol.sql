create function public.read_controlled_stock_action(p_actor_id uuid,p_action_id uuid)returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.controlled_stock_gate(p_actor_id,p_action_id);r public.controlled_stock_preparations;
 receipt jsonb;state text;
begin
 select * into r from public.controlled_stock_preparations where id=p_action_id;
 if not found then return null;end if;
 if r.actor_id<>actor then raise exception 'Controlled action belongs to another staff account'using errcode='42501';end if;
 select a.receipt into receipt from public.controlled_stock_actions a where a.id=r.id and a.actor_id=actor;
 state:=case when receipt is not null then 'saved'
  when exists(select 1 from public.controlled_stock_cancellations where id=r.id)then 'cancelled'
  when r.expires_at<=clock_timestamp()then 'expired'else 'prepared'end;
 return jsonb_build_object('version',1,'id',r.id,'writer',r.writer,'actor_id',r.actor_id,
  'canonical_arguments',r.canonical_arguments,'context',r.context,'frozen',r.frozen,
  'expires_at',r.expires_at,'state',state,'receipt',receipt);
end $$;
create function public.prepare_controlled_stock_action(
 p_actor_id uuid,p_action_id uuid,p_writer text,p_arguments jsonb,p_context jsonb
)returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.controlled_stock_gate(p_actor_id,p_action_id);r public.controlled_stock_preparations;
 product uuid;frozen jsonb;permission jsonb;expected jsonb;request_hash text;
begin
 perform public.controlled_stock_writer(p_writer);
 select * into r from public.controlled_stock_preparations where id=p_action_id;
 if found then
  if r.actor_id<>actor or r.writer<>p_writer or r.canonical_arguments is distinct from p_arguments or r.context is distinct from p_context then
   raise exception 'Controlled operation UUID is permanently bound to its original work'using errcode='23505';end if;
  return public.read_controlled_stock_action(actor,p_action_id);
 end if;
 if public.controlled_stock_root_exists(p_action_id)then
  raise exception 'Existing canonical operation cannot be adopted as a new controlled event'using errcode='23505';end if;
 product:=public.controlled_stock_arguments(p_writer,p_arguments);
 perform public.controlled_stock_product_gate(actor,product);
 perform public.controlled_stock_context(p_writer,p_action_id,p_arguments,p_context);
 permission:=public.controlled_stock_permission(actor,p_writer,p_arguments,p_context);
 frozen:=public.controlled_stock_freeze(actor,p_action_id,p_writer,p_arguments,p_context);
 expected:=public.controlled_stock_check_plan(p_action_id,p_writer,p_arguments,p_context);
 frozen:=frozen||jsonb_build_object('expected_effects',expected,'permission',permission);
 if(select count(*)from public.controlled_stock_preparations pending
  where pending.actor_id=actor and pending.expires_at>clock_timestamp()
   and not exists(select 1 from public.controlled_stock_actions a where a.id=pending.id)
   and not exists(select 1 from public.controlled_stock_cancellations c where c.id=pending.id))>=32 then
  raise exception 'Review pending controlled actions before preparing more work'using errcode='23514';end if;
 perform public.controlled_stock_actor(actor);
 request_hash:=public.controlled_stock_hash(jsonb_build_object('version',1,'actor_id',actor,'id',p_action_id,
  'writer',p_writer,'canonical_arguments',p_arguments,'context',p_context));
 insert into public.controlled_stock_preparations(id,writer,actor_id,session_id,product_id,policy_version_id,state_head_id,opening_id,
  canonical_arguments,context,frozen,request_hash)values(p_action_id,p_writer,actor,public.next_visit_review_session(),product,
  (p_context->>'policy_version_id')::uuid,(p_context->>'state_head_id')::uuid,(p_context->>'opening_id')::uuid,p_arguments,p_context,frozen,request_hash);
 return public.read_controlled_stock_action(actor,p_action_id);
end $$;
create function public.cancel_controlled_stock_action(p_actor_id uuid,p_action_id uuid)returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.controlled_stock_gate(p_actor_id,p_action_id);r public.controlled_stock_preparations;begin
 select * into r from public.controlled_stock_preparations where id=p_action_id;
 if not found then raise exception 'Read the original reviewed controlled action before cancellation'using errcode='PT409';end if;
 if r.actor_id<>actor then raise exception 'Controlled action belongs to another staff account'using errcode='42501';end if;
 if exists(select 1 from public.controlled_stock_actions where id=r.id)then return public.read_controlled_stock_action(actor,r.id);end if;
 if public.controlled_stock_root_exists(r.id)then
  raise exception 'Original canonical outcome requires reconciliation before cancellation'using errcode='PT409';end if;
 if not exists(select 1 from public.controlled_stock_cancellations where id=r.id)then
  insert into public.controlled_stock_cancellations(id,actor_id,writer,session_id)values(r.id,actor,r.writer,public.next_visit_review_session());
 end if;
 return public.read_controlled_stock_action(actor,r.id);
end $$;
create function public.controlled_stock_call_canonical(
 p_id uuid,p_writer text,p_arguments jsonb
)returns jsonb language plpgsql volatile set search_path=public,pg_temp as $$
declare context public.controlled_stock_execution_contexts:=public.controlled_stock_current();result jsonb;begin
 if context.operation_id is distinct from p_id or context.writer is distinct from p_writer then
  raise exception 'Actual owned executing context required for canonical dispatch'using errcode='23514';end if;
 case p_writer
  when 'receive_inventory'then select to_jsonb(public.receive_inventory(p_id,(p_arguments->>'lot_id')::uuid,(p_arguments->>'product_id')::uuid,
   p_arguments->>'lot_number',(p_arguments->>'expires_on')::date,p_arguments->>'location',(p_arguments->>'quantity')::numeric,p_arguments->>'reason'))into result;
  when 'adjust_inventory'then select to_jsonb(public.adjust_inventory(p_id,(p_arguments->>'lot_id')::uuid,(p_arguments->>'quantity')::numeric,p_arguments->>'reason'))into result;
  when 'record_patient_treatment'then select to_jsonb(public.record_patient_treatment(p_id,p_arguments->'request'))into result;
  when 'record_anesthesia_drug_administration'then
   select to_jsonb(public.record_anesthesia_drug_administration(p_id,(p_arguments->>'record_id')::uuid,(p_arguments->>'pet_id')::uuid,p_arguments->'request'))into result;
  when 'record_native_dispense'then result:=public.record_native_dispense(p_id,p_arguments->'request');
  when 'record_native_pickup'then result:=public.record_native_pickup(p_id,p_arguments->'request');
  when 'record_native_dispense_return'then result:=public.record_native_dispense_return(p_id,p_arguments->'request');
  when 'record_native_dispense_return_v2'then result:=public.record_native_dispense_return_v2(p_id,p_arguments->'request');
  when 'record_native_return_discrepancy'then result:=public.record_native_return_discrepancy(p_id,p_arguments->'request');
  when 'append_native_dispense_correction'then result:=public.append_native_dispense_correction(p_id,p_arguments->'request');
  else raise exception 'Reviewed controlled canonical writer required'using errcode='23514';end case;
 return result;
end $$;
create function public.execute_controlled_stock_action(p_actor_id uuid,p_action_id uuid)returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.controlled_stock_gate(p_actor_id,p_action_id);r public.controlled_stock_preparations;
 receipt jsonb;frozen jsonb;permission jsonb;expected jsonb;canonical jsonb;context public.controlled_stock_execution_contexts;
begin
 select * into r from public.controlled_stock_preparations where id=p_action_id;
 if not found then raise exception 'Original reviewed controlled action required'using errcode='PT409';end if;
 if r.actor_id<>actor then raise exception 'Controlled action belongs to another staff account'using errcode='42501';end if;
 -- Saved recovery precedes all catalog/policy/head freshness checks.
 select a.receipt into receipt from public.controlled_stock_actions a where a.id=r.id and a.actor_id=actor;
 if receipt is not null then return receipt;end if;
 if exists(select 1 from public.controlled_stock_cancellations where id=r.id)then
  raise exception 'Controlled action is permanently cancelled; review its saved outcome'using errcode='PT409';end if;
 if r.expires_at<=clock_timestamp()then raise exception 'Controlled review expired; read or explicitly cancel the original work'using errcode='PT409';end if;
 if public.controlled_stock_root_exists(r.id)then raise exception 'Canonical outcome requires investigation before new controlled execution'using errcode='23514';end if;
 perform public.controlled_stock_product_gate(actor,r.product_id);
 permission:=public.controlled_stock_permission(actor,r.writer,r.canonical_arguments,r.context);
 frozen:=public.controlled_stock_freeze(actor,r.id,r.writer,r.canonical_arguments,r.context);
 expected:=public.controlled_stock_check_plan(r.id,r.writer,r.canonical_arguments,r.context);
 frozen:=frozen||jsonb_build_object('expected_effects',expected,'permission',permission);
 if frozen is distinct from r.frozen then raise exception 'Controlled source or container review changed; do not replace the original UUID'using errcode='PT409';end if;
 context:=public.controlled_stock_current();
 if context.operation_id is not null then raise exception 'Finish the current controlled execution before another action'using errcode='23514';end if;
 insert into public.controlled_stock_execution_contexts values(pg_backend_pid(),pg_postmaster_start_time(),txid_current(),transaction_timestamp(),statement_timestamp(),
  gen_random_uuid(),r.id,r.writer,actor,public.next_visit_review_session(),'executing')on conflict(backend_pid)do update set
  server_started_at=excluded.server_started_at,transaction_id=excluded.transaction_id,transaction_started_at=excluded.transaction_started_at,
  statement_started_at=excluded.statement_started_at,nonce=excluded.nonce,operation_id=excluded.operation_id,writer=excluded.writer,
  actor_id=excluded.actor_id,session_id=excluded.session_id,phase=excluded.phase;
 canonical:=public.controlled_stock_call_canonical(r.id,r.writer,r.canonical_arguments);
 receipt:=public.controlled_stock_finish(r.id,canonical);
 delete from public.controlled_stock_execution_contexts where backend_pid=pg_backend_pid()and operation_id=r.id and transaction_id=txid_current();
 perform public.controlled_stock_actor(actor);
 return receipt;
end $$;
