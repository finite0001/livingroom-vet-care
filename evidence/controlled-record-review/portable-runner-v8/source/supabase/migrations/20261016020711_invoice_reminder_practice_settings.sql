-- Configure billing reminders before an invoice exists. Reuse the existing
-- immutable policy/save receipt contracts; this read changes no delivery gate.
create function public.read_invoice_reminder_practice(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.invoice_reminder_actor(p_actor_id,true);
begin
 return jsonb_build_object('actor_id',actor,
  'policy',(select to_jsonb(p)from public.invoice_reminder_policies p order by version desc limit 1),
  'scheduler',public.invoice_reminder_scheduler_status());
end $$;
revoke all on function public.read_invoice_reminder_practice(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_reminder_practice(uuid) to authenticated;
