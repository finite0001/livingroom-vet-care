-- Preserve existing trigger permissions and reject usable payment capabilities at persistence boundaries.
create or replace function public.reject_persisted_document_capability() returns trigger language plpgsql set search_path=public as $$
begin
 if to_jsonb(NEW)::text ~ '(v1|p1|s1)\.[A-Za-z0-9_-]{43}' then
  raise exception 'Use the reviewed private-link workflow; private capabilities cannot be stored in message history' using errcode='23514';
 end if;
 return NEW;
end $$;
create trigger reject_payment_capability before insert or update on public.payment_collection_grants for each row execute function public.reject_persisted_document_capability();
create trigger reject_payment_capability before insert or update on public.payment_collection_captures for each row execute function public.reject_persisted_document_capability();
create trigger reject_payment_capability before insert or update on public.payment_collection_events for each row execute function public.reject_persisted_document_capability();
