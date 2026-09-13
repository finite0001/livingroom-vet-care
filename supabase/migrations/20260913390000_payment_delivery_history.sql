-- Original actor-scoped discovery; receipt/history reads do not reauthorize delivery.
create function public.list_payment_deliveries(p_invoice_id uuid,p_grant_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();client uuid;items jsonb;more boolean;
begin
 select client_id into client from public.billing_invoices where id=p_invoice_id;
 if not found then raise exception 'Invoice unavailable' using errcode='42501';end if;
 if p_grant_id is not null and not exists(select 1 from public.payment_collection_grants where id=p_grant_id and invoice_id=p_invoice_id and client_id=client and actor_id=actor) then raise exception 'Payment grant unavailable for this invoice' using errcode='42501';end if;
 select coalesce(jsonb_agg(public.recover_payment_delivery(r.id) order by r.created_at desc,r.id desc),'[]'::jsonb) into items
 from (select id,created_at from public.payment_delivery_requests where invoice_id=p_invoice_id and client_id=client and actor_id=actor and (p_grant_id is null or grant_id=p_grant_id) order by created_at desc,id desc limit 100) r;
 select exists(select 1 from public.payment_delivery_requests where invoice_id=p_invoice_id and client_id=client and actor_id=actor and (p_grant_id is null or grant_id=p_grant_id) offset 100) into more;
 return jsonb_build_object('invoice_id',p_invoice_id,'client_id',client,'grant_id',p_grant_id,'deliveries',items,'has_more',more);
end $$;
revoke all on function public.list_payment_deliveries(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_payment_deliveries(uuid,uuid) to authenticated;
