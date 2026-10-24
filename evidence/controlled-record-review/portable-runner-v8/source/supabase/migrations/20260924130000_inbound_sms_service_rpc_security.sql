-- Inbound SMS webhook ingestion is intentionally a service-role-only RPC.
-- The launch-readiness schema revokes direct service_role table writes on
-- conversations, messages, and SMS consent tables, so the RPC must run through
-- its definer-owned body after the Edge handler verifies Twilio signatures.

alter function public.record_inbound_sms(
  text,
  text,
  text,
  text,
  text,
  timestamptz
) security definer;

alter function public.record_inbound_sms(
  text,
  text,
  text,
  text,
  text,
  timestamptz
) set search_path = public;
