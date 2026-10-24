-- Additive correction: migration 190 has already been installed in staging.
-- Existing care retries and the preserved start-attempt chain take the care
-- eligibility gate before an outbox row. Every new reminder writer must join
-- that order before acquiring its own gate or any invoice/outbox row:
-- care eligibility -> invoice reminder gate -> invoice -> outbox.
create or replace function public.invoice_reminder_lock() returns void
language plpgsql set search_path=public as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Invoice reminders require READ COMMITTED' using errcode='23514';
 end if;
 perform public.care_eligibility_lock();
 perform pg_advisory_xact_lock(80261015);
end $$;
revoke all on function public.invoice_reminder_lock() from public,anon,authenticated,service_role;
