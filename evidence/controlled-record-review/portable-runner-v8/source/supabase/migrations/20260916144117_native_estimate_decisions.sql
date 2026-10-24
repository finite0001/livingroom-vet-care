-- Immutable commercial decisions and dedicated access capabilities. No clinical or financial effects.
create table public.native_estimate_decision_grants (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  estimate_id uuid not null references public.native_estimate_drafts(id),
  publication_id uuid not null references public.native_estimate_publication_events(id),
  request jsonb not null,
  request_hash text not null,
  expires_at timestamptz not null check(isfinite(expires_at)),
  created_at timestamptz not null check(isfinite(created_at))
);
create table public.native_estimate_decision_grant_captures (
  grant_id uuid primary key references public.native_estimate_decision_grants(id),
  origin text not null, key_version text not null, capability_context text not null,
  context_hash text not null, token_hash text not null,
  captured_at timestamptz not null check(isfinite(captured_at)), record_hash text not null
);
create table public.native_estimate_decision_grant_events (
  id uuid primary key,
  grant_id uuid not null references public.native_estimate_decision_grants(id),
  estimate_id uuid not null references public.native_estimate_drafts(id),
  sequence integer not null check(sequence>0), grant_version integer not null check(grant_version>0),
  previous_hash text, document jsonb not null,
  created_at timestamptz not null check(isfinite(created_at)),
  unique(estimate_id,sequence), unique(grant_id,grant_version)
);
create table public.native_estimate_decisions (
  id uuid primary key,
  estimate_id uuid not null references public.native_estimate_drafts(id),
  publication_id uuid not null unique references public.native_estimate_publication_events(id),
  sequence integer not null check(sequence>0), principal jsonb not null,
  request_hash text not null, document jsonb not null,
  created_at timestamptz not null check(isfinite(created_at)), unique(estimate_id,sequence)
);
create table public.native_estimate_decision_operations (
  id uuid primary key, family text not null check(family in ('grant','decision')),
  principal jsonb not null, mutation jsonb not null, request_hash text not null,
  receipt jsonb not null, created_at timestamptz not null check(isfinite(created_at))
);
create table public.native_estimate_decision_closures (
  id uuid primary key, family text not null check(family in ('grant','decision')),
  principal jsonb not null, mutation jsonb not null, request_hash text not null,
  closed_by jsonb not null, reason text,
  closed_at timestamptz not null check(isfinite(closed_at)), record_hash text not null
);
create table public.native_estimate_decision_access_budget (
  grant_id uuid primary key references public.native_estimate_decision_grants(id),
  window_started_at timestamptz not null check(isfinite(window_started_at)),
  used integer not null check(used between 0 and 60)
);

create function public.native_estdec_time(p_time timestamptz) returns text
language sql immutable security definer set search_path=public as $$
  select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function public.native_estdec_instant(v jsonb) returns timestamptz
language plpgsql immutable security definer set search_path=public as $$
begin
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then
    raise exception 'Canonical UTC decision timestamp required' using errcode='23514';
  end if;
  return public.native_correction_instant(v);
end $$;

create function public.native_estdec_binding(v jsonb) returns void
language plpgsql immutable security definer set search_path=public as $$
begin
  perform public.native_rx_keys(v,array['target','publication_id','content_hash','artifact_hash']);
  perform public.native_estpub_target(v->'target');
  perform public.native_correction_uuid(v->'publication_id',false);
  perform public.native_estpub_hash(v->'content_hash');
  perform public.native_estpub_hash(v->'artifact_hash');
end $$;

create function public.native_estdec_principal(v jsonb) returns void
language plpgsql immutable security definer set search_path=public as $$
begin
  perform public.native_rx_keys(v,array['kind','id']);
  if jsonb_typeof(v->'kind') is distinct from 'string' or v->>'kind' not in ('staff','grant') then raise exception 'Invalid decision principal' using errcode='23514'; end if;
  perform public.native_correction_uuid(v->'id',false);
end $$;

create function public.native_estdec_request(v jsonb,p_grant boolean) returns void
language plpgsql immutable security definer set search_path=public as $$
begin
  perform public.native_rx_keys(v,array['binding','grant_id','expected_publication_head','choice','signer_name','signer_relationship','comment','acknowledgment_version','attest_document_review','attest_authority','attest_choice']);
  perform public.native_estdec_binding(v->'binding');
  perform public.native_estpub_head(v->'expected_publication_head');
  perform public.native_correction_uuid(v->'grant_id',not p_grant);
  if not p_grant and v->'grant_id' is distinct from 'null'::jsonb then raise exception 'Witness cannot impersonate a grant' using errcode='23514'; end if;
  perform public.native_rx_text(v->'signer_name',200);
  if v->'comment'<>'null'::jsonb then perform public.native_rx_text(v->'comment',2000); end if;
  if jsonb_typeof(v->'choice') is distinct from 'string' or jsonb_typeof(v->'signer_relationship') is distinct from 'string' or v->>'choice' not in ('accept','decline') or v->>'signer_relationship' not in ('owner','authorized_agent')
    or v->'acknowledgment_version' is distinct from '1'::jsonb
    or v->'attest_document_review' is distinct from 'true'::jsonb
    or v->'attest_authority' is distinct from 'true'::jsonb
    or v->'attest_choice' is distinct from 'true'::jsonb then
    raise exception 'Exact decision and explicit attestations required' using errcode='23514';
  end if;
end $$;

create function public.native_estdec_mutation(p_family text,v jsonb) returns void
language plpgsql immutable security definer set search_path=public as $$
declare q jsonb:=v->'request'; w jsonb;
begin
  perform public.native_rx_keys(v,array['kind','request']);
  if p_family='decision' and v->>'kind'='client_decision' then
    perform public.native_estdec_request(q,true);
  elsif p_family='decision' and v->>'kind'='witnessed_decision' then
    perform public.native_rx_keys(q,array['decision','witness']);
    perform public.native_estdec_request(q->'decision',false);
    w:=q->'witness';
    perform public.native_rx_keys(w,array['channel','occurred_at','note','attest_direct_client_instruction']);
    if jsonb_typeof(w->'channel') is distinct from 'string' or w->>'channel' not in ('in_person','telephone','video','written') or w->'attest_direct_client_instruction' is distinct from 'true'::jsonb then
      raise exception 'Direct witnessed client instruction required' using errcode='23514';
    end if;
    perform public.native_estdec_instant(w->'occurred_at');
    perform public.native_rx_text(w->'note',2000);
  elsif p_family='grant' and v->>'kind'='issue' then
    perform public.native_rx_keys(q,array['binding','expected_publication_head','expires_at','recipient_label','purpose','attest_recipient_authority']);
    perform public.native_estdec_binding(q->'binding');
    perform public.native_estpub_head(q->'expected_publication_head');
    perform public.native_estdec_instant(q->'expires_at');
    perform public.native_rx_text(q->'recipient_label',200);
    perform public.native_rx_text(q->'purpose',500);
    if q->'attest_recipient_authority' is distinct from 'true'::jsonb then raise exception 'Recipient review required' using errcode='23514'; end if;
  elsif p_family='grant' and v->>'kind'='activate' then
    perform public.native_rx_keys(q,array['grant_id','expected_grant_head','expected_publication_head','expected_context_hash','attest_review']);
    perform public.native_correction_uuid(q->'grant_id',false);
    perform public.native_estpub_head(q->'expected_grant_head');
    perform public.native_estpub_head(q->'expected_publication_head');
    perform public.native_estpub_hash(q->'expected_context_hash');
    if q->'attest_review' is distinct from 'true'::jsonb then raise exception 'Grant review required' using errcode='23514'; end if;
  elsif p_family='grant' and v->>'kind'='revoke' then
    perform public.native_rx_keys(q,array['grant_id','expected_grant_head','reason','attest_review']);
    perform public.native_correction_uuid(q->'grant_id',false);
    perform public.native_estpub_head(q->'expected_grant_head');
    perform public.native_rx_text(q->'reason',2000);
    if q->'attest_review' is distinct from 'true'::jsonb then raise exception 'Revocation review required' using errcode='23514'; end if;
  else raise exception 'Unknown estimate decision operation' using errcode='23514'; end if;
end $$;

