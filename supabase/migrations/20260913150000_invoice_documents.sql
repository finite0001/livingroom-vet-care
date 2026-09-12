-- A single-statement read captures a consistent invoice/credit view for printing.
-- This is a current rendering, not a payment receipt or historical identity snapshot.
create function public.read_invoice_document(p_invoice_id uuid, p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 select jsonb_build_object(
  'id',i.id,'status',i.status,'currency',i.currency,'version',i.version,
  'created_at',i.created_at,'issued_at',i.issued_at,'voided_at',i.voided_at,
  'rendered_at',statement_timestamp(),
  'client',jsonb_build_object('id',c.id,'name',c.full_name,'mailing_address',c.mailing_address),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',l.id,'description',l.description,'quantity',l.quantity::text,
    'unit_price_cents',l.unit_price_cents::text,'amount_cents',l.amount_cents::text
  ) order by l.created_at,l.id) from public.billing_invoice_items l where l.invoice_id=i.id),'[]'::jsonb),
  'credits',coalesce((select jsonb_agg(jsonb_build_object(
    'id',cr.id,'amount_cents',cr.amount_cents::text,'created_at',cr.created_at
  ) order by cr.created_at,cr.id) from public.billing_credits cr where cr.invoice_id=i.id),'[]'::jsonb),
  'total_cents',coalesce(i.total_cents,(select coalesce(sum(l.amount_cents),0) from public.billing_invoice_items l where l.invoice_id=i.id))::text
 ) into result from public.billing_invoices i join public.clients c on c.id=i.client_id
 where i.id=p_invoice_id and i.client_id=p_client_id;
 if result is null then raise exception 'Invoice not available for this household' using errcode='42501'; end if;
 return result;
end $$;
revoke all on function public.read_invoice_document(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_document(uuid,uuid) to authenticated;
