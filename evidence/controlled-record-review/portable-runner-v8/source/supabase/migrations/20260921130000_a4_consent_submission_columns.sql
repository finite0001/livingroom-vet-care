-- A4: the anonymous consent lookup must not disclose the signer's network
-- fingerprint. It previously returned the whole row, so anyone holding a valid,
-- unexpired consent token also received ip_address and user_agent - data the
-- signing page never shows. Recorded as [LOW] in
-- docs/COMMERCIAL-READINESS-REVIEW-2026-07-07.md ("get_consent_submission
-- returns the full row (SELECT *) to anonymous token holders").
--
-- The token check itself is deliberate and is unchanged: a client with a valid
-- unexpired token may read their own form. What changes is that the two
-- sensitive columns are redacted, and access_token is not echoed back (the
-- caller necessarily already holds it).
--
-- Why redaction rather than a narrower return type. The RPC's return shape is
-- inlined by the type generator into src/integrations/supabase/types.ts, and
-- that file was produced by a hosted-project generation whose format the local
-- CLI does not reproduce - regenerating locally rewrites the whole file (21,335
-- lines in a different shape, against 8,521 committed). Narrowing the return
-- type would therefore force a rewrite of a large generated file that this
-- repository cannot regenerate faithfully, and hand-editing that file is
-- forbidden. Redaction removes the disclosure with no change to the RPC's
-- signature or shape, so nothing downstream changes.
--
-- When a client consent signing screen is actually built (task E3), narrow the
-- return type then, and regenerate types.ts from the hosted project in that same
-- change. Until a consumer exists, redaction is the smaller, safer move.

create or replace function public.get_consent_submission(p_token text)
returns public.consent_submissions
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    template_id,
    client_id,
    pet_id,
    conversation_id,
    ticket_id,
    form_data,
    signature_data,
    signed_at,
    null::text as access_token,   -- the caller already holds this token
    expires_at,
    null::text as ip_address,     -- never disclosed to a token holder
    null::text as user_agent,     -- never disclosed to a token holder
    status,
    created_at
  from public.consent_submissions
  where access_token = p_token
    and expires_at > now()
  limit 1;
$$;