create function public.native_estdec_request_hash(p_family text,p_principal jsonb,p_mutation jsonb) returns text
language sql immutable security definer set search_path=public as $$
  select public.native_fulfillment_hash(case when p_family='grant' then
    jsonb_build_object('version',1,'operation','record_estimate_decision_grant','actor_id',p_principal->'id','mutation',p_mutation)
    else jsonb_build_object('version',1,'operation','record_estimate_decision','principal',p_principal,'mutation',p_mutation) end)
$$;

create function public.native_estdec_publication(p_binding jsonb,p_lifecycle jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d jsonb; b jsonb;
begin
  perform public.native_estdec_binding(p_binding);
  select e.value->'publication' into d from jsonb_array_elements(p_lifecycle->'events') e
    where e.value->>'kind'='published' and e.value->'id'=p_binding->'publication_id';
  b:=jsonb_build_object('target',d->'target','publication_id',d->'id','content_hash',d->'content_hash','artifact_hash',d#>'{artifact,sha256}');
  if d is null or b is distinct from p_binding then raise exception 'Exact published estimate unavailable' using errcode='23514'; end if;
  return d;
end $$;

-- Validate an historical reviewed publication prefix, without applying present-day eligibility.
create function public.native_estdec_prefix(p_lifecycle jsonb,p_binding jsonb,p_head jsonb,p_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare e jsonb; current_id jsonb:='null'; seen boolean:=false;
begin
  perform public.native_estpub_head(p_head);
  for e in select z.value from jsonb_array_elements(p_lifecycle->'events') z loop
    if (e->>'version')::integer>(p_head->>'version')::integer then
      if (e->>'created_at')::timestamptz<p_at then raise exception 'Publication prefix was already obsolete' using errcode='23514'; end if;
      exit;
    end if;
    if e->>'kind'='published' then current_id:=e->'publication_id'; else current_id:='null'; end if;
    if e->'id'=p_head->'event_id' then
      seen:=true;
      if jsonb_build_object('event_id',e->'id','version',e->'version','record_hash',e->'record_hash') is distinct from p_head
        or (e->>'created_at')::timestamptz>p_at then raise exception 'Invalid publication prefix' using errcode='23514'; end if;
    end if;
  end loop;
  if not seen or current_id is distinct from p_binding->'publication_id' then raise exception 'Reviewed publication was not current' using errcode='23514'; end if;
end $$;

create function public.native_estdec_context(p_grant jsonb,p_origin text,p_key_version text) returns text
language plpgsql immutable security definer set search_path=public as $$
begin
  if p_origin is null or p_origin !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' and p_origin !~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$'
    or p_key_version is null or p_key_version !~ '^[A-Za-z0-9_-]{1,40}$' then
    raise exception 'Estimate capability configuration unavailable' using errcode='23514';
  end if;
  return jsonb_build_object('domain','lrv-estimate-decision/v1','context_version',1,'grant_id',p_grant->'id',
    'actor_id',p_grant->'actor_id','binding',p_grant#>'{request,binding}','expires_at',p_grant#>'{request,expires_at}',
    'origin',p_origin,'key_version',p_key_version)::text;
end $$;

create function public.native_estdec_grant_view(p_grant jsonb) returns jsonb
language sql immutable security definer set search_path=public as $$
  select case when p_grant->'capture'='null'::jsonb then p_grant else jsonb_set(p_grant,'{capture}',(p_grant->'capture')-'token_hash') end
$$;

-- Single fold for a grant. Receipt reconstruction never calls the operation verifier recursively.
create function public.native_estdec_grant_fold(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions set timezone='UTC' as $$
declare g public.native_estimate_decision_grants; c public.native_estimate_decision_grant_captures;
  ev public.native_estimate_decision_grant_events; op public.native_estimate_decision_operations;
  life jsonb; pub jsonb; state jsonb; d jsonb; expected jsonb; head jsonb:=public.native_estpub_empty_head();
  receipts jsonb:='[]'; events jsonb:='[]'; n integer:=0; prior_at timestamptz; context_text text; cap jsonb;
  m jsonb; rh text; capture_json jsonb:='null'; capability jsonb:='null'; principal jsonb;
begin
  select * into g from public.native_estimate_decision_grants where id=p_id;
  if not found then return null; end if;
  m:=jsonb_build_object('kind','issue','request',g.request);
  perform public.native_estdec_mutation('grant',m);
  principal:=jsonb_build_object('kind','staff','id',g.actor_id);
  rh:=public.native_estdec_request_hash('grant',principal,m);
  if rh<>g.request_hash or g.estimate_id::text is distinct from g.request#>>'{binding,target,estimate_id}'
    or g.publication_id::text is distinct from g.request#>>'{binding,publication_id}'
    or g.expires_at is distinct from (g.request->>'expires_at')::timestamptz or g.expires_at<=g.created_at then
    raise exception 'Invalid immutable estimate grant' using errcode='23514';
  end if;
  life:=public.native_estpub_lifecycle(g.estimate_id);
  pub:=public.native_estdec_publication(g.request->'binding',life);
  perform public.native_estdec_prefix(life,g.request->'binding',g.request->'expected_publication_head',g.created_at);
  if g.expires_at>(pub->>'expires_at')::timestamptz then raise exception 'Grant outlives publication' using errcode='23514'; end if;
  state:=jsonb_build_object('version',1,'id',g.id,'actor_id',g.actor_id,'request',g.request,'request_hash',g.request_hash,
    'created_at',public.native_estdec_time(g.created_at),'capability',null,'capture',null,'head',head,'state','preparing','activation',null,'revocation',null);
  select * into c from public.native_estimate_decision_grant_captures where grant_id=g.id;
  if found then
    context_text:=public.native_estdec_context(state,c.origin,c.key_version);
    perform public.native_estpub_hash(to_jsonb(c.token_hash));
    cap:=to_jsonb(c)-'record_hash';
    if c.capability_context<>context_text or c.context_hash<>encode(digest(convert_to(context_text,'UTF8'),'sha256'),'hex')
      or c.record_hash<>public.native_fulfillment_hash(cap) or c.captured_at<g.created_at or c.captured_at>=g.expires_at then
      raise exception 'Invalid immutable estimate grant capture' using errcode='23514';
    end if;
    perform public.native_estdec_prefix(life,g.request->'binding',g.request->'expected_publication_head',c.captured_at);
    capability:=jsonb_build_object('origin',c.origin,'key_version',c.key_version,'context_hash',c.context_hash);
    capture_json:=jsonb_build_object('token_hash',c.token_hash,'captured_at',public.native_estdec_time(c.captured_at));
  end if;
  prior_at:=g.created_at;
  for ev in select * from public.native_estimate_decision_grant_events where grant_id=g.id order by grant_version loop
    n:=n+1; d:=ev.document;
    if ev.sequence<>(select count(*) from public.native_estimate_decision_grant_events ge where ge.estimate_id=g.estimate_id and ge.sequence<=ev.sequence) then raise exception 'Grant history sequence gap' using errcode='23514'; end if;
    select * into op from public.native_estimate_decision_operations where id=ev.id;
    if not found then raise exception 'Missing grant operation' using errcode='23514'; end if;
    perform public.native_estdec_mutation('grant',op.mutation);
    principal:=op.principal; perform public.native_estdec_principal(principal);
    if principal->>'kind'<>'staff' or not exists(select 1 from public.profiles p where p.id=(principal->>'id')::uuid)
      or op.family<>'grant' or ev.grant_version<>n or ev.previous_hash is distinct from head->>'record_hash'
      or ev.estimate_id<>g.estimate_id or ev.created_at<prior_at then raise exception 'Invalid grant event chain' using errcode='23514'; end if;
    if n=1 then
      if ev.id<>g.id or ev.created_at<>g.created_at or principal->>'id'<>g.actor_id::text or op.mutation is distinct from m then
        raise exception 'Grant issue evidence mismatch' using errcode='23514'; end if;
    else
      if op.mutation#>>'{request,grant_id}'<>g.id::text or op.mutation#>'{request,expected_grant_head}' is distinct from head then
        raise exception 'Grant event target or head mismatch' using errcode='23514'; end if;
      if c.grant_id is not null and c.captured_at<=ev.created_at then
        state:=state||jsonb_build_object('capability',capability,'capture',capture_json);
        if state->>'state'='preparing' then state:=jsonb_set(state,'{state}','"captured"'); end if;
      end if;
      if op.mutation->>'kind'='activate' then
        if state->>'state'<>'captured' or (op.mutation#>>'{request,expected_context_hash}') is distinct from c.context_hash
          or ev.created_at>=g.expires_at then raise exception 'Grant activation evidence invalid' using errcode='23514'; end if;
        perform public.native_estdec_prefix(life,g.request->'binding',op.mutation#>'{request,expected_publication_head}',ev.created_at);
        state:=state||jsonb_build_object('state','active','activation',jsonb_build_object('id',ev.id,'actor_id',principal->'id','created_at',public.native_estdec_time(ev.created_at)));
      elsif op.mutation->>'kind'='revoke' then
        if state->>'state'='revoked' then raise exception 'Grant already revoked' using errcode='23514'; end if;
        state:=state||jsonb_build_object('state','revoked','revocation',jsonb_build_object('id',ev.id,'actor_id',principal->'id','reason',op.mutation#>'{request,reason}','created_at',public.native_estdec_time(ev.created_at)));
      else raise exception 'Invalid subsequent grant action' using errcode='23514'; end if;
    end if;
    expected:=jsonb_build_object('id',ev.id,'grant_id',g.id,'target',g.request#>'{binding,target}','sequence',ev.sequence,
      'grant_version',n,'previous_hash',head->'record_hash','kind',case op.mutation->>'kind' when 'issue' then 'issued' when 'activate' then 'activated' else 'revoked' end,
      'actor_id',principal->'id','created_at',public.native_estdec_time(ev.created_at),'request',op.mutation->'request');
    expected:=expected||jsonb_build_object('record_hash',public.native_fulfillment_hash(expected));
    if d is distinct from expected then raise exception 'Grant event hash or shape invalid' using errcode='23514'; end if;
    head:=jsonb_build_object('event_id',ev.id,'version',n,'record_hash',d->'record_hash');
    state:=jsonb_set(state,'{head}',head);
    expected:=jsonb_build_object('version',1,'id',ev.id,'actor_id',principal->'id','mutation',op.mutation,
      'request_hash',public.native_estdec_request_hash('grant',principal,op.mutation),'result',public.native_estdec_grant_view(state),'created_at',public.native_estdec_time(ev.created_at));
    if op.receipt is distinct from expected or op.request_hash is distinct from expected->>'request_hash' or op.created_at<>ev.created_at
      or exists(select 1 from public.native_estimate_decision_closures cl where cl.id=ev.id) then
      raise exception 'Grant receipt integrity failure' using errcode='23514'; end if;
    receipts:=receipts||jsonb_build_array(expected); events:=events||jsonb_build_array(d||jsonb_build_object('grant',expected->'result'));
    prior_at:=ev.created_at;
  end loop;
  if n=0 then raise exception 'Missing grant issue event' using errcode='23514'; end if;
  if c.grant_id is not null then
    if state->'revocation'<>'null'::jsonb and c.captured_at>(state#>>'{revocation,created_at}')::timestamptz then raise exception 'Capture after revocation' using errcode='23514'; end if;
    state:=state||jsonb_build_object('capability',capability,'capture',capture_json);
    if state->>'state'='preparing' then state:=jsonb_set(state,'{state}','"captured"'); end if;
  end if;
  return jsonb_build_object('grant',state,'events',events,'receipts',receipts);
end $$;

create function public.native_estdec_verified_grant(p_id uuid) returns jsonb
language sql security definer set search_path=public as $$ select public.native_estdec_grant_fold(p_id)->'grant' $$;

create function public.native_estdec_verified_state(p_estimate_id uuid) returns jsonb
language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare life jsonb:=public.native_estpub_lifecycle(p_estimate_id); head jsonb:=public.native_estpub_empty_head();
  r public.native_estimate_decisions; op public.native_estimate_decision_operations;
  q jsonb; m jsonb; pub jsonb; g jsonb; d jsonb; receipt jsonb; prov jsonb;
  items jsonb:='[]'; receipts jsonb:='[]'; n integer:=0; prior_at timestamptz; at_time timestamptz;
begin
  for r in select * from public.native_estimate_decisions where estimate_id=p_estimate_id order by sequence loop
    n:=n+1;
    select * into op from public.native_estimate_decision_operations where id=r.id;
    if not found or op.family<>'decision' then raise exception 'Missing decision operation' using errcode='23514'; end if;
    m:=op.mutation;
    perform public.native_estdec_mutation('decision',m);
    perform public.native_estdec_principal(op.principal);
    q:=case when m->>'kind'='client_decision' then m->'request' else m#>'{request,decision}' end;
    pub:=public.native_estdec_publication(q->'binding',life);
    perform public.native_estdec_prefix(life,q->'binding',q->'expected_publication_head',r.created_at);
    if r.sequence<>n or r.principal is distinct from op.principal or r.request_hash<>public.native_estdec_request_hash('decision',op.principal,m)
      or r.request_hash<>op.request_hash or r.publication_id::text<>q#>>'{binding,publication_id}'
      or q#>'{binding,target}' is distinct from life->'target' or r.created_at<(pub->>'published_at')::timestamptz
      or r.created_at>=(pub->>'expires_at')::timestamptz or r.created_at<prior_at or op.created_at<>r.created_at
      or exists(select 1 from public.native_estimate_decision_closures c where c.id=r.id) then
      raise exception 'Decision source or sequence integrity failure' using errcode='23514';
    end if;
    if m->>'kind'='client_decision' then
      g:=public.native_estdec_verified_grant((q->>'grant_id')::uuid);
      if g is null or op.principal is distinct from jsonb_build_object('kind','grant','id',q->'grant_id')
        or g#>'{request,binding}' is distinct from q->'binding' or g->'activation'='null'::jsonb
        or (g#>>'{activation,created_at}')::timestamptz>r.created_at or (g#>>'{request,expires_at}')::timestamptz<=r.created_at
        or (g->'revocation'<>'null'::jsonb and (g#>>'{revocation,created_at}')::timestamptz<r.created_at) then
        raise exception 'Decision grant attribution invalid' using errcode='23514';
      end if;
      prov:=jsonb_build_object('kind','grant','grant_id',q->'grant_id');
    else
      at_time:=(m#>>'{request,witness,occurred_at}')::timestamptz;
      if op.principal->>'kind'<>'staff' or not exists(select 1 from public.profiles p where p.id=(op.principal->>'id')::uuid)
        or at_time>r.created_at or at_time<(pub->>'published_at')::timestamptz then raise exception 'Witness attribution invalid' using errcode='23514'; end if;
      prov:=jsonb_build_object('kind','staff_witness','actor_id',op.principal->'id','witness',m#>'{request,witness}');
    end if;
    d:=jsonb_build_object('version',1,'id',r.id,'sequence',n,'binding',q->'binding','choice',q->'choice',
      'signer_name',q->'signer_name','signer_relationship',q->'signer_relationship','comment',q->'comment','acknowledgment_version',1,
      'provenance',prov,'publication_head',q->'expected_publication_head','decision_head',head,'recorded_at',public.native_estdec_time(r.created_at));
    d:=d||jsonb_build_object('record_hash',public.native_fulfillment_hash(d));
    receipt:=jsonb_build_object('version',1,'id',r.id,'principal',op.principal,'mutation',m,'request_hash',r.request_hash,'result',d,'created_at',public.native_estdec_time(r.created_at));
    if r.document is distinct from d or op.receipt is distinct from receipt then raise exception 'Decision receipt or hash invalid' using errcode='23514'; end if;
    head:=jsonb_build_object('event_id',r.id,'version',n,'record_hash',d->'record_hash');
    items:=items||jsonb_build_array(d); receipts:=receipts||jsonb_build_array(receipt); prior_at:=r.created_at;
  end loop;
  return jsonb_build_object('target',life->'target','head',head,'decisions',items,'receipts',receipts);
end $$;

create function public.native_estdec_verified_operation(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare op public.native_estimate_decision_operations; verified jsonb; root_id uuid; grant_id uuid;
begin
  select * into op from public.native_estimate_decision_operations where id=p_id;
  if not found then return null; end if;
  if op.family='grant' then
    select e.grant_id into grant_id from public.native_estimate_decision_grant_events e where e.id=p_id;
    select x.value into verified from jsonb_array_elements(public.native_estdec_grant_fold(grant_id)->'receipts') x where x.value->>'id'=p_id::text;
  else
    select d.estimate_id into root_id from public.native_estimate_decisions d where d.id=p_id;
    select x.value into verified from jsonb_array_elements(public.native_estdec_verified_state(root_id)->'receipts') x where x.value->>'id'=p_id::text;
  end if;
  if verified is null or verified is distinct from op.receipt then raise exception 'Orphaned decision operation' using errcode='23514'; end if;
  return verified;
end $$;

create function public.native_estdec_scope(p_family text,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b jsonb; g jsonb;
begin
  perform public.native_estdec_mutation(p_family,p_mutation);
  if p_family='grant' and p_mutation->>'kind'<>'issue' then
    g:=public.native_estdec_verified_grant((p_mutation#>>'{request,grant_id}')::uuid);
    if g is null then raise exception 'Estimate grant unavailable' using errcode='42501'; end if;
    b:=g#>'{request,binding}';
  elsif p_mutation->>'kind'='witnessed_decision' then b:=p_mutation#>'{request,decision,binding}';
  else b:=p_mutation#>'{request,binding}'; end if;
  perform public.native_estdec_publication(b,public.native_estpub_lifecycle((b#>>'{target,estimate_id}')::uuid));
  if p_mutation->>'kind'='client_decision' then
    g:=public.native_estdec_verified_grant((p_mutation#>>'{request,grant_id}')::uuid);
    if g is null or g#>'{request,binding}' is distinct from b then raise exception 'Grant request scope mismatch' using errcode='23514'; end if;
  end if;
  return b;
end $$;

create function public.native_estdec_closure_document(c public.native_estimate_decision_closures) returns jsonb
language sql stable security definer set search_path=public set timezone='UTC' as $$
  select case when c.family='grant' then jsonb_build_object('version',1,'id',c.id,'actor_id',c.principal->'id','mutation',c.mutation,
    'request_hash',c.request_hash,'closed_at',public.native_estdec_time(c.closed_at),'record_hash',c.record_hash)
  else jsonb_build_object('version',1,'id',c.id,'principal',c.principal,'mutation',c.mutation,'request_hash',c.request_hash,
    'closed_by',c.closed_by,'reason',c.reason,'closed_at',public.native_estdec_time(c.closed_at),'record_hash',c.record_hash) end
$$;

create function public.native_estdec_verified_closure(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.native_estimate_decision_closures; d jsonb;
begin
  select * into c from public.native_estimate_decision_closures where id=p_id;
  if not found then return null; end if;
  perform public.native_estdec_mutation(c.family,c.mutation);
  perform public.native_estdec_principal(c.principal); perform public.native_estdec_principal(c.closed_by);
  perform public.native_estdec_scope(c.family,c.mutation);
  if c.family='grant' or c.mutation->>'kind'='witnessed_decision' then
    if c.principal->>'kind'<>'staff' or c.closed_by is distinct from c.principal or c.reason is not null
      or not exists(select 1 from public.profiles p where p.id=(c.principal->>'id')::uuid) then raise exception 'Closure staff attribution invalid' using errcode='23514'; end if;
  else
    if c.principal is distinct from jsonb_build_object('kind','grant','id',c.mutation#>'{request,grant_id}') then raise exception 'Closure grant attribution invalid' using errcode='23514'; end if;
    if c.closed_by->>'kind'='staff' then
      perform public.native_rx_text(to_jsonb(c.reason),2000);
      if not exists(select 1 from public.profiles p where p.id=(c.closed_by->>'id')::uuid) then raise exception 'Unknown closure reviewer' using errcode='23514'; end if;
    elsif c.closed_by is distinct from c.principal or c.reason is not null then raise exception 'Closure attribution invalid' using errcode='23514'; end if;
  end if;
  d:=public.native_estdec_closure_document(c);
  if c.request_hash<>public.native_estdec_request_hash(c.family,c.principal,c.mutation) or c.record_hash<>public.native_fulfillment_hash(d-'record_hash')
    or exists(select 1 from public.native_estimate_decision_operations o where o.id=c.id)
    or exists(select 1 from public.native_estimate_decisions x where x.id=c.id)
    or exists(select 1 from public.native_estimate_decision_grant_events x where x.id=c.id) then
    raise exception 'Closure evidence integrity failure' using errcode='23514'; end if;
  return d;
end $$;

create function public.native_estdec_access(p_grant_id uuid,p_token_hash text,p_origin text,p_key_version text,p_current boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g jsonb:=public.native_estdec_verified_grant(p_grant_id); c public.native_estimate_decision_grant_captures; life jsonb;
begin
  select * into c from public.native_estimate_decision_grant_captures where grant_id=p_grant_id;
  if g is null or c.grant_id is null or p_token_hash is null or c.token_hash is distinct from p_token_hash
    or c.origin is distinct from p_origin or c.key_version is distinct from p_key_version
    or g->>'state'<>'active' or not public.is_active_staff((g->>'actor_id')::uuid)
    or clock_timestamp()>=(g#>>'{request,expires_at}')::timestamptz then
    raise exception 'Estimate access unavailable' using errcode='42501'; end if;
  if p_current then
    life:=public.native_estpub_lifecycle((g#>>'{request,binding,target,estimate_id}')::uuid);
    if life#>'{current,id}' is distinct from g#>'{request,binding,publication_id}' then raise exception 'Estimate publication changed' using errcode='40001'; end if;
  end if;
  return g;
end $$;

create function public.native_estdec_current(p_binding jsonb,p_head jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare life jsonb:=public.native_estpub_lifecycle((p_binding#>>'{target,estimate_id}')::uuid); pub jsonb;
begin
  pub:=public.native_estdec_publication(p_binding,life);
  if life->'head' is distinct from p_head or life#>'{current,id}' is distinct from p_binding->'publication_id' then raise exception 'Estimate publication changed' using errcode='40001'; end if;
  if clock_timestamp()>=(pub->>'expires_at')::timestamptz then raise exception 'Estimate deadline expired' using errcode='23514'; end if;
  if exists(select 1 from public.native_estimate_decisions d where d.publication_id=(pub->>'id')::uuid) then
    perform public.native_estdec_verified_state((p_binding#>>'{target,estimate_id}')::uuid);
    raise exception 'Estimate already decided' using errcode='23514';
  end if;
  return pub;
end $$;

-- The only mutable state is a private 60-read, one-minute budget. No lifetime lockout.
create function public.native_estdec_budget(p_grant_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare b public.native_estimate_decision_access_budget; stamp timestamptz;
begin
  insert into public.native_estimate_decision_access_budget values(p_grant_id,clock_timestamp(),0) on conflict(grant_id) do nothing;
  select * into strict b from public.native_estimate_decision_access_budget where grant_id=p_grant_id for update;
  stamp:=clock_timestamp();
  if stamp>=b.window_started_at+interval '1 minute' then
    update public.native_estimate_decision_access_budget set window_started_at=stamp,used=1 where grant_id=p_grant_id;
  elsif b.used>=60 then raise exception 'Estimate read limit reached' using errcode='54000';
  else update public.native_estimate_decision_access_budget set used=used+1 where grant_id=p_grant_id; end if;
end $$;

create function public.native_estdec_public_decision(d jsonb) returns jsonb
language sql immutable security definer set search_path=public as $$
  select case when d is null or d='null'::jsonb then null else
    (d-array['provenance','publication_head','decision_head'])||jsonb_build_object('attribution',
      case d#>>'{provenance,kind}' when 'grant' then 'link_holder' else 'practice_staff_witness' end) end
$$;
create function public.native_estdec_public_receipt(r jsonb) returns jsonb
language sql immutable security definer set search_path=public as $$
  select jsonb_build_object('version',1,'id',r->'id','grant_id',r#>'{principal,id}','request',r#>'{mutation,request}',
    'request_hash',r->'request_hash','result',public.native_estdec_public_decision(r->'result'),'created_at',r->'created_at')
$$;
create function public.native_estdec_public_resolution(r jsonb) returns jsonb
language sql immutable security definer set search_path=public as $$
  select case r->>'status' when 'recorded' then jsonb_build_object('version',1,'status','recorded','receipt',public.native_estdec_public_receipt(r->'receipt'))
    when 'closed_unrecorded' then jsonb_build_object('version',1,'status','closed_unrecorded','closure',
      jsonb_build_object('version',1,'id',r#>'{closure,id}','grant_id',r#>'{closure,principal,id}','request',r#>'{closure,mutation,request}',
        'request_hash',r#>'{closure,request_hash}','closed_at',r#>'{closure,closed_at}','record_hash',r#>'{closure,record_hash}',
        'closed_by',case r#>>'{closure,closed_by,kind}' when 'staff' then 'practice_staff' else 'link_holder' end))
    else r end
$$;

create function public.native_estdec_authorize(p_principal jsonb,p_proof jsonb,p_current boolean default false) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_principal->>'kind'='staff' then
    if public.clinical_require_staff()::text is distinct from p_principal->>'id' then raise exception 'Decision actor changed' using errcode='42501'; end if;
  else
    perform public.communication_require_service();
    perform public.native_estdec_access((p_principal->>'id')::uuid,p_proof->>'token_hash',p_proof->>'origin',p_proof->>'key_version',p_current);
  end if;
end $$;

create function public.native_estdec_lock(p_id uuid,p_family text,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b jsonb;
begin
  if p_id is null then raise exception 'Operation identity required' using errcode='23514'; end if;
  perform public.native_estdec_mutation(p_family,p_mutation);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  b:=public.native_estdec_scope(p_family,p_mutation);
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||(b#>>'{target,estimate_id}'),0));
  perform public.native_estdec_scope(p_family,p_mutation);
  return b;
end $$;

create function public.native_estdec_existing(p_id uuid,p_family text,p_principal jsonb,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.native_estimate_decision_operations; c public.native_estimate_decision_closures; r jsonb;
begin
  select * into o from public.native_estimate_decision_operations where id=p_id;
  if found then
    if o.principal is distinct from p_principal then raise exception 'Operation belongs to another principal' using errcode='42501'; end if;
    if o.family<>p_family or o.mutation is distinct from p_mutation then raise exception 'Operation identity already used' using errcode='23514'; end if;
    r:=public.native_estdec_verified_operation(p_id);
    return jsonb_build_object('version',1,'status','recorded','receipt',r);
  end if;
  select * into c from public.native_estimate_decision_closures where id=p_id;
  if found then
    if c.principal is distinct from p_principal then raise exception 'Closure belongs to another principal' using errcode='42501'; end if;
    if c.family<>p_family or c.mutation is distinct from p_mutation then raise exception 'Closed operation identity already used' using errcode='23514'; end if;
    return jsonb_build_object('version',1,'status','closed_unrecorded','closure',public.native_estdec_verified_closure(p_id));
  end if;
  return jsonb_build_object('version',1,'status','unrecorded');
end $$;

create function public.record_native_estimate_decision_grant(p_id uuid,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare actor uuid:=public.clinical_require_staff(); principal jsonb; b jsonb; previous jsonb;
  q jsonb:=p_mutation->'request'; g jsonb; gid uuid; root_id uuid; stamp timestamptz;
  seq integer; ver integer; d jsonb; receipt jsonb; rh text; old jsonb; kind text:=p_mutation->>'kind';
begin
  principal:=jsonb_build_object('kind','staff','id',actor);
  b:=public.native_estdec_lock(p_id,'grant',p_mutation); root_id:=(b#>>'{target,estimate_id}')::uuid;
  perform public.native_estdec_authorize(principal,null);
  old:=public.native_estdec_existing(p_id,'grant',principal,p_mutation);
  if old->>'status'='recorded' then return old->'receipt'; end if;
  if old->>'status'='closed_unrecorded' then raise exception 'Operation permanently closed' using errcode='23514'; end if;
  rh:=public.native_estdec_request_hash('grant',principal,p_mutation);
  select coalesce(max(e.sequence),0)+1 into seq from public.native_estimate_decision_grant_events e where e.estimate_id=root_id;
  stamp:=clock_timestamp();
  if kind='issue' then
    perform public.native_estdec_current(b,q->'expected_publication_head');
    if (q->>'expires_at')::timestamptz<=stamp or (q->>'expires_at')::timestamptz>(public.native_estdec_publication(b,public.native_estpub_lifecycle(root_id))->>'expires_at')::timestamptz then
      raise exception 'Grant deadline invalid' using errcode='23514'; end if;
    gid:=p_id; ver:=1; previous:=public.native_estpub_empty_head();
    g:=jsonb_build_object('version',1,'id',gid,'actor_id',actor,'request',q,'request_hash',rh,'created_at',public.native_estdec_time(stamp),
      'capability',null,'capture',null,'head',previous,'state','preparing','activation',null,'revocation',null);
  else
    gid:=(q->>'grant_id')::uuid; g:=public.native_estdec_verified_grant(gid); previous:=g->'head';
    if previous is distinct from q->'expected_grant_head' then raise exception 'Grant review changed' using errcode='40001'; end if;
    ver:=(previous->>'version')::integer+1;
    if kind='activate' then
      perform public.native_estdec_current(b,q->'expected_publication_head');
      if g->>'state'<>'captured' or not public.is_active_staff((g->>'actor_id')::uuid)
        or g#>'{capability,context_hash}' is distinct from q->'expected_context_hash' or stamp>=(g#>>'{request,expires_at}')::timestamptz then
        raise exception 'Captured grant unavailable for activation' using errcode='23514'; end if;
      g:=g||jsonb_build_object('state','active','activation',jsonb_build_object('id',p_id,'actor_id',actor,'created_at',public.native_estdec_time(stamp)));
    else
      if g->>'state'='revoked' then raise exception 'Grant already revoked' using errcode='23514'; end if;
      g:=g||jsonb_build_object('state','revoked','revocation',jsonb_build_object('id',p_id,'actor_id',actor,'reason',q->'reason','created_at',public.native_estdec_time(stamp)));
    end if;
  end if;
  d:=jsonb_build_object('id',p_id,'grant_id',gid,'target',b->'target','sequence',seq,'grant_version',ver,'previous_hash',previous->'record_hash',
    'kind',case kind when 'issue' then 'issued' when 'activate' then 'activated' else 'revoked' end,'actor_id',actor,'created_at',public.native_estdec_time(stamp),'request',q);
  d:=d||jsonb_build_object('record_hash',public.native_fulfillment_hash(d));
  g:=jsonb_set(g,'{head}',jsonb_build_object('event_id',p_id,'version',ver,'record_hash',d->'record_hash'));
  receipt:=jsonb_build_object('version',1,'id',p_id,'actor_id',actor,'mutation',p_mutation,'request_hash',rh,'result',public.native_estdec_grant_view(g),'created_at',public.native_estdec_time(stamp));
  perform public.native_estdec_authorize(principal,null);
  if kind='issue' then
    insert into public.native_estimate_decision_grants values(gid,actor,root_id,(b->>'publication_id')::uuid,q,rh,(q->>'expires_at')::timestamptz,stamp);
  end if;
  insert into public.native_estimate_decision_grant_events values(p_id,gid,root_id,seq,ver,previous->>'record_hash',d,stamp);
  insert into public.native_estimate_decision_operations values(p_id,'grant',principal,p_mutation,rh,receipt,stamp);
  return public.native_estdec_verified_operation(p_id);
end $$;

create function public.native_estimate_decision_grant_capture_context(p_grant_id uuid,p_actor_id uuid,p_origin text,p_key_version text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare g jsonb; c public.native_estimate_decision_grant_captures; ctxt text; life jsonb;
begin
  perform public.communication_require_service();
  perform pg_advisory_xact_lock(hashtextextended(p_grant_id::text,0));
  g:=public.native_estdec_verified_grant(p_grant_id);
  if g is null then raise exception 'Estimate grant unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||(g#>>'{request,binding,target,estimate_id}'),0));
  g:=public.native_estdec_verified_grant(p_grant_id);
  if g->>'actor_id' is distinct from p_actor_id::text or not public.is_active_staff(p_actor_id) then raise exception 'Grant creator unavailable' using errcode='42501'; end if;
  select * into c from public.native_estimate_decision_grant_captures where grant_id=p_grant_id;
  if found then
    return jsonb_build_object('grant',g,'capability_context',c.capability_context,'context_hash',c.context_hash,'captured',true);
  end if;
  life:=public.native_estpub_lifecycle((g#>>'{request,binding,target,estimate_id}')::uuid);
  perform public.native_estdec_current(g#>'{request,binding}',life->'head');
  if g->>'state'<>'preparing' or clock_timestamp()>=(g#>>'{request,expires_at}')::timestamptz then raise exception 'Grant capture unavailable' using errcode='42501'; end if;
  ctxt:=public.native_estdec_context(g,p_origin,p_key_version);
  return jsonb_build_object('grant',g,'capability_context',ctxt,'context_hash',encode(digest(convert_to(ctxt,'UTF8'),'sha256'),'hex'),'captured',false);
end $$;

create function public.capture_native_estimate_decision_grant(p_grant_id uuid,p_actor_id uuid,p_origin text,p_key_version text,p_context_hash text,p_token_hash text) returns jsonb
language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare ctx jsonb; c public.native_estimate_decision_grant_captures; stamp timestamptz;
begin
  ctx:=public.native_estimate_decision_grant_capture_context(p_grant_id,p_actor_id,p_origin,p_key_version);
  perform public.native_estpub_hash(to_jsonb(p_token_hash));
  if ctx->>'context_hash' is distinct from p_context_hash then raise exception 'Capability context changed' using errcode='23514'; end if;
  select * into c from public.native_estimate_decision_grant_captures where grant_id=p_grant_id;
  if found then
    if c.origin is distinct from p_origin or c.key_version is distinct from p_key_version or c.token_hash is distinct from p_token_hash then
      raise exception 'Captured capability cannot change' using errcode='23514'; end if;
    return public.native_estdec_grant_view(ctx->'grant');
  end if;
  stamp:=clock_timestamp();
  if not public.is_active_staff(p_actor_id) or stamp>=(ctx#>>'{grant,request,expires_at}')::timestamptz then raise exception 'Grant capture unavailable' using errcode='42501'; end if;
  c.grant_id:=p_grant_id; c.origin:=p_origin; c.key_version:=p_key_version; c.capability_context:=ctx->>'capability_context';
  c.context_hash:=p_context_hash; c.token_hash:=p_token_hash; c.captured_at:=stamp;
  c.record_hash:=public.native_fulfillment_hash(to_jsonb(c)-'record_hash');
  insert into public.native_estimate_decision_grant_captures select c.*;
  return public.native_estdec_grant_view(public.native_estdec_verified_grant(p_grant_id));
end $$;

create function public.native_estimate_decision_access_context(p_grant_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g jsonb; c public.native_estimate_decision_grant_captures;
begin
  perform public.communication_require_service();
  g:=public.native_estdec_verified_grant(p_grant_id);
  select * into c from public.native_estimate_decision_grant_captures where grant_id=p_grant_id;
  if g is null or not found then raise exception 'Estimate access unavailable' using errcode='42501'; end if;
  return jsonb_build_object('grant',g,'capability_context',c.capability_context,'context_hash',c.context_hash,'captured',true);
end $$;

create function public.native_estdec_record(p_id uuid,p_mutation jsonb,p_principal jsonb,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare b jsonb; old jsonb; state jsonb; pub jsonb; q jsonb; d jsonb; receipt jsonb; prov jsonb; rh text; stamp timestamptz; seq integer;
begin
  perform public.native_estdec_principal(p_principal);
  b:=public.native_estdec_lock(p_id,'decision',p_mutation);
  perform public.native_estdec_authorize(p_principal,p_proof);
  if (p_mutation->>'kind'='client_decision' and p_principal is distinct from jsonb_build_object('kind','grant','id',p_mutation#>'{request,grant_id}'))
    or (p_mutation->>'kind'='witnessed_decision' and p_principal->>'kind'<>'staff') then raise exception 'Decision principal mismatch' using errcode='42501'; end if;
  old:=public.native_estdec_existing(p_id,'decision',p_principal,p_mutation);
  if old->>'status'='recorded' then return old->'receipt'; end if;
  if old->>'status'='closed_unrecorded' then raise exception 'Operation permanently closed' using errcode='23514'; end if;
  q:=case when p_mutation->>'kind'='client_decision' then p_mutation->'request' else p_mutation#>'{request,decision}' end;
  pub:=public.native_estdec_current(b,q->'expected_publication_head');
  state:=public.native_estdec_verified_state((b#>>'{target,estimate_id}')::uuid);
  seq:=(state#>>'{head,version}')::integer+1;
  stamp:=clock_timestamp();
  if stamp>=(pub->>'expires_at')::timestamptz then raise exception 'Estimate deadline expired' using errcode='23514'; end if;
  if p_principal->>'kind'='grant' then
    prov:=jsonb_build_object('kind','grant','grant_id',p_principal->'id');
  else
    if (p_mutation#>>'{request,witness,occurred_at}')::timestamptz>stamp or (p_mutation#>>'{request,witness,occurred_at}')::timestamptz<(pub->>'published_at')::timestamptz then
      raise exception 'Witness occurrence outside publication period' using errcode='23514'; end if;
    prov:=jsonb_build_object('kind','staff_witness','actor_id',p_principal->'id','witness',p_mutation#>'{request,witness}');
  end if;
  d:=jsonb_build_object('version',1,'id',p_id,'sequence',seq,'binding',b,'choice',q->'choice','signer_name',q->'signer_name',
    'signer_relationship',q->'signer_relationship','comment',q->'comment','acknowledgment_version',1,'provenance',prov,
    'publication_head',q->'expected_publication_head','decision_head',state->'head','recorded_at',public.native_estdec_time(stamp));
  d:=d||jsonb_build_object('record_hash',public.native_fulfillment_hash(d));
  rh:=public.native_estdec_request_hash('decision',p_principal,p_mutation);
  receipt:=jsonb_build_object('version',1,'id',p_id,'principal',p_principal,'mutation',p_mutation,'request_hash',rh,'result',d,'created_at',public.native_estdec_time(stamp));
  perform public.native_estdec_authorize(p_principal,p_proof,true);
  insert into public.native_estimate_decisions values(p_id,(b#>>'{target,estimate_id}')::uuid,(b->>'publication_id')::uuid,seq,p_principal,rh,d,stamp);
  insert into public.native_estimate_decision_operations values(p_id,'decision',p_principal,p_mutation,rh,receipt,stamp);
  return public.native_estdec_verified_operation(p_id);
end $$;

create function public.record_native_estimate_witnessed_decision(p_id uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
  return public.native_estdec_record(p_id,jsonb_build_object('kind','witnessed_decision','request',p_request),jsonb_build_object('kind','staff','id',actor),null);
end $$;
create function public.record_native_estimate_client_decision(p_id uuid,p_request jsonb,p_token_hash text,p_origin text,p_key_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform public.communication_require_service();
  return public.native_estdec_public_receipt(public.native_estdec_record(p_id,jsonb_build_object('kind','client_decision','request',p_request),
    jsonb_build_object('kind','grant','id',p_request->'grant_id'),jsonb_build_object('token_hash',p_token_hash,'origin',p_origin,'key_version',p_key_version)));
end $$;

create function public.native_estdec_resolve(p_id uuid,p_family text,p_mutation jsonb,p_principal jsonb,p_closed_by jsonb,p_reason text,p_close boolean,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare b jsonb; old jsonb; c public.native_estimate_decision_closures; d jsonb;
begin
  if p_close is null then raise exception 'Resolution mode required' using errcode='23514'; end if;
  b:=public.native_estdec_lock(p_id,p_family,p_mutation);
  perform public.native_estdec_principal(p_principal); perform public.native_estdec_principal(p_closed_by);
  if p_closed_by is distinct from p_principal then
    if p_family<>'decision' or p_mutation->>'kind'<>'client_decision' or p_closed_by->>'kind'<>'staff'
      or p_principal is distinct from jsonb_build_object('kind','grant','id',p_mutation#>'{request,grant_id}') then
      raise exception 'Invalid administrative reconciliation' using errcode='42501'; end if;
    perform public.native_rx_text(to_jsonb(p_reason),2000);
    perform public.native_estdec_authorize(p_closed_by,null);
  else
    if p_reason is not null then raise exception 'Unexpected closure reason' using errcode='23514'; end if;
    perform public.native_estdec_authorize(p_principal,p_proof);
  end if;
  old:=public.native_estdec_existing(p_id,p_family,p_principal,p_mutation);
  if old->>'status'<>'unrecorded' or not p_close then return old; end if;
  c.id:=p_id; c.family:=p_family; c.principal:=p_principal; c.mutation:=p_mutation;
  c.request_hash:=public.native_estdec_request_hash(p_family,p_principal,p_mutation);
  c.closed_by:=p_closed_by; c.reason:=p_reason; c.closed_at:=clock_timestamp();
  d:=public.native_estdec_closure_document(c)-'record_hash'; c.record_hash:=public.native_fulfillment_hash(d);
  perform public.native_estdec_authorize(p_closed_by,case when p_closed_by=p_principal then p_proof else null end);
  insert into public.native_estimate_decision_closures select c.*;
  return jsonb_build_object('version',1,'status','closed_unrecorded','closure',public.native_estdec_verified_closure(p_id));
end $$;

create function public.close_native_estimate_decision_grant(p_id uuid,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p jsonb:=jsonb_build_object('kind','staff','id',public.clinical_require_staff());
begin return public.native_estdec_resolve(p_id,'grant',p_mutation,p,p,null,true,null); end $$;
create function public.close_native_estimate_witnessed_decision(p_id uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p jsonb:=jsonb_build_object('kind','staff','id',public.clinical_require_staff());
begin return public.native_estdec_resolve(p_id,'decision',jsonb_build_object('kind','witnessed_decision','request',p_request),p,p,null,true,null); end $$;
create function public.reconcile_native_estimate_client_decision(p_id uuid,p_request jsonb,p_close_unrecorded boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
  return public.native_estdec_resolve(p_id,'decision',jsonb_build_object('kind','client_decision','request',p_request),
    jsonb_build_object('kind','grant','id',p_request->'grant_id'),jsonb_build_object('kind','staff','id',actor),p_reason,p_close_unrecorded,null);
end $$;

create function public.recover_native_estimate_client_decision(p_id uuid,p_request jsonb,p_token_hash text,p_origin text,p_key_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p jsonb:=jsonb_build_object('kind','grant','id',p_request->'grant_id');
begin
  perform public.communication_require_service();
  return public.native_estdec_public_resolution(public.native_estdec_resolve(p_id,'decision',jsonb_build_object('kind','client_decision','request',p_request),p,p,null,false,
    jsonb_build_object('token_hash',p_token_hash,'origin',p_origin,'key_version',p_key_version)));
end $$;
create function public.close_native_estimate_client_decision(p_id uuid,p_request jsonb,p_token_hash text,p_origin text,p_key_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p jsonb:=jsonb_build_object('kind','grant','id',p_request->'grant_id');
begin
  perform public.communication_require_service();
  return public.native_estdec_public_resolution(public.native_estdec_resolve(p_id,'decision',jsonb_build_object('kind','client_decision','request',p_request),p,p,null,true,
    jsonb_build_object('token_hash',p_token_hash,'origin',p_origin,'key_version',p_key_version)));
end $$;

create function public.native_estdec_staff_recovery(p_id uuid,p_family text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); o public.native_estimate_decision_operations; c public.native_estimate_decision_closures; r jsonb;
begin
  if p_id is null then raise exception 'Operation identity required' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into o from public.native_estimate_decision_operations where id=p_id;
  if found then
    if o.principal is distinct from jsonb_build_object('kind','staff','id',actor) then raise exception 'Operation belongs to another principal' using errcode='42501'; end if;
    if o.family<>p_family then raise exception 'Operation family mismatch' using errcode='23514'; end if;
    r:=public.native_estdec_verified_operation(p_id);
  else
    select * into c from public.native_estimate_decision_closures where id=p_id;
    if found then
      if c.principal is distinct from jsonb_build_object('kind','staff','id',actor) then raise exception 'Closure belongs to another principal' using errcode='42501'; end if;
      if c.family<>p_family then raise exception 'Operation family mismatch' using errcode='23514'; end if;
      perform public.native_estdec_verified_closure(p_id);
    end if;
  end if;
  perform public.clinical_require_staff();
  return r;
end $$;
create function public.recover_native_estimate_decision_grant(p_id uuid) returns jsonb
language sql security definer set search_path=public as $$ select public.native_estdec_staff_recovery(p_id,'grant') $$;
create function public.recover_native_estimate_witnessed_decision(p_id uuid) returns jsonb
language sql security definer set search_path=public as $$ select public.native_estdec_staff_recovery(p_id,'decision') $$;

create function public.preview_native_estimate_decision_grant(p_publication_id uuid,p_client_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare root_id uuid; life jsonb; pub jsonb; b jsonb;
begin
  perform public.clinical_require_staff();
  select e.estimate_id into root_id from public.native_estimate_publication_events e where e.id=p_publication_id and e.document->>'kind'='published';
  if root_id is null then raise exception 'Published estimate unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||root_id::text,0));
  life:=public.native_estpub_lifecycle(root_id); pub:=life->'current';
  if pub->>'id' is distinct from p_publication_id::text or life#>>'{target,client_id}' is distinct from p_client_id::text then
    raise exception 'Current household publication required' using errcode='23514'; end if;
  b:=jsonb_build_object('target',pub->'target','publication_id',pub->'id','content_hash',pub->'content_hash','artifact_hash',pub#>'{artifact,sha256}');
  perform public.native_estdec_current(b,life->'head'); perform public.clinical_require_staff();
  return jsonb_build_object('version',1,'binding',b,'publication_head',life->'head','expires_at',public.native_estdec_time((pub->>'expires_at')::timestamptz),'decision',null);
end $$;

create function public.native_estdec_eligibility(g jsonb) returns text
language plpgsql security definer set search_path=public as $$
declare life jsonb;
begin
  if g->>'state'='revoked' then return 'revoked'; end if;
  if clock_timestamp()>=(g#>>'{request,expires_at}')::timestamptz then return 'expired'; end if;
  if not public.is_active_staff((g->>'actor_id')::uuid) then return 'issuer_inactive'; end if;
  life:=public.native_estpub_lifecycle((g#>>'{request,binding,target,estimate_id}')::uuid);
  if life#>'{current,id}' is distinct from g#>'{request,binding,publication_id}' then return 'publication_unavailable'; end if;
  if exists(select 1 from public.native_estimate_decisions d where d.publication_id=(g#>>'{request,binding,publication_id}')::uuid) then return 'already_decided'; end if;
  return g->>'state';
end $$;

create function public.read_native_estimate_decision_state(p_estimate_id uuid,p_client_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare life jsonb; state jsonb; d jsonb;
begin
  perform public.clinical_require_staff();
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||p_estimate_id::text,0));
  life:=public.native_estpub_lifecycle(p_estimate_id); state:=public.native_estdec_verified_state(p_estimate_id);
  if life#>>'{target,client_id}' is distinct from p_client_id::text then raise exception 'Estimate household mismatch' using errcode='23514'; end if;
  select x.value into d from jsonb_array_elements(state->'decisions') x where x.value#>'{binding,publication_id}'=life#>'{current,id}';
  perform public.clinical_require_staff();
  return jsonb_build_object('version',1,'target',life->'target','publication_head',life->'head','decision_head',state->'head',
    'current_publication_id',life#>'{current,id}','current_decision',d);
end $$;

create function public.native_estdec_page(p_before integer,p_limit integer) returns void
language plpgsql immutable security definer set search_path=public as $$
begin
  if p_limit is null or p_limit not between 1 and 50 or p_before is not null and p_before<1 then raise exception 'Invalid decision history cursor' using errcode='23514'; end if;
end $$;
create function public.read_native_estimate_decisions(p_estimate_id uuid,p_client_id uuid,p_before_sequence integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare state jsonb; items jsonb; count_rows integer; cursor_value integer;
begin
  perform public.native_estdec_page(p_before_sequence,p_limit); perform public.clinical_require_staff();
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||p_estimate_id::text,0));
  state:=public.native_estdec_verified_state(p_estimate_id);
  if state#>>'{target,client_id}' is distinct from p_client_id::text then raise exception 'Estimate household mismatch' using errcode='23514'; end if;
  select coalesce(jsonb_agg(t.value order by (t.value->>'sequence')::integer desc),'[]') into items from
    (select x.value from jsonb_array_elements(state->'decisions') x where p_before_sequence is null or (x.value->>'sequence')::integer<p_before_sequence order by (x.value->>'sequence')::integer desc limit p_limit+1)t;
  count_rows:=jsonb_array_length(items);
  if count_rows>p_limit then items:=items-p_limit; cursor_value:=(items->(p_limit-1)->>'sequence')::integer; end if;
  perform public.clinical_require_staff();
  return jsonb_build_object('version',1,'target',state->'target','head',state->'head','items',items,'next_before_sequence',cursor_value,'has_more',count_rows>p_limit);
end $$;
create function public.read_native_estimate_decision_grants(p_estimate_id uuid,p_client_id uuid,p_before_sequence integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare life jsonb; r record; f jsonb; d jsonb; items jsonb:='[]'; n integer:=0; cursor_value integer; more boolean:=false;
begin
  perform public.native_estdec_page(p_before_sequence,p_limit); perform public.clinical_require_staff();
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||p_estimate_id::text,0));
  life:=public.native_estpub_lifecycle(p_estimate_id);
  if life#>>'{target,client_id}' is distinct from p_client_id::text then raise exception 'Estimate household mismatch' using errcode='23514'; end if;
  for r in select e.id,e.grant_id,e.sequence from public.native_estimate_decision_grant_events e where e.estimate_id=p_estimate_id
    and (p_before_sequence is null or e.sequence<p_before_sequence) order by e.sequence desc limit p_limit+1 loop
    n:=n+1;
    if n>p_limit then more:=true; exit; end if;
    f:=public.native_estdec_grant_fold(r.grant_id);
    select x.value into d from jsonb_array_elements(f->'events') x where x.value->>'id'=r.id::text;
    items:=items||jsonb_build_array(d||jsonb_build_object('eligibility',public.native_estdec_eligibility(f->'grant')));
    cursor_value:=r.sequence;
  end loop;
  perform public.clinical_require_staff();
  return jsonb_build_object('version',1,'target',life->'target','items',items,'next_before_sequence',case when more then cursor_value else null end,'has_more',more);
end $$;

create function public.retrieve_native_estimate_decision(p_grant_id uuid,p_token_hash text,p_origin text,p_key_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g jsonb; b jsonb; life jsonb; pub jsonb; prep jsonb; snap jsonb; state jsonb; d jsonb; bytes bytea; status text;
begin
  perform public.communication_require_service();
  g:=public.native_estdec_verified_grant(p_grant_id);
  if g is null then raise exception 'Estimate access unavailable' using errcode='42501'; end if;
  b:=g#>'{request,binding}';
  perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||(b#>>'{target,estimate_id}'),0));
  g:=public.native_estdec_access(p_grant_id,p_token_hash,p_origin,p_key_version,false);
  perform public.native_estdec_budget(p_grant_id);
  life:=public.native_estpub_lifecycle((b#>>'{target,estimate_id}')::uuid);
  pub:=public.native_estdec_publication(b,life); prep:=public.native_estpub_preparation((pub->>'preparation_id')::uuid); snap:=prep->'snapshot';
  state:=public.native_estdec_verified_state((b#>>'{target,estimate_id}')::uuid);
  select x.value into d from jsonb_array_elements(state->'decisions') x where x.value#>'{binding,publication_id}'=b->'publication_id';
  select a.bytes into strict bytes from public.native_estimate_publication_artifacts a where a.id=(prep->>'id')::uuid;
  status:=case when life#>'{current,id}'=pub->'id' then 'open'
    when life#>'{latest_publication,id}'=pub->'id' and life->'current'='null'::jsonb then 'withdrawn' else 'superseded' end;
  perform public.native_estdec_access(p_grant_id,p_token_hash,p_origin,p_key_version,false);
  return jsonb_build_object('version',1,'grant_id',p_grant_id,'binding',b,'publication_head',life->'head','publication_status',status,
    'decision',public.native_estdec_public_decision(d),'review',jsonb_build_object('practice',(snap->'practice')-'version',
      'household_name',snap#>'{client,name}','patient',(snap->'patient')-array['id','version'],'title',snap->'title',
      'total_cents',snap->'total_cents','currency','usd','accept_by',pub->'accept_by','expires_at',public.native_estdec_time((pub->>'expires_at')::timestamptz),
      'acknowledgment_version',1,'scope','entire_exact_revision','not_clinical_consent',true,'not_payment',true),
    'artifact',pub->'artifact','content_base64',replace(encode(bytes,'base64'),E'\n',''));
end $$;

create function public.native_estdec_audit() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor uuid; rid uuid; principal jsonb; doc jsonb:=to_jsonb(new);
begin
  rid:=coalesce((doc->>'id')::uuid,(doc->>'grant_id')::uuid);
  if tg_table_name='native_estimate_decision_grants' then actor:=(doc->>'actor_id')::uuid;
  elsif tg_table_name='native_estimate_decision_grant_captures' then select g.actor_id into actor from public.native_estimate_decision_grants g where g.id=rid;
  elsif tg_table_name='native_estimate_decision_grant_events' then actor:=(doc#>>'{document,actor_id}')::uuid;
  else
    principal:=case when tg_table_name='native_estimate_decision_closures' then doc->'closed_by' else doc->'principal' end;
    if principal->>'kind'='staff' then actor:=(principal->>'id')::uuid; end if;
  end if;
  insert into public.audit_logs(user_id,action,table_name,record_id,new_data)
    values(actor,'INSERT',tg_table_name,rid,jsonb_build_object('id',rid,'family',doc->'family','principal',principal));
  return new;
end $$;

create function public.native_estdec_integrity() returns trigger
language plpgsql security definer set search_path=public as $$
declare doc jsonb:=to_jsonb(new);
begin
  if tg_table_name='native_estimate_decision_grants' then perform public.native_estdec_verified_grant(new.id);
  elsif tg_table_name='native_estimate_decision_grant_captures' then perform public.native_estdec_verified_grant(new.grant_id);
  elsif tg_table_name='native_estimate_decision_closures' then perform public.native_estdec_verified_closure(new.id);
  else perform public.native_estdec_verified_operation(new.id); end if;
  return new;
end $$;

do $$
declare t text; fn record;
begin
  foreach t in array array['native_estimate_decision_grants','native_estimate_decision_grant_captures','native_estimate_decision_grant_events','native_estimate_decisions','native_estimate_decision_operations','native_estimate_decision_closures'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger native_estdec_immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()',t);
    execute format('create trigger native_estdec_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
    execute format('create trigger native_estdec_audit after insert on public.%I for each row execute function public.native_estdec_audit()',t);
    execute format('create constraint trigger native_estdec_integrity after insert on public.%I deferrable initially deferred for each row execute function public.native_estdec_integrity()',t);
  end loop;
  alter table public.native_estimate_decision_access_budget enable row level security;
  revoke all on public.native_estimate_decision_access_budget from public,anon,authenticated,service_role;
  for fn in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'native_estdec_%' or p.proname in (
      'preview_native_estimate_decision_grant','record_native_estimate_decision_grant','recover_native_estimate_decision_grant','close_native_estimate_decision_grant',
      'read_native_estimate_decision_grants','record_native_estimate_witnessed_decision','recover_native_estimate_witnessed_decision','close_native_estimate_witnessed_decision',
      'read_native_estimate_decisions','read_native_estimate_decision_state','reconcile_native_estimate_client_decision',
      'native_estimate_decision_grant_capture_context','capture_native_estimate_decision_grant','native_estimate_decision_access_context',
      'retrieve_native_estimate_decision','record_native_estimate_client_decision','recover_native_estimate_client_decision','close_native_estimate_client_decision')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
    if fn.proname in ('native_estimate_decision_grant_capture_context','capture_native_estimate_decision_grant','native_estimate_decision_access_context',
      'retrieve_native_estimate_decision','record_native_estimate_client_decision','recover_native_estimate_client_decision','close_native_estimate_client_decision') then
      execute format('grant execute on function %s to service_role',fn.signature);
    elsif fn.proname not like 'native_estdec_%' then execute format('grant execute on function %s to authenticated',fn.signature); end if;
  end loop;
end $$;
