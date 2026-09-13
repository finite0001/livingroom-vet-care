-- Invoice-scoped administrator discovery uses only already attributed provider IDs.
create function public.list_payment_reconciliation_workspace(p_invoice_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.payment_require_admin();r record;context jsonb;target jsonb;known text;reviewable boolean;targets jsonb:='[]'::jsonb;cases jsonb;
begin
 if not exists(select 1 from public.billing_invoices where id=p_invoice_id) then raise exception 'Invoice unavailable' using errcode='42501';end if;
 for r in
 select 'checkout'::text family,id,created_at from public.invoice_checkout_attempts where invoice_id=p_invoice_id
 union all select 'refund'::text family,id,created_at from public.invoice_refund_requests where invoice_id=p_invoice_id
 order by created_at desc,id
 loop
  if r.family='checkout' then context:=public.provider_checkout_context(r.id);known:=context->>'session_id';
  else context:=public.provider_refund_context(r.id);known:=context->>'refund_id';end if;
  if known is null then continue;end if;
  reviewable:=false;
  begin
   target:=public.payment_reconciliation_target_internal(p_invoice_id,r.family,r.id,known);
   reviewable:=jsonb_array_length(target->'blocker_refs')>0;
  exception when check_violation or insufficient_privilege then
   -- Unsupported conflicts remain visible, never converted into a clear-all action.
   reviewable:=false;
  end;
  targets:=targets||jsonb_build_array(jsonb_build_object('family',r.family,'request_id',r.id,'provider_object_id',known,'amount_cents',context->>'amount_cents','currency',context->>'currency','state',context->>'state','reviewable',reviewable));
 end loop;
 select coalesce(jsonb_agg(public.read_payment_reconciliation(c.id) order by c.created_at desc,c.id),'[]'::jsonb) into cases
 from (select id,created_at from public.payment_reconciliation_cases where invoice_id=p_invoice_id and actor_id=actor order by created_at desc,id limit 100) c;
 return jsonb_build_object('invoice_id',p_invoice_id,'targets',targets,'cases',cases,'has_more_cases',exists(select 1 from public.payment_reconciliation_cases where invoice_id=p_invoice_id and actor_id=actor offset 100));
end $$;
revoke all on function public.list_payment_reconciliation_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_payment_reconciliation_workspace(uuid) to authenticated;
