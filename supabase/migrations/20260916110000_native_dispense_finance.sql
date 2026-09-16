-- Native attribution wraps existing financial ledgers; it does not execute payments.
create table public.native_dispense_finance_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),request jsonb not null,request_hash text not null,result jsonb not null,created_at timestamptz not null
);
create table public.native_dispense_credit_links (
 id uuid primary key references public.billing_credits(id),authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),dispense_id uuid not null references public.native_dispenses(id),invoice_id uuid not null references public.billing_invoices(id),invoice_item_id uuid not null references public.billing_invoice_items(id),foreign key(id) references public.native_dispense_finance_operations(id) deferrable initially deferred
);
create table public.native_dispense_refund_links (
 id uuid primary key references public.invoice_refund_requests(id),authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),dispense_id uuid not null references public.native_dispenses(id),invoice_id uuid not null references public.billing_invoices(id),invoice_item_id uuid not null references public.billing_invoice_items(id),credit_id uuid not null references public.native_dispense_credit_links(id),payment_id uuid not null references public.invoice_payments(id),foreign key(id) references public.native_dispense_finance_operations(id) deferrable initially deferred
);
create index native_finance_credit_invoice on public.native_dispense_credit_links(invoice_id,dispense_id);
create index native_finance_refund_invoice on public.native_dispense_refund_links(invoice_id,dispense_id,credit_id);
do $$declare table_name text;begin
 foreach table_name in array array['native_dispense_finance_operations','native_dispense_credit_links','native_dispense_refund_links'] loop
  execute format('alter table public.%I enable row level security',table_name);execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
  execute format('create trigger native_finance_immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()',table_name);
  execute format('create trigger native_finance_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',table_name);
  execute format('create trigger native_finance_audit after insert on public.%I for each row execute function public.native_rx_audit()',table_name);
 end loop;
end $$;
create function public.native_finance_cents(p_value numeric) returns text language plpgsql immutable security definer set search_path=public as $$begin
 if p_value is null or p_value::text in('NaN','Infinity','-Infinity') or p_value<0 or p_value>9223372036854775807 or p_value<>trunc(p_value) then raise exception 'Financial amount outside exact cents range' using errcode='23514';end if;return trunc(p_value)::text;
