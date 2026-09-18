-- Publication foundation only. Delivery, client decisions and accepted-line execution remain separate.
create table public.native_estimate_publication_preparations (
  id uuid primary key,
  actor_id uuid not null references public.profiles (id),
  request jsonb not null,
  request_hash text not null,
  context jsonb not null,
  source_hash text not null,
  snapshot jsonb not null,
  content_hash text not null,
  created_at timestamptz not null
);

create table public.native_estimate_publication_artifacts (
  id uuid primary key references public.native_estimate_publication_preparations (id),
  bytes bytea not null,
  metadata jsonb not null,
  captured_at timestamptz not null
);

create table public.native_estimate_publication_events (
  id uuid primary key,
  estimate_id uuid not null references public.native_estimate_drafts (id),
  version integer not null check (version > 0),
  actor_id uuid not null references public.profiles (id),
  mutation jsonb not null,
  request_hash text not null,
  document jsonb not null,
  created_at timestamptz not null,
  unique (estimate_id, version)
);

create table public.native_estimate_publication_closures (
  id uuid primary key,
  actor_id uuid not null references public.profiles (id),
  mutation jsonb not null,
  request_hash text not null,
  closed_at timestamptz not null,
  record_hash text not null
);

do $$
declare
  t text;
begin
  foreach t in array array['native_estimate_publication_preparations', 'native_estimate_publication_artifacts', 'native_estimate_publication_events', 'native_estimate_publication_closures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role', t);
    execute format('create trigger native_estimate_publication_immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()', t);
    execute format('create trigger native_estimate_publication_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()', t);
    execute format('create trigger native_estimate_publication_audit after insert on public.%I for each row execute function public.native_rx_audit()', t);
  end loop;
end
$$;

create function public.native_estpub_hash (v jsonb)
  returns void
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
begin
  if jsonb_typeof(v) is distinct from 'string' or v #>> '{}' !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact publication hash required'
      using errcode = '23514';
  end if;
end
$$;

create function public.native_estpub_target (v jsonb)
  returns void
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
declare
  k text;
begin
  perform
    public.native_rx_keys (v, array['estimate_id', 'client_id', 'pet_id']);
  foreach k in array array['estimate_id', 'client_id', 'pet_id'] loop
    perform
      public.native_correction_uuid (v -> k, false);
  end loop;
end
$$;

create function public.native_estpub_empty_head ()
  returns jsonb
  language sql
  immutable
  security definer
  set search_path = public
  as $$
  select
    jsonb_build_object('event_id', null, 'version', 0, 'record_hash', null)
$$;

create function public.native_estpub_head (v jsonb)
  returns void
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
begin
  perform
    public.native_rx_keys (v, array['event_id', 'version', 'record_hash']);
  if v -> 'version' = '0'::jsonb then
    if v is distinct from public.native_estpub_empty_head () then
      raise exception 'Empty publication head invalid'
        using errcode = '23514';
    end if;
  else
    perform
      public.native_estimate_positive_int (v -> 'version');
    perform
      public.native_correction_uuid (v -> 'event_id', false);
    perform
      public.native_estpub_hash (v -> 'record_hash');
  end if;
end
$$;

create function public.native_estpub_practice ()
  returns jsonb
  language sql
  immutable
  security definer
  set search_path = public
  as $$
  select
    '{"version":1,"name":"The Living Room Veterinary Care","address":"2619 Spruce Street, Boulder, CO","domain":"thelivingroom.vet"}'::jsonb
$$;

create function public.native_estpub_prepare_request (v jsonb)
  returns void
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
begin
  perform
    public.native_rx_keys (v, array['target', 'draft_version', 'expected_source_hash', 'expected_publication_head', 'replaces_publication_id']);
  perform
    public.native_estpub_target (v -> 'target');
  perform
    public.native_estimate_positive_int (v -> 'draft_version');
  perform
    public.native_estpub_hash (v -> 'expected_source_hash');
  perform
    public.native_estpub_head (v -> 'expected_publication_head');
  perform
    public.native_correction_uuid (v -> 'replaces_publication_id', true);
end
$$;

create function public.native_estpub_mutation (v jsonb)
  returns void
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
declare
  q jsonb := v -> 'request';
begin
  perform
    public.native_rx_keys (v, array['kind', 'request']);
  if v ->> 'kind' = 'publish' then
    perform
      public.native_rx_keys (q, array['target', 'preparation_id', 'expected_draft_version', 'expected_publication_head', 'expected_content_hash', 'expected_artifact_hash', 'replaces_publication_id', 'attest_document_review', 'attest_pricing_review', 'attest_terms_review']);
    perform
      public.native_correction_uuid (q -> 'preparation_id', false);
    perform
      public.native_estimate_positive_int (q -> 'expected_draft_version');
    perform
      public.native_estpub_hash (q -> 'expected_content_hash');
    perform
      public.native_estpub_hash (q -> 'expected_artifact_hash');
    perform
      public.native_correction_uuid (q -> 'replaces_publication_id', true);
    if q -> 'attest_document_review' is distinct from 'true'::jsonb or q -> 'attest_pricing_review' is distinct from 'true'::jsonb or q -> 'attest_terms_review' is distinct from 'true'::jsonb then
      raise exception 'Publication review attestations required'
        using errcode = '23514';
    end if;
  elsif v ->> 'kind' = 'withdraw' then
    perform
      public.native_rx_keys (q, array['target', 'publication_id', 'expected_publication_head', 'reason', 'attest_review']);
    perform
      public.native_correction_uuid (q -> 'publication_id', false);
    perform
      public.native_rx_text (q -> 'reason', 2000);
    if q -> 'attest_review' is distinct from 'true'::jsonb then
      raise exception 'Withdrawal review required'
        using errcode = '23514';
    end if;
  else
    raise exception 'Exact publication mutation required'
      using errcode = '23514';
  end if;
  perform
    public.native_estpub_target (q -> 'target');
  perform
    public.native_estpub_head (q -> 'expected_publication_head');
