-- A4: prove the anonymous consent lookup no longer discloses the signer's
-- network fingerprint.
--
-- The leak was never the token check, which is deliberate and stays. It was that
-- the lookup returned the whole row, so a token holder also learned the signer's
-- ip_address and user_agent.
--
-- These assertions prove redaction rather than absence: the stored row is given
-- an IP address and a user agent, and the anonymous caller is then shown NULL
-- for both. If someone removes the redaction, the first of these fails.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into public.clients(id,first_name,last_name,full_name)
  values ('a4000000-0000-4000-8000-000000000001','Synthetic','A4','Synthetic A4');
insert into public.consent_form_templates(id,name)
  values ('a4000000-0000-4000-8000-000000000002','Synthetic A4 template');
insert into public.consent_submissions(id,template_id,client_id,access_token,expires_at,ip_address,user_agent)
  values
   ('a4000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000001','a4-valid-token',now()+interval '1 day',
    '203.0.113.7','Synthetic Agent/1.0'),
   ('a4000000-0000-4000-8000-000000000004','a4000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000001','a4-expired-token',now()-interval '1 day',
    '203.0.113.8','Synthetic Agent/1.0');

-- The stored row really does carry the fingerprint, so a NULL below can only be
-- redaction.
select is(
  (select ip_address from public.consent_submissions where access_token = 'a4-valid-token'),
  '203.0.113.7',
  'The stored submission holds the signer IP address, so redaction is what a NULL proves');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);

select is(
  (public.get_consent_submission('a4-valid-token')).id,
  'a4000000-0000-4000-8000-000000000003'::uuid,
  'A valid unexpired token still resolves the submission');

select is(
  (public.get_consent_submission('a4-valid-token')).ip_address,
  null::text,
  'The anonymous caller is not given the signer IP address');

select is(
  (public.get_consent_submission('a4-valid-token')).user_agent,
  null::text,
  'The anonymous caller is not given the signer user agent');

select is(
  (public.get_consent_submission('a4-valid-token')).access_token,
  null::text,
  'The token is not echoed back to the caller who supplied it');

select is(
  (select array_agg(k order by k)
     from jsonb_object_keys(to_jsonb(public.get_consent_submission('a4-valid-token'))) k),
  array['access_token','client_id','conversation_id','created_at','expires_at','form_data',
        'id','ip_address','pet_id','signature_data','signed_at','status','template_id','ticket_id','user_agent'],
  'The response shape is unchanged, so no caller sees a different contract');

select is(
  (public.get_consent_submission('a4-expired-token')).id,
  null::uuid,
  'An expired token resolves nothing');

select is(
  (public.get_consent_submission('a4-unknown-token')).id,
  null::uuid,
  'An unknown token resolves nothing');

select ok(has_function_privilege('anon','public.get_consent_submission(text)','execute'),
  'An anonymous holder of a token can still call the lookup');
select ok(has_function_privilege('authenticated','public.get_consent_submission(text)','execute'),
  'Authenticated callers keep execution');
select ok(not has_function_privilege('service_role','public.get_consent_submission(text)','execute'),
  'service_role is still denied execution');
select ok(
  (select not exists (
     select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE')
   from pg_proc p where p.oid = 'public.get_consent_submission(text)'::regprocedure),
  'PUBLIC is still denied execution');

select * from finish();
rollback;