end $$;
create function public.native_finance_money(p_value jsonb,p_positive boolean default false) returns numeric language plpgsql immutable security definer set search_path=public as $$declare amount numeric;begin
 if jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}' !~ '^(0|[1-9][0-9]{0,18})$' then raise exception 'Canonical string cents required' using errcode='23514';end if;
 amount:=(p_value#>>'{}')::numeric;perform public.native_finance_cents(amount);if p_positive and amount=0 then raise exception 'Positive cents required' using errcode='23514';end if;return amount;
end $$;
create function public.native_finance_validate_snapshot(p_snapshot jsonb) returns void language plpgsql immutable security definer set search_path=public as $$
declare field_name text;family text;entry jsonb;head jsonb;previous_id text;stamp timestamptz;begin
 perform public.native_rx_keys(p_snapshot,array['target','authorization_hash','dispense_document_hash','invoice','source_heads','clinical_context_hash','financial_context_hash','credits','payments','refunds','balance','capacity','blockers']);
 perform public.native_rx_keys(p_snapshot->'target',array['authorization_id','pet_id','dispense_id']);
 foreach field_name in array array['authorization_id','pet_id','dispense_id'] loop perform public.native_correction_uuid(p_snapshot#>array['target',field_name],false);end loop;
 foreach field_name in array array['authorization_hash','dispense_document_hash','clinical_context_hash','financial_context_hash'] loop
  if jsonb_typeof(p_snapshot->field_name) is distinct from 'string' or p_snapshot->>field_name !~ '^[0-9a-f]{64}$' then raise exception 'Financial snapshot hash required' using errcode='23514';end if;
 end loop;
 perform public.native_rx_keys(p_snapshot->'invoice',array['id','client_id','item_id','version','status','currency','total_cents','item_amount_cents']);
 foreach field_name in array array['id','client_id','item_id'] loop perform public.native_correction_uuid(p_snapshot#>array['invoice',field_name],false);end loop;
 if p_snapshot#>>'{invoice,status}' not in('draft','issued','void') or jsonb_typeof(p_snapshot#>'{invoice,status}') is distinct from 'string' or p_snapshot#>'{invoice,currency}' is distinct from '"usd"'::jsonb or jsonb_typeof(p_snapshot#>'{invoice,version}') is distinct from 'number' then raise exception 'Financial invoice identity invalid' using errcode='23514';end if;
 if (p_snapshot#>>'{invoice,version}')::numeric not between 1 and 9007199254740991 or (p_snapshot#>>'{invoice,version}')::numeric<>trunc((p_snapshot#>>'{invoice,version}')::numeric) then raise exception 'Financial invoice version invalid' using errcode='23514';end if;
 perform public.native_finance_money(p_snapshot#>'{invoice,item_amount_cents}');
 if p_snapshot#>>'{invoice,status}'='draft' then
  if p_snapshot#>'{invoice,total_cents}' is distinct from 'null'::jsonb or p_snapshot->'balance' is distinct from 'null'::jsonb then raise exception 'Draft has no frozen financial total' using errcode='23514';end if;
 else
  perform public.native_finance_money(p_snapshot#>'{invoice,total_cents}');perform public.native_rx_keys(p_snapshot->'balance',array['obligation_cents','paid_cents','refunded_cents','net_cash_cents','outstanding_cents','pending_refund_cents','refundable_cents']);
  for field_name in select jsonb_object_keys(p_snapshot->'balance') loop perform public.native_finance_money(p_snapshot#>array['balance',field_name]);end loop;
 end if;
 perform public.native_rx_keys(p_snapshot->'capacity',array['linked_credit_cents','unallocated_credit_cents','item_credit_capacity_cents','invoice_credit_capacity_cents','credit_capacity_cents']);
 for field_name in select jsonb_object_keys(p_snapshot->'capacity') loop perform public.native_finance_money(p_snapshot#>array['capacity',field_name]);end loop;
 perform public.native_rx_keys(p_snapshot->'source_heads',array['correction','returns','discrepancy']);
 foreach field_name in array array['correction','returns','discrepancy'] loop
  head:=p_snapshot#>array['source_heads',field_name];perform public.native_rx_keys(head,array['event_id','version','record_hash']);
  if jsonb_typeof(head->'version') is distinct from 'number' then raise exception 'Financial clinical head version invalid' using errcode='23514';end if;
  if (head->>'version')::numeric not between 0 and 9007199254740991 or (head->>'version')::numeric<>trunc((head->>'version')::numeric) then raise exception 'Financial clinical head version invalid' using errcode='23514';end if;
  if (head->>'version')::numeric=0 then
   if head is distinct from jsonb_build_object('event_id',null,'version',0,'record_hash',null) then raise exception 'Empty financial clinical head invalid' using errcode='23514';end if;
  else perform public.native_correction_uuid(head->'event_id',false);
   if jsonb_typeof(head->'record_hash') is distinct from 'string' or head->>'record_hash' !~ '^[0-9a-f]{64}$' then raise exception 'Financial clinical head hash invalid' using errcode='23514';end if;
  end if;
 end loop;
 foreach family in array array['credits','payments','refunds'] loop
  if jsonb_typeof(p_snapshot->family) is distinct from 'array' then raise exception 'Financial ledger list required' using errcode='23514';end if;previous_id:='';
  for entry in select value from jsonb_array_elements(p_snapshot->family) loop
   if family='credits' then perform public.native_rx_keys(entry,array['id','amount_cents','reason','actor_id','created_at','dispense_id']);
   elsif family='payments' then perform public.native_rx_keys(entry,array['id','amount_cents','remaining_cents']);
   else perform public.native_rx_keys(entry,array['id','payment_id','amount_cents','reason','actor_id','created_at','state','settled','credit_id','dispense_id']);end if;
   perform public.native_correction_uuid(entry->'id',false);if(entry->>'id') collate "C"<=previous_id collate "C" then raise exception 'Financial ledger ids must be unique and sorted' using errcode='23514';end if;previous_id:=entry->>'id';perform public.native_finance_money(entry->'amount_cents',true);
   if family='payments' then perform public.native_finance_money(entry->'remaining_cents');
   else
    perform public.native_correction_uuid(entry->'actor_id',false);perform public.native_correction_uuid(entry->'dispense_id',true);
    -- Existing generic ledger reasons remain verbatim; only new native intent is canonicalized.
    if jsonb_typeof(entry->'reason') is distinct from 'string' or jsonb_typeof(entry->'created_at') is distinct from 'string' or entry->>'created_at' !~ '([Zz]|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Financial ledger attribution invalid' using errcode='23514';end if;
    stamp:=(entry->>'created_at')::timestamptz;if not isfinite(stamp) then raise exception 'Finite financial timestamp required' using errcode='23514';end if;
   end if;
   if family='refunds' then
    perform public.native_correction_uuid(entry->'payment_id',false);perform public.native_correction_uuid(entry->'credit_id',true);
    if jsonb_typeof(entry->'state') is distinct from 'string' or entry->>'state' not in('pending','failed','succeeded','reconciliation') or jsonb_typeof(entry->'settled') is distinct from 'boolean' or(entry->'credit_id'='null'::jsonb) is distinct from(entry->'dispense_id'='null'::jsonb) then raise exception 'Financial refund state or attribution invalid' using errcode='23514';end if;
   end if;
  end loop;
 end loop;
 if jsonb_typeof(p_snapshot->'blockers') is distinct from 'array' then raise exception 'Financial blockers required' using errcode='23514';end if;previous_id:='';
 for entry in select value from jsonb_array_elements(p_snapshot->'blockers') loop
  if jsonb_typeof(entry) is distinct from 'string' or entry#>>'{}' not in('invoice_not_issued','checkout_unresolved','payment_reconciliation') or(entry#>>'{}') collate "C"<=previous_id collate "C" then raise exception 'Financial blockers must be known unique sorted codes' using errcode='23514';end if;previous_id:=entry#>>'{}';
 end loop;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Financial timestamp invalid' using errcode='23514';
end $$;
create function public.native_finance_validate_intent(p_intent jsonb) returns void language plpgsql immutable security definer set search_path=public as $$declare field_name text;amount numeric;begin
 perform public.native_rx_keys(p_intent,array['target','action','amount_cents','reason','credit_id','payment_id']);perform public.native_rx_keys(p_intent->'target',array['authorization_id','pet_id','dispense_id']);
 foreach field_name in array array['authorization_id','pet_id','dispense_id'] loop perform public.native_correction_uuid(p_intent#>array['target',field_name],false);end loop;
 if jsonb_typeof(p_intent->'action') is distinct from 'string' or p_intent->>'action' not in('credit','refund') or jsonb_typeof(p_intent->'amount_cents') is distinct from 'string' or p_intent->>'amount_cents' !~ '^[1-9][0-9]{0,18}$' then raise exception 'Positive canonical financial cents required' using errcode='23514';end if;
 amount:=(p_intent->>'amount_cents')::numeric;perform public.native_finance_cents(amount);
 if p_intent->>'action'='refund' and amount>99999999 then raise exception 'Refund exceeds supported payment amount' using errcode='23514';end if;
 perform public.native_rx_text(p_intent->'reason',2000);
 if p_intent->>'action'='credit' then
  if p_intent->'credit_id' is distinct from 'null'::jsonb or p_intent->'payment_id' is distinct from 'null'::jsonb then raise exception 'Credit must not assert refund linkage' using errcode='23514';end if;
 else perform public.native_correction_uuid(p_intent->'credit_id',false);perform public.native_correction_uuid(p_intent->'payment_id',false);end if;
end $$;
create function public.native_finance_verified_operation(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare operation_row public.native_dispense_finance_operations;credit_link public.native_dispense_credit_links;refund_link public.native_dispense_refund_links;credit_row public.billing_credits;refund_row public.invoice_refund_requests;dispense jsonb;document jsonb;intent jsonb;context jsonb;credit_receipt jsonb;begin
 select * into operation_row from public.native_dispense_finance_operations where id=p_id;if not found then return null;end if;
 document:=operation_row.result;intent:=operation_row.request->'intent';context:=document->'reviewed_context';perform public.native_finance_validate_intent(intent);
 perform public.native_rx_keys(operation_row.request,array['intent','expected_context_hash','attest_review']);
 perform public.native_rx_keys(document,array['id','target','action','actor_id','created_at','invoice_id','invoice_item_id','credit_id','refund_request_id','payment_id','amount_cents','currency','reason','reviewed_context','reviewed_context_hash','record_hash']);
 perform public.native_rx_keys(context,array['snapshot','intent','eligible_amount_cents']);perform public.native_finance_money(context->'eligible_amount_cents');perform public.native_finance_validate_snapshot(context->'snapshot');
 dispense:=public.native_fulfillment_verified_dispense((intent#>>'{target,dispense_id}')::uuid);
 if dispense is null or dispense->'authorization_id' is distinct from intent#>'{target,authorization_id}' or dispense->'pet_id' is distinct from intent#>'{target,pet_id}'
  or document->>'id' is distinct from operation_row.id::text or document->>'actor_id' is distinct from operation_row.actor_id::text or (document->>'created_at')::timestamptz is distinct from operation_row.created_at
  or operation_row.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',operation_row.actor_id,'operation','record_native_dispense_finance','request',operation_row.request))
  or document->>'record_hash' is distinct from public.native_fulfillment_hash(document-'record_hash') or document->>'reviewed_context_hash' is distinct from public.native_fulfillment_hash(context) or document->'reviewed_context_hash' is distinct from operation_row.request->'expected_context_hash'
  or operation_row.request->'attest_review' is distinct from 'true'::jsonb or context->'intent' is distinct from intent or context#>'{snapshot,target}' is distinct from intent->'target' or document->'target' is distinct from intent->'target'
  or document->'action' is distinct from intent->'action' or document->'amount_cents' is distinct from intent->'amount_cents' or document->'reason' is distinct from intent->'reason' or document->>'currency' is distinct from 'usd'
  or document->'invoice_id' is distinct from dispense->'invoice_id' or document->'invoice_item_id' is distinct from dispense->'invoice_item_id'
  or context#>'{snapshot,authorization_hash}' is distinct from dispense->'authorization_hash' or context#>>'{snapshot,dispense_document_hash}' is distinct from public.native_fulfillment_hash(dispense)
  or context#>'{snapshot,invoice,id}' is distinct from dispense->'invoice_id' or context#>'{snapshot,invoice,item_id}' is distinct from dispense->'invoice_item_id' or context#>'{snapshot,invoice,client_id}' is distinct from dispense->'client_id' or context#>'{snapshot,invoice,item_amount_cents}' is distinct from dispense->'amount_cents'
  or context#>>'{snapshot,invoice,status}' is distinct from 'issued' or context#>'{snapshot,blockers}' is distinct from '[]'::jsonb or public.native_finance_money(context->'eligible_amount_cents')<public.native_finance_money(intent->'amount_cents',true)
 then raise exception 'Native financial receipt integrity mismatch' using errcode='23514';end if;
 if intent->>'action'='credit' then
  select * into credit_link from public.native_dispense_credit_links where id=p_id;select * into credit_row from public.billing_credits where id=p_id;
  if credit_link.id is null or credit_row.id is null or credit_link.authorization_id::text is distinct from intent#>>'{target,authorization_id}' or credit_link.pet_id::text is distinct from intent#>>'{target,pet_id}' or credit_link.dispense_id::text is distinct from intent#>>'{target,dispense_id}' or credit_link.invoice_id<>credit_row.invoice_id or credit_link.invoice_id::text is distinct from document->>'invoice_id' or credit_link.invoice_item_id::text is distinct from document->>'invoice_item_id'
   or credit_row.amount_cents::text is distinct from document->>'amount_cents' or credit_row.reason is distinct from document->>'reason' or credit_row.created_by<>operation_row.actor_id or credit_row.created_at is distinct from operation_row.created_at
   or document->>'credit_id' is distinct from p_id::text or document->'refund_request_id' is distinct from 'null'::jsonb or document->'payment_id' is distinct from 'null'::jsonb or exists(select 1 from public.native_dispense_refund_links where id=p_id)
  then raise exception 'Native credit attribution mismatch' using errcode='23514';end if;
 else
  select * into refund_link from public.native_dispense_refund_links where id=p_id;select * into refund_row from public.invoice_refund_requests where id=p_id;
  if refund_link.id is null or refund_row.id is null or refund_link.authorization_id::text is distinct from intent#>>'{target,authorization_id}' or refund_link.pet_id::text is distinct from intent#>>'{target,pet_id}' or refund_link.dispense_id::text is distinct from intent#>>'{target,dispense_id}' or refund_link.invoice_id<>refund_row.invoice_id or refund_link.invoice_id::text is distinct from document->>'invoice_id' or refund_link.invoice_item_id::text is distinct from document->>'invoice_item_id'
   or refund_row.amount_cents::text is distinct from document->>'amount_cents' or refund_row.reason is distinct from document->>'reason' or refund_row.actor_id<>operation_row.actor_id or refund_row.created_at is distinct from operation_row.created_at or refund_row.idempotency_key is distinct from 'lrv-refund-'||p_id::text
   or document->>'refund_request_id' is distinct from p_id::text or document->'credit_id' is distinct from intent->'credit_id' or document->'payment_id' is distinct from intent->'payment_id' or refund_link.credit_id::text is distinct from document->>'credit_id' or refund_link.payment_id<>refund_row.payment_id or refund_link.payment_id::text is distinct from document->>'payment_id' or exists(select 1 from public.native_dispense_credit_links where id=p_id)
  then raise exception 'Native refund attribution mismatch' using errcode='23514';end if;
  credit_receipt:=public.native_finance_verified_operation(refund_link.credit_id);
  if credit_receipt is null or credit_receipt#>>'{result,action}'<>'credit' or credit_receipt#>'{result,target}' is distinct from intent->'target' or credit_receipt#>'{result,invoice_id}' is distinct from document->'invoice_id' or not exists(select 1 from public.invoice_payments where id=refund_link.payment_id and invoice_id=refund_link.invoice_id) then raise exception 'Native refund credit or payment source mismatch' using errcode='23514';end if;
 end if;
 return jsonb_build_object('version',1,'id',operation_row.id,'actor_id',operation_row.actor_id,'request',operation_row.request,'request_hash',operation_row.request_hash,'result',document,'created_at',operation_row.created_at);
end $$;
create function public.native_finance_link_required() returns trigger language plpgsql security definer set search_path=public as $$begin
 if public.native_finance_verified_operation(NEW.id) is null then raise exception 'Native financial attribution requires exact operation' using errcode='23514';end if;return NEW;
end $$;
create constraint trigger native_finance_operation_link after insert on public.native_dispense_finance_operations deferrable initially deferred for each row execute function public.native_finance_link_required();
create constraint trigger native_finance_credit_operation after insert on public.native_dispense_credit_links deferrable initially deferred for each row execute function public.native_finance_link_required();
create constraint trigger native_finance_refund_operation after insert on public.native_dispense_refund_links deferrable initially deferred for each row execute function public.native_finance_link_required();
create function public.native_finance_snapshot(p_target jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare field_name text;authorization_id uuid;pet_id uuid;target_dispense_id uuid;dispense jsonb;invoice_row public.billing_invoices;item_row public.billing_invoice_items;corrections jsonb;returns_read jsonb;credits jsonb;payments jsonb;refunds jsonb;balance jsonb;financial_hash text;blockers jsonb:='[]';total_credits numeric;linked_credits numeric;unallocated_credits numeric;item_capacity numeric;invoice_capacity numeric;link_id uuid;begin
 perform public.native_rx_keys(p_target,array['authorization_id','pet_id','dispense_id']);foreach field_name in array array['authorization_id','pet_id','dispense_id'] loop perform public.native_correction_uuid(p_target->field_name,false);end loop;
 authorization_id:=(p_target->>'authorization_id')::uuid;pet_id:=(p_target->>'pet_id')::uuid;target_dispense_id:=(p_target->>'dispense_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||authorization_id::text,0));perform public.clinical_require_staff();
 dispense:=public.native_fulfillment_verified_dispense(target_dispense_id);
 if dispense is null or dispense->'authorization_id' is distinct from p_target->'authorization_id' or dispense->'pet_id' is distinct from p_target->'pet_id' then raise exception 'Exact native financial target required' using errcode='23514';end if;
 select * into invoice_row from public.billing_invoices inv where inv.id=(dispense->>'invoice_id')::uuid for update;perform public.clinical_require_staff();
 select * into item_row from public.billing_invoice_items item where item.id=(dispense->>'invoice_item_id')::uuid;
 if invoice_row.id is null or invoice_row.client_id::text is distinct from dispense->>'client_id' or item_row.id is null or item_row.invoice_id<>invoice_row.id or item_row.pet_id<>pet_id or item_row.amount_cents::text is distinct from dispense->>'amount_cents' or invoice_row.currency<>'usd' then raise exception 'Native financial invoice or item mismatch' using errcode='23514';end if;
 corrections:=public.native_correction_verified(authorization_id,pet_id,target_dispense_id);returns_read:=public.native_reconciliation_verified(authorization_id,pet_id,target_dispense_id)->'read';
 if corrections is null or returns_read is null then raise exception 'Verified clinical context required' using errcode='23514';end if;
 for link_id in select cl.id from public.native_dispense_credit_links cl where cl.invoice_id=invoice_row.id union select rl.id from public.native_dispense_refund_links rl where rl.invoice_id=invoice_row.id loop perform public.native_finance_verified_operation(link_id);end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',cr.id,'amount_cents',public.native_finance_cents(cr.amount_cents),'reason',cr.reason,'actor_id',cr.created_by,'created_at',cr.created_at,'dispense_id',cl.dispense_id) order by cr.id),'[]'::jsonb),coalesce(sum(cr.amount_cents),0),coalesce(sum(cr.amount_cents) filter(where cl.dispense_id=target_dispense_id),0),coalesce(sum(cr.amount_cents) filter(where cl.id is null),0)
 into credits,total_credits,linked_credits,unallocated_credits from public.billing_credits cr left join public.native_dispense_credit_links cl on cl.id=cr.id where cr.invoice_id=invoice_row.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',pay.id,'amount_cents',public.native_finance_cents(pay.amount_cents),'remaining_cents',public.native_finance_cents(greatest(0,pay.amount_cents-coalesce((select sum(rr.amount_cents) from public.invoice_refund_requests rr where rr.payment_id=pay.id and public.refund_state_internal(rr.id)<>'failed'),0)))) order by pay.id),'[]'::jsonb) into payments from public.invoice_payments pay where pay.invoice_id=invoice_row.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',rr.id,'payment_id',rr.payment_id,'amount_cents',public.native_finance_cents(rr.amount_cents),'reason',rr.reason,'actor_id',rr.actor_id,'created_at',rr.created_at,'state',public.refund_state_internal(rr.id),'settled',exists(select 1 from public.invoice_refunds settled where settled.request_id=rr.id),'credit_id',rl.credit_id,'dispense_id',rl.dispense_id) order by rr.id),'[]'::jsonb) into refunds from public.invoice_refund_requests rr left join public.native_dispense_refund_links rl on rl.id=rr.id where rr.invoice_id=invoice_row.id;
 item_capacity:=greatest(0,item_row.amount_cents-linked_credits-unallocated_credits);invoice_capacity:=case when invoice_row.status='draft' then 0 else greatest(0,invoice_row.total_cents-total_credits) end;
 if invoice_row.status='draft' then
  financial_hash:=public.native_fulfillment_hash(jsonb_build_object('invoice',to_jsonb(invoice_row),'items',coalesce((select jsonb_agg(to_jsonb(item) order by item.id) from public.billing_invoice_items item where item.invoice_id=invoice_row.id),'[]'::jsonb),'credits',coalesce((select jsonb_agg(to_jsonb(cr) order by cr.id) from public.billing_credits cr where cr.invoice_id=invoice_row.id),'[]'::jsonb),'payments',coalesce((select jsonb_agg(to_jsonb(pay) order by pay.id) from public.invoice_payments pay where pay.invoice_id=invoice_row.id),'[]'::jsonb),'refund_requests',coalesce((select jsonb_agg(to_jsonb(rr) order by rr.id) from public.invoice_refund_requests rr where rr.invoice_id=invoice_row.id),'[]'::jsonb)));
 else financial_hash:=public.payment_reconciliation_hash_internal(invoice_row.id);balance:=public.payment_balance_internal(invoice_row.id);
  for field_name in select jsonb_object_keys(balance) loop perform public.native_finance_cents((balance->>field_name)::numeric);end loop;
 end if;
 if invoice_row.status<>'issued' then blockers:=blockers||jsonb_build_array('invoice_not_issued');end if;
 if exists(select 1 from public.invoice_checkout_attempts attempts where attempts.invoice_id=invoice_row.id and public.checkout_state_internal(attempts.id) not in('paid','expired')) then blockers:=blockers||jsonb_build_array('checkout_unresolved');end if;
 if public.payment_invoice_has_observations(invoice_row.id)
  or exists(select 1 from public.invoice_payment_evidence ev join public.invoice_checkout_attempts attempts on attempts.id=ev.request_id where attempts.invoice_id=invoice_row.id and ev.disposition='quarantined' and public.payment_blocker_is_open('checkout_evidence',ev.id))
  or exists(select 1 from public.invoice_refund_evidence ev join public.invoice_refund_requests rr on rr.id=ev.request_id where rr.invoice_id=invoice_row.id and ev.disposition='quarantined' and public.payment_blocker_is_open('refund_evidence',ev.id))
  or exists(select 1 from public.invoice_checkout_attempts attempts where attempts.invoice_id=invoice_row.id and public.checkout_state_internal(attempts.id)='reconciliation')
  or exists(select 1 from public.invoice_refund_requests rr where rr.invoice_id=invoice_row.id and public.refund_state_internal(rr.id)='reconciliation') then blockers:=blockers||jsonb_build_array('payment_reconciliation');end if;
 select coalesce(jsonb_agg(code order by code),'[]'::jsonb) into blockers from(select distinct value code from jsonb_array_elements_text(blockers))codes;
 return jsonb_build_object('target',p_target,'authorization_hash',dispense->'authorization_hash','dispense_document_hash',public.native_fulfillment_hash(dispense),'invoice',jsonb_build_object('id',invoice_row.id,'client_id',invoice_row.client_id,'item_id',item_row.id,'version',invoice_row.version,'status',invoice_row.status,'currency','usd','total_cents',case when invoice_row.status='draft' then null else public.native_finance_cents(invoice_row.total_cents) end,'item_amount_cents',public.native_finance_cents(item_row.amount_cents)),
 'source_heads',jsonb_build_object('correction',corrections#>'{context,head}','returns',returns_read->'head','discrepancy',returns_read#>'{discrepancies,head}'),
 'clinical_context_hash',public.native_fulfillment_hash(jsonb_build_object('authorization_head',public.native_fulfillment_head(authorization_id),'corrections',corrections->'context','returns',returns_read)),'financial_context_hash',financial_hash,'credits',credits,'payments',payments,'refunds',refunds,'balance',balance,
 'capacity',jsonb_build_object('linked_credit_cents',public.native_finance_cents(linked_credits),'unallocated_credit_cents',public.native_finance_cents(unallocated_credits),'item_credit_capacity_cents',public.native_finance_cents(item_capacity),'invoice_credit_capacity_cents',public.native_finance_cents(invoice_capacity),'credit_capacity_cents',public.native_finance_cents(least(item_capacity,invoice_capacity))),'blockers',blockers);
end $$;
create function public.native_finance_review(p_intent jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();snapshot jsonb;context jsonb;blockers jsonb;eligible numeric;credit_json jsonb;payment_json jsonb;reserved numeric;begin
 perform public.native_finance_validate_intent(p_intent);snapshot:=public.native_finance_snapshot(p_intent->'target');blockers:=snapshot->'blockers';
 if p_intent->>'action'='credit' then eligible:=(snapshot#>>'{capacity,credit_capacity_cents}')::numeric;
 else
  select credit_entry.value into credit_json from jsonb_array_elements(snapshot->'credits') as credit_entry(value) where credit_entry.value->'id'=p_intent->'credit_id';
  select payment_entry.value into payment_json from jsonb_array_elements(snapshot->'payments') as payment_entry(value) where payment_entry.value->'id'=p_intent->'payment_id';
  if credit_json is null or credit_json->'dispense_id' is distinct from p_intent#>'{target,dispense_id}' or payment_json is null then raise exception 'Exact native credit and captured invoice payment required' using errcode='23514';end if;
  select coalesce(sum((refund_entry.value->>'amount_cents')::numeric),0) into reserved from jsonb_array_elements(snapshot->'refunds') as refund_entry(value) where refund_entry.value->'credit_id'=p_intent->'credit_id' and(refund_entry.value->'settled'='true'::jsonb or refund_entry.value->>'state'<>'failed');
  eligible:=greatest(0,least((credit_json->>'amount_cents')::numeric-reserved,(payment_json->>'remaining_cents')::numeric,coalesce((snapshot#>>'{balance,refundable_cents}')::numeric,0),99999999));
 end if;
 if jsonb_array_length(blockers)>0 then eligible:=0;end if;
 if (p_intent->>'amount_cents')::numeric>eligible then blockers:=blockers||jsonb_build_array(case when p_intent->>'action'='credit' then 'credit_capacity_exceeded' else 'refund_capacity_exceeded' end);end if;
 select coalesce(jsonb_agg(code order by code),'[]'::jsonb) into blockers from(select distinct value code from jsonb_array_elements_text(blockers))codes;
 context:=jsonb_build_object('snapshot',snapshot,'intent',p_intent,'eligible_amount_cents',public.native_finance_cents(eligible));perform public.clinical_require_staff();
 return jsonb_build_object('version',1,'actor_id',actor,'observed_at',clock_timestamp(),'context',context,'context_hash',public.native_fulfillment_hash(context),'allowed',jsonb_array_length(blockers)=0,'blockers',blockers);
end $$;
create function public.preview_native_dispense_finance(p_intent jsonb) returns jsonb language plpgsql security definer set search_path=public as $$begin perform public.clinical_require_staff();return public.native_finance_review(p_intent);end $$;
create function public.record_native_dispense_finance(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();existing public.native_dispense_finance_operations;intent jsonb;preview jsonb;context jsonb;snapshot jsonb;document jsonb;credit_row public.billing_credits;refund_row public.invoice_refund_requests;ledger_stamp timestamptz;authorization_id uuid;pet_id uuid;dispense_id uuid;invoice_id uuid;item_id uuid;begin
 if p_id is null then raise exception 'Stable financial operation id required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','attest_review']);intent:=p_request->'intent';perform public.native_finance_validate_intent(intent);
 if p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or p_request->>'expected_context_hash' !~ '^[0-9a-f]{64}$' then raise exception 'Explicit financial review and source hash required' using errcode='23514';end if;
 -- Both ledger operation locks precede the native authorization gate, including
 -- credit requests: a generic refund may otherwise win the same UUID concurrently.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));perform pg_advisory_xact_lock(hashtextextended(p_id::text,3003));perform public.clinical_require_staff();
 select * into existing from public.native_dispense_finance_operations op where op.id=p_id;
 if found then
  if existing.actor_id<>actor then raise exception 'Financial receipt unavailable' using errcode='42501';end if;
  if existing.request is distinct from p_request then raise exception 'Financial operation identifier already used' using errcode='23514';end if;
  return public.native_finance_verified_operation(p_id);
 end if;
 if exists(select 1 from public.billing_credits cr where cr.id=p_id) or exists(select 1 from public.invoice_refund_requests rr where rr.id=p_id) then raise exception 'Existing generic financial history cannot be adopted' using errcode='23514';end if;
 preview:=public.native_finance_review(intent);context:=preview->'context';snapshot:=context->'snapshot';
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' then raise exception 'Financial or clinical review changed; review again' using errcode='40001';end if;
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Financial operation blocked: %',preview->'blockers' using errcode='23514';end if;
 perform public.clinical_require_staff();authorization_id:=(intent#>>'{target,authorization_id}')::uuid;pet_id:=(intent#>>'{target,pet_id}')::uuid;dispense_id:=(intent#>>'{target,dispense_id}')::uuid;invoice_id:=(snapshot#>>'{invoice,id}')::uuid;item_id:=(snapshot#>>'{invoice,item_id}')::uuid;
 if intent->>'action'='credit' then
  credit_row:=public.credit_billing_invoice(p_id,invoice_id,(intent->>'amount_cents')::bigint,intent->>'reason');ledger_stamp:=credit_row.created_at;
  insert into public.native_dispense_credit_links(id,authorization_id,pet_id,dispense_id,invoice_id,invoice_item_id) values(p_id,authorization_id,pet_id,dispense_id,invoice_id,item_id);
 else
  refund_row:=public.prepare_invoice_refund(p_id,invoice_id,(intent->>'payment_id')::uuid,(intent->>'amount_cents')::bigint,intent->>'reason');ledger_stamp:=refund_row.created_at;
  insert into public.native_dispense_refund_links(id,authorization_id,pet_id,dispense_id,invoice_id,invoice_item_id,credit_id,payment_id) values(p_id,authorization_id,pet_id,dispense_id,invoice_id,item_id,(intent->>'credit_id')::uuid,(intent->>'payment_id')::uuid);
 end if;
 document:=jsonb_build_object('id',p_id,'target',intent->'target','action',intent->'action','actor_id',actor,'created_at',ledger_stamp,'invoice_id',invoice_id,'invoice_item_id',item_id,'credit_id',case when intent->>'action'='credit' then p_id else(intent->>'credit_id')::uuid end,'refund_request_id',case when intent->>'action'='refund' then p_id else null end,'payment_id',intent->'payment_id','amount_cents',intent->'amount_cents','currency','usd','reason',intent->'reason','reviewed_context',context,'reviewed_context_hash',preview->'context_hash');document:=document||jsonb_build_object('record_hash',public.native_fulfillment_hash(document));
 insert into public.native_dispense_finance_operations values(p_id,actor,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor,'operation','record_native_dispense_finance','request',p_request)),document,ledger_stamp);
 perform public.clinical_require_staff();return public.native_finance_verified_operation(p_id);
end $$;
create function public.recover_native_dispense_finance(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();owner_id uuid;begin
 select op.actor_id into owner_id from public.native_dispense_finance_operations op where op.id=p_id;if not found then return null;end if;if owner_id<>actor then raise exception 'Financial receipt unavailable' using errcode='42501';end if;return public.native_finance_verified_operation(p_id);
end $$;
create function public.read_native_dispense_finance(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();snapshot jsonb;results jsonb:='[]';operation_row record;begin
 snapshot:=public.native_finance_snapshot(jsonb_build_object('authorization_id',p_authorization_id,'pet_id',p_pet_id,'dispense_id',p_dispense_id));
 for operation_row in select op.id from public.native_dispense_finance_operations op where op.result#>>'{target,dispense_id}'=p_dispense_id::text order by op.created_at,op.id loop results:=results||jsonb_build_array(public.native_finance_verified_operation(operation_row.id)->'result');end loop;
 perform public.clinical_require_staff();return jsonb_build_object('version',1,'actor_id',actor,'snapshot',snapshot,'results',results);
end $$;
do $$declare fn record;begin
 for fn in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'native_finance_%' or proname in('preview_native_dispense_finance','record_native_dispense_finance','recover_native_dispense_finance','read_native_dispense_finance')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
  if fn.proname in('preview_native_dispense_finance','record_native_dispense_finance','recover_native_dispense_finance','read_native_dispense_finance') then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 end loop;
end $$;
