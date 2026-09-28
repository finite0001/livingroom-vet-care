-- AgentMail inbound email (owner decision 2026-09-27): client email replies now
-- arrive through an AgentMail inbox instead of Resend receiving. Resend remains
-- the outbound email provider and its delivery/status receipts are unchanged.
--
-- AgentMail messages enter the SAME durable pipeline as the retired Resend
-- inbound path: signed webhook -> receive_communication_event (provider
-- 'agentmail', event type 'inbound' only) -> process-inbound fetches the message
-- from the AgentMail API -> complete_inbound_communication (household match,
-- RFC reply threading, review queue) -> staff-authorized attachment capture into
-- the private inbound-attachment-originals bucket.
--
-- Identity mapping (done by the Edge adapter, never by browsers):
--  * resource_id is a deterministic UUID derived from the AgentMail inbox and
--    message ids, so the existing uuid-typed capture identity (email_id) and the
--    unique(provider,resource_id) idempotency hold unchanged.
--  * the signed AgentMail message id and inbox id stay in the durable event
--    metadata; attachment capture reads them from there, never from redacted
--    message columns or from the caller.
--
-- Functions are rewritten in place from their LIVE definitions (the pattern of
-- 20260913430000), never re-declared from an older copy: that keeps the
-- expired-lease guard 20260913430000 added to complete_inbound_communication.
-- Every needle must occur exactly once or the migration fails.
--
-- Resend inbound is retired at the Edge (resend-webhook is an inert 410 stub and
-- the delivery handler refuses email.received). Existing Resend inbound rows and
-- their captures keep working, so provider 'resend' stays valid here.

alter table public.communication_provider_events drop constraint communication_provider_events_provider_check;
alter table public.communication_provider_events add constraint communication_provider_events_provider_check
  check (provider in ('resend','twilio','agentmail'));

do $migration$
declare
  item record;
  definition text;
  pair text[];
  occurrences integer;
begin
  for item in
    select * from (values
      -- AgentMail is receive-only for the app: one inbound event per signed
      -- delivery, carrying the exact provider identity the worker and capture fetch.
      ('public.receive_communication_event(text,text,text,text,text,jsonb)'::regprocedure, array[
        array[$n$p_provider not in ('resend','twilio')$n$, $r$p_provider not in ('resend','twilio','agentmail')$r$],
        array[$n$ -- Receipt callbacks can arrive before$n$, $r$ if p_provider='agentmail' and (p_event_type<>'inbound'
   or p_resource_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_metadata->'message_id') is distinct from 'string' or length(p_metadata->>'message_id') not between 3 and 998
   or jsonb_typeof(p_metadata->'inbox_id') is distinct from 'string' or length(p_metadata->>'inbox_id') not between 1 and 320
   or jsonb_typeof(p_metadata->'from') is distinct from 'string' or jsonb_typeof(p_metadata->'to') is distinct from 'string') then
  raise exception 'Invalid provider event' using errcode='23514'; end if;
 -- Receipt callbacks can arrive before$r$]
      ]),
      -- AgentMail, like Resend, is an EMAIL channel.
      ('public.complete_inbound_communication(uuid,uuid,text,text,text,text,text,text,text[],jsonb,timestamptz,text)'::regprocedure, array[
        array[$n$channel:=case when event.provider='resend' then 'EMAIL' else 'SMS' end;$n$, $r$channel:=case when event.provider in ('resend','agentmail') then 'EMAIL' else 'SMS' end;$r$]
      ]),
      -- Capture accepts AgentMail originals; the lease names the provider and the
      -- signed provider ids from the durable receipt (never redacted columns).
      ('public.claim_inbound_attachment(uuid,uuid,integer,uuid)'::regprocedure, array[
        array[$n$token uuid:=gen_random_uuid();$n$, $r$token uuid:=gen_random_uuid();receipt jsonb;$r$],
        array[$n$incoming.provider<>'resend'$n$, $r$incoming.provider not in ('resend','agentmail')$r$],
        array[$n$ select count(*),jsonb_agg(value)->0 into matches,meta$n$, $r$ if incoming.provider='agentmail' then
  select e.metadata into receipt from public.communication_provider_events e
   where e.id=incoming.event_id and e.provider='agentmail' and e.resource_id=incoming.resource_id and e.event_type='inbound';
  if receipt is null or jsonb_typeof(receipt->'message_id') is distinct from 'string' or jsonb_typeof(receipt->'inbox_id') is distinct from 'string' then
   raise exception 'Reviewed inbound message changed or is unavailable' using errcode='42501';end if;
 end if;
 select count(*),jsonb_agg(value)->0 into matches,meta$r$],
        array[$n$'storage_path',capture.storage_path,'metadata',capture.metadata));$n$, $r$'storage_path',capture.storage_path,'metadata',capture.metadata,
 'provider',incoming.provider,'provider_message_id',receipt->>'message_id','provider_inbox_id',receipt->>'inbox_id'));$r$]
      ]),
      ('public.finalize_inbound_attachment(uuid,uuid,uuid,text,bigint,text)'::regprocedure, array[
        array[$n$incoming.provider<>'resend'$n$, $r$incoming.provider not in ('resend','agentmail')$r$]
      ]),
      ('public.authorize_inbound_attachment_read(uuid,uuid,uuid)'::regprocedure, array[
        array[$n$incoming.provider<>'resend'$n$, $r$incoming.provider not in ('resend','agentmail')$r$]
      ]),
      ('public.list_inbound_message_attachments(uuid[])'::regprocedure, array[
        array[$n$i.provider='resend'$n$, $r$i.provider in ('resend','agentmail')$r$]
      ])
    ) as rewrites(signature, pairs)
  loop
    definition := pg_get_functiondef(item.signature);
    foreach pair slice 1 in array item.pairs loop
      occurrences := (length(definition) - length(replace(definition, pair[1], ''))) / length(pair[1]);
      if occurrences <> 1 then
        raise exception 'Expected exactly one % in %, found %', pair[1], item.signature, occurrences;
      end if;
      definition := replace(definition, pair[1], pair[2]);
    end loop;
    -- create or replace keeps owner, grants and security definer settings.
    execute definition;
  end loop;
end
$migration$;