end
$$;

create function public.native_estpub_snapshot (p_id uuid, p_context jsonb, p_stamp timestamptz)
  returns jsonb
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
declare
  d jsonb := p_context -> 'draft';
  ls jsonb;
begin
  select
    jsonb_agg(jsonb_build_object('line', value, 'amount_cents', case when value #>> '{pricing,kind}' = 'unit' then
          public.native_finance_cents (round((value ->> 'quantity')::numeric * (value #>> '{pricing,unit_price_cents}')::numeric))
        else
          value #>> '{pricing,amount_cents}'
        end)
    order by ord)
  into
    ls
  from
    jsonb_array_elements(d #> '{fields,lines}')
  with ordinality a (value, ord);
  return jsonb_build_object('schema_version', 1, 'preparation_id', p_id, 'prepared_at', p_stamp, 'target', p_context -> 'target', 'draft_version', d -> 'version', 'draft_record_hash', p_context -> 'draft_record_hash', 'practice', p_context -> 'practice', 'client', p_context -> 'client', 'patient', p_context -> 'patient', 'title', d #> '{fields,title}', 'notes', d #> '{fields,notes}', 'terms', d #> '{fields,terms}', 'lines', ls, 'total_cents', d -> 'total_cents', 'currency', 'usd', 'acceptance', jsonb_build_object('accept_by', d #> '{fields,accept_by}', 'timezone', 'America/Denver', 'expires_at', ((public.native_rx_day (d #> '{fields,accept_by}') + 1)::timestamp at time zone 'America/Denver'), 'acknowledgment_version', 1, 'scope', 'entire_exact_revision', 'price_validity', 'accepted_quantities', 'not_clinical_consent', true, 'not_payment', true));
end
$$;

create function public.native_estpub_artifact (p_id uuid, p_snapshot jsonb, p_bytes bytea)
  returns jsonb
  language plpgsql
  immutable
  security definer
  set search_path = public
  as $$
declare
  html text;
begin
  if p_bytes is null or octet_length(p_bytes)
    not between 1 and 2097152 then
    raise exception 'Bounded publication artifact required'
      using errcode = '23514';
  end if;
  html := convert_from(p_bytes, 'UTF8');
  if strpos(html, 'default-src ''none''; style-src ''unsafe-inline''; base-uri ''none''; form-action ''none''') = 0 or html !~* '<!doctype html>' or html ~* '<[[:space:]]*(script|iframe|object|embed|base|form|a|link|img|video|audio|input|button|textarea|select|svg|math)([[:space:]/>])' or html ~* '<[a-z][^>]*[[:space:]]on[a-z]+[[:space:]]*=' or html ~* '<[a-z][^>]*javascript[[:space:]]*:' or html ~* '<[a-z][^>]*style[[:space:]]*=[^>]*(url[[:space:]]*\(|@import)' or html ~* '<style[^>]*>[^<]*(url[[:space:]]*\(|@import)' then
    raise exception 'Publication artifact contains unsupported active content'
      using errcode = '23514';
  end if;
  return jsonb_build_object('filename', 'estimate-' || (p_snapshot #>> '{target,estimate_id}') || '-draft-' || (p_snapshot ->> 'draft_version') || '-publication-' || p_id::text || '.html', 'mime_type', 'text/html; charset=utf-8', 'byte_length', octet_length(p_bytes), 'sha256', encode(sha256 (p_bytes), 'hex'), 'renderer_version', 1);
exception
  when character_not_in_repertoire
    or untranslatable_character then
    raise exception 'Publication artifact must be UTF-8' using errcode = '23514';
end
$$;

-- No recursive lifecycle folds here. Callers verify the lifecycle separately when needed.
create function public.native_estpub_preparation (p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  p public.native_estimate_publication_preparations;
  a public.native_estimate_publication_artifacts;
  d jsonb;
  c jsonb;
  h jsonb;
  e public.native_estimate_publication_events;
begin
  select
    *
  into
    p
  from
    public.native_estimate_publication_preparations s
  where
    s.id = p_id;
  if not found then
    return null;
  end if;
  perform
    public.native_estpub_prepare_request (p.request);
  c := p.context;
  perform
    public.native_rx_keys (c, array['target', 'draft', 'draft_record_hash', 'publication_head', 'current_publication_id', 'practice', 'client', 'patient']);
  perform
    public.native_estpub_target (c -> 'target');
  perform
    public.native_estpub_head (c -> 'publication_head');
  perform
    public.native_correction_uuid (c -> 'current_publication_id', true);
  d := public.native_estimate_verified_revision ((c #>> '{target,estimate_id}')::uuid, (p.request ->> 'draft_version')::integer);
  if d is null or c -> 'draft' is distinct from d or c #> '{target,client_id}' is distinct from d -> 'client_id' or c #> '{target,pet_id}' is distinct from d -> 'pet_id' or c -> 'practice' is distinct from public.native_estpub_practice () or c -> 'target' is distinct from p.request -> 'target' or c -> 'publication_head' is distinct from p.request -> 'expected_publication_head' or c -> 'current_publication_id' is distinct from p.request -> 'replaces_publication_id' then
    raise exception 'Publication preparation source mismatch'
      using errcode = '23514';
  end if;
  if c ->> 'draft_record_hash' is distinct from (
    select
      r.record_hash
    from
      public.native_estimate_draft_revisions r
    where
      r.estimate_id = (d ->> 'id')::uuid and r.version = (d ->> 'version')::integer) then
    raise exception 'Publication draft hash mismatch'
      using errcode = '23514';
  end if;
  perform
    public.native_rx_keys (c -> 'client', array['id', 'version', 'name', 'mailing_address']);
  perform
    public.native_estimate_positive_int (c #> '{client,version}');
  perform
    public.native_rx_text (c #> '{client,name}', 301);
  if c #> '{client,mailing_address}' is distinct from 'null'::jsonb then
    perform
      public.native_rx_text (c #> '{client,mailing_address}', 1000);
  end if;
  perform
    public.native_rx_keys (c -> 'patient', array['id', 'version', 'name', 'species', 'breed']);
  perform
    public.native_estimate_positive_int (c #> '{patient,version}');
  perform
    public.native_rx_text (c #> '{patient,name}', 150);
  perform
    public.native_rx_text (c #> '{patient,species}', 100);
  if c #> '{patient,breed}' is distinct from 'null'::jsonb then
    perform
      public.native_rx_text (c #> '{patient,breed}', 150);
  end if;
  if c #> '{client,id}' is distinct from d -> 'client_id' or c #> '{patient,id}' is distinct from d -> 'pet_id' or not isfinite(p.created_at) or p.snapshot is distinct from public.native_estpub_snapshot (p.id, c, p.created_at) or p.created_at >= (p.snapshot #>> '{acceptance,expires_at}')::timestamptz or p.request_hash is distinct from public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', p.actor_id, 'operation', 'prepare_estimate_publication', 'request', p.request)) or p.source_hash is distinct from public.native_fulfillment_hash (c) or p.request ->> 'expected_source_hash' is distinct from p.source_hash or p.content_hash is distinct from public.native_fulfillment_hash (p.snapshot) then
    raise exception 'Publication preparation evidence invalid'
      using errcode = '23514';
  end if;
  h := c -> 'publication_head';
  if h -> 'version' = '0'::jsonb then
    if c -> 'current_publication_id' is distinct from 'null'::jsonb then
      raise exception 'Empty publication context has current publication'
        using errcode = '23514';
    end if;
  else
    select
      *
    into
      e
    from
      public.native_estimate_publication_events ev
    where
      ev.id = (h ->> 'event_id')::uuid;
    if e.id is null or e.estimate_id <> (d ->> 'id')::uuid or e.version <> (h ->> 'version')::integer or e.document -> 'record_hash' is distinct from h -> 'record_hash' or e.document ->> 'record_hash' is distinct from public.native_fulfillment_hash (e.document - 'record_hash') or e.created_at > p.created_at or c -> 'current_publication_id' is distinct from (
  case when e.document ->> 'kind' = 'withdrawn' then
    'null'::jsonb
  else
    e.document -> 'publication_id'
  end) then
raise exception 'Publication preparation historical head invalid'
        using errcode = '23514';
    end if;
  end if;
  select
    *
  into
    a
  from
    public.native_estimate_publication_artifacts ar
  where
    ar.id = p_id;
  if a.id is not null and (a.metadata is distinct from public.native_estpub_artifact (p_id, p.snapshot, a.bytes) or not isfinite(a.captured_at) or a.captured_at < p.created_at) then
    raise exception 'Publication captured bytes invalid'
      using errcode = '23514';
  end if;
  return jsonb_build_object('version', 1, 'id', p.id, 'actor_id', p.actor_id, 'request', p.request, 'request_hash', p.request_hash, 'context', c, 'source_hash', p.source_hash, 'snapshot', p.snapshot, 'content_hash', p.content_hash, 'artifact', a.metadata, 'created_at', p.created_at);
end
$$;

create function public.native_estpub_lifecycle (p_estimate_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  r public.native_estimate_drafts;
  e public.native_estimate_publication_events;
  h jsonb := public.native_estpub_empty_head ();
  target jsonb;
  current_pub jsonb;
  latest_pub jsonb;
  events jsonb := '[]';
  p jsonb;
  q jsonb;
  expected jsonb;
  pub jsonb;
  stamp timestamptz;
begin
  select
    *
  into
    r
  from
    public.native_estimate_drafts dr
  where
    dr.id = p_estimate_id;
  if not found then
    raise exception 'Estimate root required'
      using errcode = '23514';
  end if;
  target := jsonb_build_object('estimate_id', r.id, 'client_id', r.client_id, 'pet_id', r.pet_id);
  for e in
  select
    ev.*
  from
    public.native_estimate_publication_events ev
  where
    ev.estimate_id = p_estimate_id
  order by
    ev.version loop
      perform
        public.native_estpub_mutation (e.mutation);
      q := e.mutation -> 'request';
      if e.version::bigint <> (h ->> 'version')::bigint + 1 or q -> 'target' is distinct from target or q -> 'expected_publication_head' is distinct from h or not isfinite(e.created_at) or e.created_at < stamp or exists (
      select
        1
      from
        public.native_estimate_publication_closures cl
      where
        cl.id = e.id) or e.request_hash is distinct from public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', e.actor_id, 'operation', 'record_estimate_publication', 'mutation', e.mutation)) then
        raise exception 'Publication lifecycle identity mismatch'
          using errcode = '23514';
      end if;
      if e.mutation ->> 'kind' = 'publish' then
        p := public.native_estpub_preparation ((q ->> 'preparation_id')::uuid);
        if p is null or p ->> 'actor_id' <> e.actor_id::text or p #> '{request,target}' is distinct from target or p #> '{request,draft_version}' is distinct from q -> 'expected_draft_version' or p #> '{request,expected_publication_head}' is distinct from h or p -> 'content_hash' is distinct from q -> 'expected_content_hash' or p -> 'artifact' = 'null'::jsonb or p #> '{artifact,sha256}' is distinct from q -> 'expected_artifact_hash' or q -> 'replaces_publication_id' is distinct from coalesce(current_pub -> 'id', 'null'::jsonb) or p #> '{request,replaces_publication_id}' is distinct from q -> 'replaces_publication_id' or e.created_at < (p ->> 'created_at')::timestamptz or e.created_at >= (p #>> '{snapshot,acceptance,expires_at}')::timestamptz or e.created_at < (
      select
        a.captured_at
      from
        public.native_estimate_publication_artifacts a
      where
        a.id = (p ->> 'id')::uuid) then
          raise exception 'Published preparation mismatch'
            using errcode = '23514';
        end if;
        pub := jsonb_build_object('id', e.id, 'target', target, 'preparation_id', q -> 'preparation_id', 'draft_version', q -> 'expected_draft_version', 'draft_record_hash', p #> '{snapshot,draft_record_hash}', 'content_hash', p -> 'content_hash', 'artifact', p -> 'artifact', 'accept_by', p #> '{snapshot,acceptance,accept_by}', 'expires_at', p #> '{snapshot,acceptance,expires_at}', 'published_by', e.actor_id, 'published_at', e.created_at, 'replaces_publication_id', q -> 'replaces_publication_id');
        expected := jsonb_build_object('id', e.id, 'target', target, 'version', e.version, 'previous_hash', h -> 'record_hash', 'kind', 'published', 'actor_id', e.actor_id, 'created_at', e.created_at, 'publication_id', e.id, 'publication', pub, 'reason', null);
        current_pub := pub;
        latest_pub := pub;
      else
        if current_pub is null or current_pub -> 'id' is distinct from q -> 'publication_id' then
          raise exception 'Withdrawal must bind current publication'
            using errcode = '23514';
        end if;
        expected := jsonb_build_object('id', e.id, 'target', target, 'version', e.version, 'previous_hash', h -> 'record_hash', 'kind', 'withdrawn', 'actor_id', e.actor_id, 'created_at', e.created_at, 'publication_id', q -> 'publication_id', 'publication', null, 'reason', q -> 'reason');
        current_pub := null;
      end if;
      expected := expected || jsonb_build_object('record_hash', public.native_fulfillment_hash (expected));
      if e.document is distinct from expected then
        raise exception 'Publication event evidence mismatch'
          using errcode = '23514';
      end if;
      h := jsonb_build_object('event_id', e.id, 'version', e.version, 'record_hash', expected -> 'record_hash');
      stamp := e.created_at;
      events := events || jsonb_build_array(expected);
    end loop;
  return jsonb_build_object('target', target, 'head', h, 'current', current_pub, 'latest_publication', latest_pub, 'events', events);
end
$$;

create function public.native_estpub_context (p_estimate_id uuid, p_client_id uuid, p_draft_version integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  d jsonb;
  l jsonb;
  c public.clients;
  p public.pets;
  v integer;
begin
  perform
    pg_advisory_xact_lock(hashtextextended('native-estimate:' || p_estimate_id::text, 0));
  perform
    public.clinical_require_staff ();
  l := public.native_estpub_lifecycle (p_estimate_id);
  if p_client_id is null or l #>> '{target,client_id}' is distinct from p_client_id::text then
    raise exception 'Publication household mismatch'
      using errcode = '23514';
  end if;
  select
    max(r.version)
  into
    v
  from
    public.native_estimate_draft_revisions r
  where
    r.estimate_id = p_estimate_id;
  if p_draft_version is distinct from v then
    raise exception 'Estimate draft changed'
      using errcode = '40001';
  end if;
  d := public.native_estimate_verified_revision (p_estimate_id, v);
  select
    *
  into
    c
  from
    public.clients cl
  where
    cl.id = p_client_id for share;
  select
    *
  into
    p
  from
    public.pets pt
  where
    pt.id = (d ->> 'pet_id')::uuid for share;
  perform
    public.clinical_require_staff ();
  if c.id is null or p.id is null or p.client_id <> c.id then
    raise exception 'Current publication household and patient mismatch'
      using errcode = '23514';
  end if;
  return jsonb_build_object('target', l -> 'target', 'draft', d, 'draft_record_hash', (
      select
        r.record_hash
      from public.native_estimate_draft_revisions r
      where
        r.estimate_id = p_estimate_id
        and r.version = v), 'publication_head', l -> 'head', 'current_publication_id', l #> '{current,id}', 'practice', public.native_estpub_practice (), 'client', jsonb_build_object('id', c.id, 'version', c.version, 'name', c.full_name, 'mailing_address', nullif (btrim(c.mailing_address), '')),'patient',jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'species',p.species,'breed',nullif(btrim(p.breed),'')));
end
$$;

create function public.preview_native_estimate_publication (p_estimate_id uuid, p_client_id uuid, p_draft_version integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  c jsonb;
begin
  c := public.native_estpub_context (p_estimate_id, p_client_id, p_draft_version);
  return jsonb_build_object('version', 1, 'actor_id', actor, 'context', c, 'source_hash', public.native_fulfillment_hash (c));
end
$$;

create function public.prepare_native_estimate_publication (p_id uuid, p_request jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  p jsonb;
  c jsonb;
  s jsonb;
  stamp timestamptz;
begin
  if p_id is null then
    raise exception 'Preparation operation id required'
      using errcode = '23514';
  end if;
  perform
    public.native_estpub_prepare_request (p_request);
  perform
    pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  perform
    public.clinical_require_staff ();
  p := public.native_estpub_preparation (p_id);
  if p is not null then
    if p ->> 'actor_id' <> actor::text then
      raise exception 'Preparation unavailable'
        using errcode = '42501';
    end if;
    if p -> 'request' is distinct from p_request then
      raise exception 'Preparation id already used'
        using errcode = '23514';
    end if;
    perform
      public.native_estpub_lifecycle ((p_request #>> '{target,estimate_id}')::uuid);
    return p;
  end if;
  c := public.native_estpub_context ((p_request #>> '{target,estimate_id}')::uuid, (p_request #>> '{target,client_id}')::uuid, (p_request ->> 'draft_version')::integer);
  if c -> 'target' is distinct from p_request -> 'target' then
    raise exception 'Preparation target mismatch'
      using errcode = '23514';
  end if;
  if public.native_fulfillment_hash (c) is distinct from p_request ->> 'expected_source_hash' or c -> 'publication_head' is distinct from p_request -> 'expected_publication_head' or c -> 'current_publication_id' is distinct from p_request -> 'replaces_publication_id' then
    raise exception 'Publication preparation review changed'
      using errcode = '40001';
  end if;
  stamp := clock_timestamp();
  s := public.native_estpub_snapshot (p_id, c, stamp);
  if stamp >= (s #>> '{acceptance,expires_at}')::timestamptz then
    raise exception 'Estimate acceptance deadline expired'
      using errcode = '23514';
  end if;
  insert into public.native_estimate_publication_preparations
    values (p_id, actor, p_request, public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', actor, 'operation', 'prepare_estimate_publication', 'request', p_request)), c, public.native_fulfillment_hash (c), s, public.native_fulfillment_hash (s), stamp);
  perform
    public.clinical_require_staff ();
  return public.native_estpub_preparation (p_id);
end
$$;

create function public.recover_native_estimate_preparation (p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  p jsonb;
begin
  p := public.native_estpub_preparation (p_id);
  if p is not null then
    if p ->> 'actor_id' <> actor::text then
      raise exception 'Preparation unavailable'
        using errcode = '42501';
    end if;
    perform
      public.native_estpub_lifecycle ((p #>> '{request,target,estimate_id}')::uuid);
  end if;
  return p;
end
$$;

create function public.native_estimate_capture_context (p_id uuid, p_actor_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  p jsonb;
begin
  perform
    public.communication_require_service ();
  p := public.native_estpub_preparation (p_id);
  if p is null or p ->> 'actor_id' is distinct from p_actor_id::text or not public.is_active_staff (p_actor_id) then
    raise exception 'Preparation unavailable'
      using errcode = '42501';
  end if;
  perform
    public.native_estpub_lifecycle ((p #>> '{request,target,estimate_id}')::uuid);
  return jsonb_build_object('preparation', p, 'captured', p -> 'artifact' <> 'null'::jsonb);
end
$$;

create function public.capture_native_estimate_publication_artifact (p_id uuid, p_actor_id uuid, p_content_hash text, p_renderer_version integer, p_html_utf8_base64 text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  p jsonb;
  b bytea;
  m jsonb;
  a public.native_estimate_publication_artifacts;
begin
  perform
    public.communication_require_service ();
  if p_id is null or p_html_utf8_base64 is null or length(p_html_utf8_base64) > 2796204 or p_html_utf8_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' then
    raise exception 'Bounded canonical artifact bytes required'
      using errcode = '23514';
  end if;
  perform
    pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  p := public.native_estpub_preparation (p_id);
  if p is null or p ->> 'actor_id' is distinct from p_actor_id::text then
    raise exception 'Preparation unavailable'
      using errcode = '42501';
  end if;
  perform
    pg_advisory_xact_lock(hashtextextended('native-estimate:' || (p #>> '{request,target,estimate_id}'), 0));
  if not public.is_active_staff (p_actor_id) then
    raise exception 'Active preparation creator required'
      using errcode = '42501';
  end if;
  perform
    public.native_estpub_lifecycle ((p #>> '{request,target,estimate_id}')::uuid);
  if p ->> 'content_hash' is distinct from p_content_hash or p_renderer_version is distinct from 1 then
    raise exception 'Capture source mismatch'
      using errcode = '23514';
  end if;
  b := decode(p_html_utf8_base64, 'base64');
  if replace(encode(b, 'base64'), E'\n', '') <> p_html_utf8_base64 then
    raise exception 'Canonical artifact encoding required'
      using errcode = '23514';
  end if;
  m := public.native_estpub_artifact (p_id, p -> 'snapshot', b);
  select
    *
  into
    a
  from
    public.native_estimate_publication_artifacts ar
  where
    ar.id = p_id;
  if found then
    if a.bytes is distinct from b or a.metadata is distinct from m then
      raise exception 'Captured artifact immutable'
        using errcode = '23514';
    end if;
    return a.metadata;
  end if;
  insert into public.native_estimate_publication_artifacts
  values
    (p_id, b, m, greatest (clock_timestamp(),
      (p ->> 'created_at')::timestamptz));
  if not public.is_active_staff (p_actor_id) then
    raise exception 'Active preparation creator required'
      using errcode = '42501';
  end if;
  perform
    public.native_estpub_preparation (p_id);
  return m;
exception
  when invalid_parameter_value
    or invalid_text_representation then
    raise exception 'Invalid encoded publication artifact' using errcode = '23514';
end
$$;

create function public.native_estpub_receipt (p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  e public.native_estimate_publication_events;
begin
  select
    *
  into
    e
  from
    public.native_estimate_publication_events ev
  where
    ev.id = p_id;
  if not found then
    return null;
  end if;
  perform
    public.native_estpub_lifecycle (e.estimate_id);
  return jsonb_build_object('version', 1, 'id', e.id, 'actor_id', e.actor_id, 'mutation', e.mutation, 'request_hash', e.request_hash, 'result', e.document, 'created_at', e.created_at);
end
$$;

create function public.native_estpub_closure (p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  c public.native_estimate_publication_closures;
  d jsonb;
begin
  select
    *
  into
    c
  from
    public.native_estimate_publication_closures cl
  where
    cl.id = p_id;
  if not found then
    return null;
  end if;
  perform
    public.native_estpub_mutation (c.mutation);
  if exists (
    select
      1
    from
      public.native_estimate_publication_events ev
    where
      ev.id = p_id)
    or not isfinite(c.closed_at)
    or c.request_hash is distinct from public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', c.actor_id, 'operation', 'record_estimate_publication', 'mutation', c.mutation)) then
    raise exception 'Publication closure invalid'
    using errcode = '23514';
end if;
  d := jsonb_build_object('version', 1, 'id', c.id, 'actor_id', c.actor_id, 'mutation', c.mutation, 'request_hash', c.request_hash, 'closed_at', c.closed_at);
  if c.record_hash is distinct from public.native_fulfillment_hash (d) then
    raise exception 'Publication closure hash mismatch'
      using errcode = '23514';
  end if;
  return d || jsonb_build_object('record_hash', c.record_hash);
end
$$;

create function public.native_estpub_record (p_id uuid, p_mutation jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  q jsonb := p_mutation -> 'request';
  l jsonb;
  p jsonb;
  c jsonb;
  d jsonb;
  pub jsonb;
  old jsonb;
  root_id uuid;
  stamp timestamptz;
  ver integer;
begin
  if p_id is null then
    raise exception 'Publication operation id required'
      using errcode = '23514';
  end if;
  perform
    public.native_estpub_mutation (p_mutation);
  perform
    pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  perform
    public.clinical_require_staff ();
  old := public.native_estpub_receipt (p_id);
  if old is not null then
    if old ->> 'actor_id' <> actor::text then
      raise exception 'Publication receipt unavailable'
        using errcode = '42501';
    end if;
    if old -> 'mutation' is distinct from p_mutation then
      raise exception 'Publication operation id already used'
        using errcode = '23514';
    end if;
    return old;
  end if;
  old := public.native_estpub_closure (p_id);
  if old is not null then
    if old ->> 'actor_id' <> actor::text then
      raise exception 'Publication closure unavailable'
        using errcode = '42501';
    end if;
    raise exception 'Publication operation permanently closed'
      using errcode = '23514';
  end if;
  root_id := (q #>> '{target,estimate_id}')::uuid;
  perform
    pg_advisory_xact_lock(hashtextextended('native-estimate:' || root_id::text, 0));
  perform
    public.clinical_require_staff ();
  l := public.native_estpub_lifecycle (root_id);
  if q -> 'target' is distinct from l -> 'target' then
    raise exception 'Publication target mismatch'
      using errcode = '23514';
  end if;
  if q -> 'expected_publication_head' is distinct from l -> 'head' then
    raise exception 'Publication lifecycle changed'
      using errcode = '40001';
  end if;
  if l #>> '{head,version}' = '2147483647' then
    raise exception 'Publication history version limit'
      using errcode = '23514';
  end if;
  ver := (l #>> '{head,version}')::integer + 1;
  if p_mutation ->> 'kind' = 'publish' then
    p := public.native_estpub_preparation ((q ->> 'preparation_id')::uuid);
    if p is null or p ->> 'actor_id' <> actor::text then
      raise exception 'Publication preparation unavailable'
        using errcode = '42501';
    end if;
    if p #> '{request,target}' is distinct from q -> 'target' or p #> '{request,draft_version}' is distinct from q -> 'expected_draft_version' or p -> 'content_hash' is distinct from q -> 'expected_content_hash' or p #> '{artifact,sha256}' is distinct from q -> 'expected_artifact_hash' then
      raise exception 'Exact captured preparation required'
        using errcode = '23514';
    end if;
    c := public.native_estpub_context (root_id, (q #>> '{target,client_id}')::uuid, (q ->> 'expected_draft_version')::integer);
    if c is distinct from p -> 'context' or q -> 'replaces_publication_id' is distinct from coalesce(l #> '{current,id}', 'null'::jsonb) then
      raise exception 'Prepared publication source changed'
        using errcode = '40001';
    end if;
    stamp := greatest (clock_timestamp(), (
      select
        max(ev.created_at)
      from public.native_estimate_publication_events ev
      where
        ev.estimate_id = root_id), (
        select
          a.captured_at
        from public.native_estimate_publication_artifacts a
        where
          a.id = (p ->> 'id')::uuid));
    if stamp >= (p #>> '{snapshot,acceptance,expires_at}')::timestamptz then
      raise exception 'Estimate acceptance deadline expired'
        using errcode = '23514';
    end if;
    pub := jsonb_build_object('id', p_id, 'target', q -> 'target', 'preparation_id', q -> 'preparation_id', 'draft_version', q -> 'expected_draft_version', 'draft_record_hash', p #> '{snapshot,draft_record_hash}', 'content_hash', p -> 'content_hash', 'artifact', p -> 'artifact', 'accept_by', p #> '{snapshot,acceptance,accept_by}', 'expires_at', p #> '{snapshot,acceptance,expires_at}', 'published_by', actor, 'published_at', stamp, 'replaces_publication_id', q -> 'replaces_publication_id');
    d := jsonb_build_object('id', p_id, 'target', q -> 'target', 'version', ver, 'previous_hash', l #> '{head,record_hash}', 'kind', 'published', 'actor_id', actor, 'created_at', stamp, 'publication_id', p_id, 'publication', pub, 'reason', null);
  else
    if l -> 'current' = 'null'::jsonb or l #> '{current,id}' is distinct from q -> 'publication_id' then
      raise exception 'Current publication changed'
        using errcode = '40001';
    end if;
    stamp := greatest (clock_timestamp(), (
      select
        max(ev.created_at)
      from public.native_estimate_publication_events ev
      where
        ev.estimate_id = root_id));
    d := jsonb_build_object('id', p_id, 'target', q -> 'target', 'version', ver, 'previous_hash', l #> '{head,record_hash}', 'kind', 'withdrawn', 'actor_id', actor, 'created_at', stamp, 'publication_id', q -> 'publication_id', 'publication', null, 'reason', q -> 'reason');
  end if;
  d := d || jsonb_build_object('record_hash', public.native_fulfillment_hash (d));
  perform
    public.clinical_require_staff ();
  insert into public.native_estimate_publication_events
    values (p_id, root_id, ver, actor, p_mutation, public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', actor, 'operation', 'record_estimate_publication', 'mutation', p_mutation)), d, stamp);
  return public.native_estpub_receipt (p_id);
end
$$;

create function public.publish_native_estimate (p_id uuid, p_request jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
begin
  return public.native_estpub_record (p_id, jsonb_build_object('kind', 'publish', 'request', p_request));
end
$$;

create function public.withdraw_native_estimate (p_id uuid, p_request jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
begin
  return public.native_estpub_record (p_id, jsonb_build_object('kind', 'withdraw', 'request', p_request));
end
$$;

create function public.recover_native_estimate_publication_operation (p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  r jsonb;
begin
  r := public.native_estpub_receipt (p_id);
  if r is not null and r ->> 'actor_id' <> actor::text then
    raise exception 'Publication receipt unavailable'
      using errcode = '42501';
  end if;
  return r;
end
$$;

create function public.close_native_estimate_publication_operation (p_id uuid, p_mutation jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  r jsonb;
  d jsonb;
  stamp timestamptz;
  h text;
begin
  if p_id is null then
    raise exception 'Publication operation id required'
      using errcode = '23514';
  end if;
  perform
    public.native_estpub_mutation (p_mutation);
  perform
    pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  perform
    public.clinical_require_staff ();
  r := public.native_estpub_receipt (p_id);
  if r is not null then
    if r ->> 'actor_id' <> actor::text then
      raise exception 'Publication receipt unavailable'
        using errcode = '42501';
    end if;
    if r -> 'mutation' is distinct from p_mutation then
      raise exception 'Publication operation id already used'
        using errcode = '23514';
    end if;
    return jsonb_build_object('version', 1, 'status', 'recorded', 'receipt', r);
  end if;
  d := public.native_estpub_closure (p_id);
  if d is not null then
    if d ->> 'actor_id' <> actor::text then
      raise exception 'Publication closure unavailable'
        using errcode = '42501';
    end if;
    if d -> 'mutation' is distinct from p_mutation then
      raise exception 'Publication closure request changed'
        using errcode = '23514';
    end if;
  else
    stamp := clock_timestamp();
    h := public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', actor, 'operation', 'record_estimate_publication', 'mutation', p_mutation));
    d := jsonb_build_object('version', 1, 'id', p_id, 'actor_id', actor, 'mutation', p_mutation, 'request_hash', h, 'closed_at', stamp);
    insert into public.native_estimate_publication_closures
      values (p_id, actor, p_mutation, h, stamp, public.native_fulfillment_hash (d));
    d := public.native_estpub_closure (p_id);
  end if;
  perform
    public.clinical_require_staff ();
  return jsonb_build_object('version', 1, 'status', 'closed_unrecorded', 'closure', d);
end
$$;

create function public.read_native_estimate_publication (p_estimate_id uuid, p_client_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  l jsonb;
  status text;
begin
  l := public.native_estpub_lifecycle (p_estimate_id);
  if l #>> '{target,client_id}' is distinct from p_client_id::text then
    raise exception 'Publication household mismatch'
      using errcode = '23514';
  end if;
  status := case when l -> 'latest_publication' = 'null'::jsonb then
    'none'
  when l -> 'current' = 'null'::jsonb then
    'withdrawn'
  when clock_timestamp() >= (l #>> '{current,expires_at}')::timestamptz then
    'expired'
  else
    'open'
  end;
  return jsonb_build_object('version', 1, 'actor_id', actor, 'target', l -> 'target', 'head', l -> 'head', 'current', l -> 'current', 'current_status', status, 'latest_publication', l -> 'latest_publication');
end
$$;

create function public.read_native_estimate_publication_history (p_estimate_id uuid, p_client_id uuid, p_before_version integer, p_limit integer)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  l jsonb;
  e jsonb;
  events jsonb := '[]';
  n integer := 0;
  more boolean := false;
  cursor_version integer;
begin
  if p_limit is null or p_limit not between 1 and 100 or (p_before_version is not null and p_before_version < 1) then
    raise exception 'Valid publication history page required'
      using errcode = '23514';
  end if;
  l := public.native_estpub_lifecycle (p_estimate_id);
  if l #>> '{target,client_id}' is distinct from p_client_id::text then
    raise exception 'Publication household mismatch'
      using errcode = '23514';
  end if;
  for e in
  select
    value
  from
    jsonb_array_elements(l -> 'events')
  where
    p_before_version is null
    or (value ->> 'version')::integer < p_before_version
  order by
    (value ->> 'version')::integer desc
  limit p_limit + 1 loop
    n := n + 1;
    if n > p_limit then
      more := true;
      exit;
    end if;
    events := events || jsonb_build_array(e);
    cursor_version := (e ->> 'version')::integer;
  end loop;
  return jsonb_build_object('version', 1, 'actor_id', actor, 'target', l -> 'target', 'head', l -> 'head', 'events', events, 'has_more', more, 'next_before_version', case when more then
      cursor_version
    else
      null
    end);
end
$$;

create function public.read_native_estimate_published_revision (p_publication_id uuid, p_client_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  e public.native_estimate_publication_events;
  l jsonb;
  p jsonb;
  status text;
begin
  select
    *
  into
    e
  from
    public.native_estimate_publication_events ev
  where
    ev.id = p_publication_id;
  if not found or e.document ->> 'kind' <> 'published' then
    raise exception 'Published revision unavailable'
      using errcode = '23514';
  end if;
  l := public.native_estpub_lifecycle (e.estimate_id);
  if l #>> '{target,client_id}' is distinct from p_client_id::text then
    raise exception 'Publication household mismatch'
      using errcode = '23514';
  end if;
  p := public.native_estpub_preparation ((e.document #>> '{publication,preparation_id}')::uuid);
  status := case when l #>> '{latest_publication,id}' <> p_publication_id::text then
    'superseded'
  when l -> 'current' = 'null'::jsonb then
    'withdrawn'
  when clock_timestamp() >= (e.document #>> '{publication,expires_at}')::timestamptz then
    'expired'
  else
    'open'
  end;
  return jsonb_build_object('version', 1, 'actor_id', actor, 'publication', e.document -> 'publication', 'snapshot', p -> 'snapshot', 'head', l -> 'head', 'status', status);
end
$$;

create function public.read_native_estimate_publication_artifact (p_preparation_id uuid, p_client_id uuid, p_expected_artifact_hash text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
declare
  actor uuid := public.clinical_require_staff ();
  p jsonb;
  a public.native_estimate_publication_artifacts;
begin
  p := public.native_estpub_preparation (p_preparation_id);
  if p is null or p #>> '{request,target,client_id}' is distinct from p_client_id::text then
    raise exception 'Publication artifact unavailable'
      using errcode = '42501';
  end if;
  perform
    public.native_estpub_lifecycle ((p #>> '{request,target,estimate_id}')::uuid);
  if p ->> 'actor_id' <> actor::text and not exists (
    select
      1
    from
      public.native_estimate_publication_events ev
    where
      ev.document #>> '{publication,preparation_id}' = p_preparation_id::text) then
    raise exception 'Unpublished artifact creator required'
      using errcode = '42501';
  end if;
  select
    *
  into
    a
  from
    public.native_estimate_publication_artifacts ar
  where
    ar.id = p_preparation_id;
  if a.id is null or a.metadata ->> 'sha256' is distinct from p_expected_artifact_hash then
    raise exception 'Exact captured artifact unavailable'
      using errcode = '23514';
  end if;
  return jsonb_build_object('artifact', a.metadata, 'content_base64', replace(encode(a.bytes, 'base64'), E'\n', ''));
end
$$;

create function public.native_estpub_integrity ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
begin
  if TG_TABLE_NAME in ('native_estimate_publication_preparations', 'native_estimate_publication_artifacts') then
    perform
      public.native_estpub_preparation (new.id);
  elsif TG_TABLE_NAME = 'native_estimate_publication_events' then
    perform
      public.native_estpub_receipt (new.id);
  else
    perform
      public.native_estpub_closure (new.id);
  end if;
  return NEW;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['native_estimate_publication_preparations', 'native_estimate_publication_artifacts', 'native_estimate_publication_events', 'native_estimate_publication_closures'] loop
    execute format('create constraint trigger native_estimate_publication_valid after insert on public.%I deferrable initially deferred for each row execute function public.native_estpub_integrity()', t);
  end loop;
end
$$;

do $$
declare
  f record;
begin
  for f in
  select
    oid::regprocedure signature,
    proname
  from
    pg_proc
  where
    pronamespace = 'public'::regnamespace
    and (proname like 'native_estpub_%'
      or proname in ('preview_native_estimate_publication', 'prepare_native_estimate_publication', 'recover_native_estimate_preparation', 'native_estimate_capture_context', 'capture_native_estimate_publication_artifact', 'publish_native_estimate', 'withdraw_native_estimate', 'recover_native_estimate_publication_operation', 'close_native_estimate_publication_operation', 'read_native_estimate_publication', 'read_native_estimate_publication_history', 'read_native_estimate_published_revision', 'read_native_estimate_publication_artifact'))
      loop
        execute format('revoke all on function %s from public,anon,authenticated,service_role', f.signature);
        if f.proname in ('native_estimate_capture_context', 'capture_native_estimate_publication_artifact') then
          execute format('grant execute on function %s to service_role', f.signature);
        elsif f.proname not like 'native_estpub_%' then
          execute format('grant execute on function %s to authenticated', f.signature);
        end if;
      end loop;
end
$$;

