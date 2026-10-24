-- Patient 360 / household 360 read model.
--
-- Staff read one patient or one household in a single call instead of
-- searching the schedule, clinical record, billing, messages, reminders and
-- releases separately. Everything here is read-only and security definer so
-- a single round trip can aggregate across tables, which means the functions
-- themselves must not show anything the caller could not already read:
--
--   * every entry point starts with clinical_require_staff() (active ADMIN,
--     DVM, TECH or STAFF), the same gate as the underlying tables' SELECT
--     policies and the existing list_* RPCs;
--   * patient documents are limited to finalized ('ready'/'void') rows, never
--     another user's in-progress upload (patient_documents RLS);
--   * CloudTalk call recordings, transcripts, AI summaries, message audio and
--     voicemail transcriptions are never returned (administrator-only media);
--   * payment collection grants, checkout URLs, document-link capabilities and
--     rendered reminder bodies are never returned;
--   * internal functions are revoked from every API role.
--
-- The functions only summarise; each timeline entry and next-step signal
-- carries the identifiers the client needs to open the authoritative screen.

-- Supporting indexes for the per-patient and per-household reads.
create index if not exists appointments_pet_scheduled_idx on public.appointments(pet_id, scheduled_at desc) where pet_id is not null;
create index if not exists billing_invoices_client_created_idx on public.billing_invoices(client_id, created_at desc, id desc);
create index if not exists billing_invoice_items_pet_idx on public.billing_invoice_items(pet_id, invoice_id) where pet_id is not null;
create index if not exists billing_credits_invoice_idx on public.billing_credits(invoice_id);
create index if not exists care_reminder_jobs_pet_created_idx on public.care_reminder_jobs(pet_id, created_at desc, id desc);
create index if not exists pet_vaccinations_pet_idx on public.pet_vaccinations(pet_id, administered_at desc);
create index if not exists lab_results_pet_idx on public.lab_results(pet_id, created_at desc) where pet_id is not null;
create index if not exists refill_requests_pet_idx on public.refill_requests(pet_id, created_at desc) where pet_id is not null;
create index if not exists refill_requests_client_idx on public.refill_requests(client_id, created_at desc);
create index if not exists patient_qol_scale_assessments_pet_idx on public.patient_qol_scale_assessments(pet_id, assessed_at desc);
create index if not exists client_files_client_idx on public.client_files(client_id, created_at desc);
create index if not exists release_email_requests_release_idx on public.release_email_requests(release_id, created_at desc);

-- Estimate lifecycle summary for display. The publication and decision
-- workspaces remain authoritative (they verify the hash chains); this only
-- reports where an estimate stands so staff know whether it needs attention.
create function public.patient_360_estimate_status_internal(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pub public.native_estimate_publication_events;
  choice text;
  expires timestamptz;
  total text;
  state text;
begin
  select r.document->>'total_cents' into total from public.native_estimate_draft_revisions r
  where r.estimate_id = p_estimate_id order by r.version desc limit 1;
  select * into pub from public.native_estimate_publication_events e
  where e.estimate_id = p_estimate_id order by e.version desc limit 1;
  if pub.id is null then
    state := 'draft';
  elsif pub.document->>'kind' = 'withdrawn' then
    state := 'withdrawn';
  else
    select d.document->>'choice' into choice from public.native_estimate_decisions d where d.publication_id = pub.id;
    expires := case when pub.document #>> '{publication,expires_at}' ~ '^\d{4}-' then (pub.document #>> '{publication,expires_at}')::timestamptz end;
    state := case choice when 'accept' then 'accepted' when 'decline' then 'declined'
      else case when expires is not null and expires <= now() then 'expired' else 'awaiting_decision' end end;
  end if;
  return jsonb_build_object('status', state, 'publication_id', pub.id, 'published_at', case when pub.document->>'kind' = 'published' then pub.created_at end,
    'expires_at', expires, 'total_cents', total);
end $$;

-- Next-step signals for one household, optionally narrowed to one patient.
-- Returns raw facts; the client derives, ranks and links the next steps.
create function public.patient_360_signals_internal(p_client_id uuid, p_pet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Denver')::date;
  pets uuid[];
  active_pets uuid[];
  pet record;
  summary jsonb;
  vaccines jsonb := '[]';
  plans jsonb := '[]';
  last_staff timestamptz;
  last_client timestamptz;
  result jsonb;
begin
  select coalesce(array_agg(p.id order by p.name, p.id), '{}'),
    coalesce(array_agg(p.id order by p.name, p.id) filter (where p.archived_at is null and p.deceased_at is null), '{}')
  into pets, active_pets
  from public.pets p where p.client_id = p_client_id and (p_pet_id is null or p.id = p_pet_id);

  for pet in select p.id, p.name from public.pets p where p.id = any(active_pets) order by p.name, p.id loop
    summary := public.patient_vaccine_status_summary(pet.id);
    vaccines := vaccines || coalesce((select jsonb_agg(jsonb_build_object('pet_id', pet.id, 'pet_name', pet.name,
        'group_key', g->>'group_key', 'group_name', g->>'group_name', 'due_on', g->>'due_on') order by g->>'due_on', g->>'group_name')
      from jsonb_array_elements(summary->'groups') g where (g->>'due_on')::date < today), '[]');
    plans := plans || coalesce((select jsonb_agg(jsonb_build_object('pet_id', pet.id, 'pet_name', pet.name,
        'group_key', g->>'group_key', 'group_name', g->>'group_name', 'plan_id', g #>> '{plan,id}'))
      from jsonb_array_elements(summary->'groups') g where g->'flags' ? 'plan_awaiting_review'), '[]');
  end loop;

  select max(m.created_at) filter (where m.sender_type = 'STAFF' and m.type not in ('NOTE', 'SYSTEM')),
         max(m.created_at) filter (where m.sender_type = 'CLIENT' and m.type not in ('NOTE', 'SYSTEM'))
  into last_staff, last_client
  from public.messages m join public.conversations c on c.id = m.conversation_id
  where c.client_id = p_client_id and not m.is_internal;

  result := jsonb_build_object(
    'as_of', today,
    'vaccines_overdue', vaccines,
    'vaccine_plans_awaiting_review', plans,
    'labs_overdue', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'pet_id', o.pet_id, 'pet_name', p.name, 'test_name', o.test_name, 'status', o.status, 'due_date', o.due_date) order by o.due_date, o.id)
      from public.patient_lab_orders o join public.pets p on p.id = o.pet_id
      where o.pet_id = any(active_pets) and o.status in ('planned', 'ordered') and o.due_date < today), '[]'),
    'labs_awaiting_results', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'pet_id', o.pet_id, 'pet_name', p.name, 'test_name', o.test_name, 'collected_date', o.collected_date) order by o.collected_date, o.id)
      from public.patient_lab_orders o join public.pets p on p.id = o.pet_id
      where o.pet_id = any(pets) and o.status = 'collected'), '[]'),
    'unsigned_records', coalesce((select jsonb_agg(jsonb_build_object('kind', u.kind, 'id', u.id, 'pet_id', u.pet_id, 'pet_name', p.name, 'at', u.at) order by u.at, u.id)
      from (
        select 'encounter' kind, e.id, e.pet_id, e.visit_at at from public.clinical_encounters e where e.pet_id = any(pets) and e.status = 'draft'
        union all select 'dental', d.id, d.pet_id, d.visit_at from public.dental_charts d where d.pet_id = any(pets) and d.status = 'draft'
        union all select 'anesthesia', a.id, a.pet_id, a.started_at from public.patient_anesthesia_records a where a.pet_id = any(pets) and a.status = 'draft'
        union all select 'qol', q.id, q.pet_id, q.observed_at from public.patient_qol_records q where q.pet_id = any(pets) and q.status = 'draft'
        union all select 'qol_scale', s.id, s.pet_id, s.assessed_at from public.patient_qol_scale_assessments s where s.pet_id = any(pets) and s.status = 'draft'
      ) u join public.pets p on p.id = u.pet_id), '[]'),
    'prescriptions_unsigned', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'pet_id', d.pet_id, 'pet_name', p.name, 'medication', nullif(trim(d.fields #>> '{medication,name}'), ''), 'updated_at', d.updated_at) order by d.updated_at, d.id)
      from public.native_prescription_drafts d join public.pets p on p.id = d.pet_id
      where d.pet_id = any(pets) and d.status = 'draft'), '[]'),
    'refills_open', coalesce((select jsonb_agg(r order by r->>'requested_at', r->>'id') from (
        select jsonb_build_object('id', f.id, 'source', 'native', 'pet_id', f.pet_id, 'pet_name', p.name, 'medication', f.medication_requested, 'status', f.state, 'requested_at', f.created_at) r
        from public.native_refills f join public.pets p on p.id = f.pet_id where f.pet_id = any(pets) and f.state = 'open'
        union all
        select jsonb_build_object('id', q.id, 'source', 'legacy', 'pet_id', q.pet_id, 'pet_name', p.name, 'medication', q.medication_name, 'status', q.status, 'requested_at', q.requested_at)
        from public.refill_requests q left join public.pets p on p.id = q.pet_id
        where q.client_id = p_client_id and (p_pet_id is null or q.pet_id = p_pet_id) and q.status in ('REQUESTED', 'APPROVED', 'READY')
      ) x), '[]'),
    -- Billing belongs to the household in both scopes: the balance due is the parent's.
    'invoices_draft', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at) order by i.created_at, i.id)
      from public.billing_invoices i where i.client_id = p_client_id and i.status = 'draft'), '[]'),
    'invoices_unpaid', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'issued_at', b.issued_at, 'outstanding_cents', b.outstanding::text) order by b.issued_at, b.id)
      from (select i.id, i.issued_at, (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint outstanding
            from public.billing_invoices i where i.client_id = p_client_id and i.status = 'issued') b where b.outstanding > 0), '[]'),
    'estimates_open', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'pet_id', e.pet_id, 'pet_name', p.name, 'created_at', e.created_at) || e.state order by e.created_at, e.id)
      from (select d.*, public.patient_360_estimate_status_internal(d.id) state from public.native_estimate_drafts d
            where d.client_id = p_client_id and (p_pet_id is null or d.pet_id = p_pet_id)) e
      left join public.pets p on p.id = e.pet_id
      where e.state->>'status' in ('draft', 'awaiting_decision')), '[]'),
    'communication', jsonb_build_object(
      'conversation_id', (select c.id from public.conversations c where c.client_id = p_client_id and c.status = 'ACTIVE' order by c.last_message_at desc nulls last, c.created_at desc, c.id limit 1),
      'unread', exists(select 1 from public.conversations c where c.client_id = p_client_id and c.status = 'ACTIVE' and not c.is_read),
      'last_client_at', last_client,
      'last_staff_at', last_staff,
      'awaiting_reply', last_client is not null and (last_staff is null or last_client > last_staff),
      'missed_calls', (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id
        where c.client_id = p_client_id and m.type = 'CALL_INBOUND' and m.sender_type = 'CLIENT' and m.content like 'Missed incoming call%'
          and (last_staff is null or m.created_at > last_staff)),
      'voicemails', (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id
        where c.client_id = p_client_id and m.type = 'VOICEMAIL' and (last_staff is null or m.created_at > last_staff))
    ),
    'upcoming_appointment', (select jsonb_build_object('id', a.id, 'pet_id', a.pet_id, 'pet_name', p.name, 'scheduled_at', a.scheduled_at, 'appointment_type', a.appointment_type, 'visit_type', a.visit_type, 'status', a.status)
      from public.appointments a left join public.pets p on p.id = a.pet_id
      where a.client_id = p_client_id and (p_pet_id is null or a.pet_id = p_pet_id) and a.status in ('SCHEDULED', 'CONFIRMED') and a.scheduled_at >= now()
      order by a.scheduled_at, a.id limit 1),
    'reminders_failing', coalesce((select jsonb_agg(f order by f->>'at' desc) from (
        select jsonb_build_object('job_kind', 'care', 'id', j.id, 'pet_id', j.pet_id, 'pet_name', p.name, 'source_kind', j.source_kind,
          'state', case when l.state = 'blocked' then 'blocked' else o.state end, 'reason', coalesce(l.reason, o.delivery_failure_kind), 'at', coalesce(o.updated_at, l.created_at)) f
        from public.care_reminder_jobs j join public.pets p on p.id = j.pet_id
        join public.reminder_outbox_links l on l.job_kind = 'care' and l.job_id = j.id and l.invalidated_at is null
        left join public.communication_outbox o on o.id = l.outbox_id
        where j.pet_id = any(pets) and (l.state = 'blocked' or o.state in ('failed', 'uncertain')) and coalesce(o.updated_at, l.created_at) > now() - interval '30 days'
        union all
        select jsonb_build_object('job_kind', 'appointment', 'id', r.id, 'pet_id', a.pet_id, 'pet_name', p.name, 'appointment_id', a.id,
          'state', case when l.state = 'blocked' then 'blocked' when o.state in ('failed', 'uncertain') then o.state else lower(r.status::text) end,
          'reason', coalesce(l.reason, o.delivery_failure_kind, r.error_message), 'at', coalesce(o.updated_at, l.created_at, r.updated_at, r.remind_at))
        from public.appointment_reminders r join public.appointments a on a.id = r.appointment_id
        left join public.pets p on p.id = a.pet_id
        left join public.reminder_outbox_links l on l.job_kind = 'appointment' and l.job_id = r.id and l.invalidated_at is null
        left join public.communication_outbox o on o.id = l.outbox_id
        where a.client_id = p_client_id and (p_pet_id is null or a.pet_id = p_pet_id)
          and (l.state = 'blocked' or o.state in ('failed', 'uncertain') or r.status = 'FAILED')
          and coalesce(o.updated_at, l.created_at, r.updated_at, r.remind_at) > now() - interval '30 days'
      ) x), '[]'),
    'release_emails_unsent', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'release_id', r.id, 'pet_id', r.pet_id, 'pet_name', p.name, 'state', q.state, 'created_at', q.created_at) order by q.created_at, q.id)
      from public.release_email_requests q join public.record_releases r on r.id = q.release_id join public.pets p on p.id = r.pet_id
      where r.pet_id = any(pets) and q.state in ('preparing', 'ready')
        and not exists(select 1 from public.record_release_events ev where ev.release_id = r.id and ev.kind = 'withdrawn')), '[]')
  );
  return result;
end $$;

create function public.patient_360_header_internal(p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.clients;
  consent jsonb;
begin
  select * into c from public.clients where id = p_client_id;
  consent := public.current_sms_consent(p_client_id);
  return jsonb_build_object(
    'household', jsonb_build_object('id', c.id, 'full_name', c.full_name, 'first_name', c.first_name, 'last_name', c.last_name,
      'primary_phone', c.primary_phone, 'primary_email', c.primary_email, 'preferred_channel', c.preferred_channel,
      'housecall_address', c.housecall_address, 'mailing_address', c.mailing_address),
    'pets', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'species', p.species, 'breed', p.breed,
        'archived_at', p.archived_at, 'deceased_at', p.deceased_at, 'allergies', nullif(trim(p.allergies), '')) order by (p.archived_at is not null or p.deceased_at is not null), p.name, p.id)
      from public.pets p where p.client_id = p_client_id), '[]'),
    'sms_consent', jsonb_build_object('opted_in', coalesce((consent->>'opted_in')::boolean, false), 'can_message', coalesce((consent->>'can_message')::boolean, false),
      'phone_number', consent->>'phone_number', 'updated_at', consent->>'updated_at'),
    'balance', (select jsonb_build_object('outstanding_cents', coalesce(sum(b.outstanding), 0)::text, 'open_invoice_count', count(*) filter (where b.outstanding > 0))
      from (select (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint outstanding
            from public.billing_invoices i where i.client_id = p_client_id and i.status = 'issued') b),
    'high_priority_problems', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'pet_id', pr.pet_id, 'pet_name', p.name, 'title', pr.title) order by p.name, pr.title, pr.id)
      from public.patient_problems pr join public.pets p on p.id = pr.pet_id
      where p.client_id = p_client_id and pr.status = 'active' and pr.importance = 'high'), '[]')
  );
end $$;

create function public.read_patient_360(p_patient_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  actor uuid := public.clinical_require_staff();
  pet public.pets;
  header jsonb;
begin
  if p_patient_id is null then raise exception 'Patient required' using errcode = '23514'; end if;
  select * into pet from public.pets where id = p_patient_id;
  if not found then raise exception 'Patient not found' using errcode = 'P0002'; end if;
  header := public.patient_360_header_internal(pet.client_id);
  return jsonb_build_object('version', 1, 'scope', 'patient', 'actor_id', actor, 'generated_at', now(),
    'patient', jsonb_build_object('id', pet.id, 'client_id', pet.client_id, 'name', pet.name, 'species', pet.species, 'breed', pet.breed,
      'sex', pet.sex, 'neuter_status', pet.neuter_status, 'dob', pet.dob, 'birth_date_precision', pet.birth_date_precision, 'color', pet.color,
      'microchip_id', pet.microchip_id, 'allergies', nullif(trim(pet.allergies), ''), 'archived_at', pet.archived_at, 'deceased_at', pet.deceased_at,
      'active_problem_count', (select count(*) from public.patient_problems pr where pr.pet_id = pet.id and pr.status = 'active')),
    'household', header->'household', 'pets', header->'pets', 'sms_consent', header->'sms_consent', 'balance', header->'balance',
    'high_priority_problems', coalesce((select jsonb_agg(x) from jsonb_array_elements(header->'high_priority_problems') x where x->>'pet_id' = pet.id::text), '[]'),
    'signals', public.patient_360_signals_internal(pet.client_id, pet.id));
end $$;

create function public.read_household_360(p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  actor uuid := public.clinical_require_staff();
  header jsonb;
begin
  if p_client_id is null then raise exception 'Household required' using errcode = '23514'; end if;
  if not exists(select 1 from public.clients where id = p_client_id) then raise exception 'Household not found' using errcode = 'P0002'; end if;
  header := public.patient_360_header_internal(p_client_id);
  return jsonb_build_object('version', 1, 'scope', 'household', 'actor_id', actor, 'generated_at', now(), 'patient', null,
    'household', header->'household', 'pets', header->'pets', 'sms_consent', header->'sms_consent', 'balance', header->'balance',
    'high_priority_problems', header->'high_priority_problems',
    'signals', public.patient_360_signals_internal(p_client_id, null));
end $$;

-- Unified timeline. Newest first by (at, sort_key); keyset cursor is the last
-- entry's (at, sort_key). Each source is bounded to p_limit + 1 rows before the
-- merge so a page never scans a whole history.
create function public.patient_360_timeline_internal(p_client_id uuid, p_pet_id uuid, p_kinds text[], p_before_at timestamptz, p_before_key text, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  allowed constant text[] := array['appointment','encounter','chart','treatment','lab','document','certificate','prescription','refill','estimate','invoice','payment','refund','credit','message','call','voicemail','reminder','record_release'];
  kinds text[];
  household boolean := p_pet_id is null;
  pets uuid[];
  rows jsonb;
  more boolean;
  last_entry jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Timeline page size must be 1-100' using errcode = '23514'; end if;
  if (p_before_at is null) <> (p_before_key is null) or (p_before_at is not null and not isfinite(p_before_at))
    or (p_before_key is not null and p_before_key !~ '^[a-z_]+:[0-9a-f-]{36}$') then
    raise exception 'Invalid timeline cursor' using errcode = '23514';
  end if;
  kinds := coalesce(p_kinds, allowed);
  if cardinality(kinds) = 0 or not kinds <@ allowed then raise exception 'Unknown timeline kind' using errcode = '23514'; end if;
  select coalesce(array_agg(p.id), '{}') into pets from public.pets p where p.client_id = p_client_id and (household or p.id = p_pet_id);

  with entries as (
    select * from (
      select 'appointment'::text kind, a.id, a.scheduled_at at, a.pet_id, nullif(trim(a.appointment_type), '') title, a.visit_type detail, a.status::text status, null::bigint amount_cents,
        jsonb_build_object('date', (a.scheduled_at at time zone 'America/Denver')::date, 'duration_minutes', a.duration_minutes) ref
      from public.appointments a
      where 'appointment' = any(kinds) and a.client_id = p_client_id and (household or a.pet_id = p_pet_id)
        and (p_before_at is null or (a.scheduled_at, 'appointment:' || a.id) < (p_before_at, p_before_key))
      order by a.scheduled_at desc, a.id desc limit p_limit + 1) s1
    union all select * from (
      select 'encounter', e.id, e.visit_at, e.pet_id, 'Visit note (SOAP)', nullif(trim(e.visit_type), ''), e.status, null::bigint, jsonb_build_object('signed_at', e.signed_at)
      from public.clinical_encounters e
      where 'encounter' = any(kinds) and e.pet_id = any(pets) and (p_before_at is null or (e.visit_at, 'encounter:' || e.id) < (p_before_at, p_before_key))
      order by e.visit_at desc, e.id desc limit p_limit + 1) s2
    union all select * from (
      select c.* from (
        select 'chart'::text kind, d.id, d.visit_at at, d.pet_id, 'Dental chart'::text title, null::text detail, d.status, null::bigint amount_cents, jsonb_build_object('chart', 'dental') ref from public.dental_charts d where d.pet_id = any(pets)
        union all select 'chart', a.id, a.started_at, a.pet_id, coalesce(nullif(trim(a.procedure_name), ''), 'Anesthesia record'), 'Anesthesia record', a.status, null, jsonb_build_object('chart', 'anesthesia') from public.patient_anesthesia_records a where a.pet_id = any(pets)
        union all select 'chart', q.id, q.observed_at, q.pet_id, 'Quality of life check-in', null, q.status, null, jsonb_build_object('chart', 'qol') from public.patient_qol_records q where q.pet_id = any(pets)
        union all select 'chart', s.id, s.assessed_at, s.pet_id, 'HHHHHMM quality-of-life scale', case when s.total is not null then 'Total ' || s.total || ' / 70' end, s.status, null, jsonb_build_object('chart', 'qol_scale') from public.patient_qol_scale_assessments s where s.pet_id = any(pets)
      ) c where 'chart' = any(kinds) and (p_before_at is null or (c.at, 'chart:' || c.id) < (p_before_at, p_before_key))
      order by c.at desc, c.id desc limit p_limit + 1) s3
    union all select * from (
      select t.* from (
        select 'treatment'::text kind, t.id, t.administered_at at, t.pet_id, t.product_name title, concat_ws(' · ', t.kind, nullif(trim(t.dose), ''), nullif(trim(t.route), '')) detail,
          case when exists(select 1 from public.patient_treatment_corrections x where x.treatment_id = t.id) then 'corrected' when t.historical then 'historical' else 'administered' end status,
          null::bigint amount_cents, jsonb_build_object('treatment_kind', t.kind, 'next_due_on', t.next_due_on) ref
        from public.patient_treatments t where t.pet_id = any(pets)
        union all select 'treatment', v.id, (v.administered_at::timestamp + time '12:00') at time zone 'America/Denver', v.pet_id, v.vaccine_name, 'Vaccination record', 'recorded', null,
          jsonb_build_object('treatment_kind', 'vaccine_record', 'next_due_on', v.next_due_at)
        from public.pet_vaccinations v where v.pet_id = any(pets)
      ) t where 'treatment' = any(kinds) and (p_before_at is null or (t.at, 'treatment:' || t.id) < (p_before_at, p_before_key))
      order by t.at desc, t.id desc limit p_limit + 1) s4
    union all select * from (
      select l.* from (
        select 'lab'::text kind, o.id, coalesce((coalesce(o.result_date, o.collected_date)::timestamp + time '12:00') at time zone 'America/Denver', o.created_at) at, o.pet_id, o.test_name title,
          nullif(trim(o.accession), '') detail, o.status, null::bigint amount_cents, jsonb_build_object('due_date', o.due_date, 'lab', 'order') ref
        from public.patient_lab_orders o where o.pet_id = any(pets)
        union all select 'lab', r.id, r.created_at, r.pet_id, coalesce(nullif(trim(r.result_type), ''), 'Lab result'), r.lab_provider, r.status, null, jsonb_build_object('lab', 'result')
        from public.lab_results r where r.pet_id = any(pets)
      ) l where 'lab' = any(kinds) and (p_before_at is null or (l.at, 'lab:' || l.id) < (p_before_at, p_before_key))
      order by l.at desc, l.id desc limit p_limit + 1) s5
    union all select * from (
      select d.* from (
        -- Finalized documents only: never another user's in-progress upload.
        select 'document'::text kind, pd.id, pd.finalized_at at, pd.pet_id, pd.file_name title, pd.category detail, pd.status, null::bigint amount_cents, jsonb_build_object('document', 'patient', 'source', pd.source) ref
        from public.patient_documents pd where pd.pet_id = any(pets) and pd.status in ('ready', 'void')
        union all select 'document', f.id, f.created_at, null::uuid, f.file_name, f.category::text, 'ready', null, jsonb_build_object('document', 'household', 'conversation_id', f.conversation_id)
        from public.client_files f where household and f.client_id = p_client_id
      ) d where 'document' = any(kinds) and (p_before_at is null or (d.at, 'document:' || d.id) < (p_before_at, p_before_key))
      order by d.at desc, d.id desc limit p_limit + 1) s6
    union all select * from (
      select 'certificate', v.id, v.issued_at, v.pet_id, v.kind, v.signature_name,
        coalesce((select case e.kind when 'void' then 'void' when 'superseded' then 'superseded' else 'issued' end from public.vaccine_certificate_events e where e.certificate_id = v.id and e.kind in ('void', 'superseded') order by e.created_at desc limit 1), 'issued'),
        null::bigint, '{}'::jsonb
      from public.vaccine_certificates v
      where 'certificate' = any(kinds) and v.pet_id = any(pets) and (p_before_at is null or (v.issued_at, 'certificate:' || v.id) < (p_before_at, p_before_key))
      order by v.issued_at desc, v.id desc limit p_limit + 1) s7
    union all select * from (
      select 'prescription', d.id, d.created_at, d.pet_id, coalesce(nullif(trim(d.fields #>> '{medication,name}'), ''), 'Prescription'), nullif(trim(d.fields #>> '{medication,strength}'), ''),
        coalesce((select case e.action when 'cancel' then 'cancelled' else 'replaced' end from public.native_prescription_authorization_events e where e.authorization_id = d.authorization_id order by e.event_version desc limit 1), d.status),
        null::bigint, '{}'::jsonb
      from public.native_prescription_drafts d
      where 'prescription' = any(kinds) and d.pet_id = any(pets) and (p_before_at is null or (d.created_at, 'prescription:' || d.id) < (p_before_at, p_before_key))
      order by d.created_at desc, d.id desc limit p_limit + 1) s8
    union all select * from (
      select r.* from (
        select 'refill'::text kind, f.id, f.created_at at, f.pet_id, f.medication_requested title, f.channel detail, f.state status, null::bigint amount_cents, jsonb_build_object('refill', 'native') ref
        from public.native_refills f where f.pet_id = any(pets)
        union all select 'refill', q.id, q.created_at, q.pet_id, q.medication_name, null, lower(q.status::text), null, jsonb_build_object('refill', 'legacy', 'conversation_id', q.conversation_id)
        from public.refill_requests q where q.client_id = p_client_id and (household or q.pet_id = p_pet_id)
      ) r where 'refill' = any(kinds) and (p_before_at is null or (r.at, 'refill:' || r.id) < (p_before_at, p_before_key))
      order by r.at desc, r.id desc limit p_limit + 1) s9
    union all select * from (
      select 'estimate', d.id, d.created_at, d.pet_id, 'Estimate', null::text, st->>'status', (st->>'total_cents')::bigint, st - 'status' - 'total_cents'
      from public.native_estimate_drafts d cross join lateral public.patient_360_estimate_status_internal(d.id) st
      where 'estimate' = any(kinds) and d.client_id = p_client_id and (household or d.pet_id = p_pet_id)
        and (p_before_at is null or (d.created_at, 'estimate:' || d.id) < (p_before_at, p_before_key))
      order by d.created_at desc, d.id desc limit p_limit + 1) s10
    union all select * from (
      select 'invoice', i.id, coalesce(i.issued_at, i.created_at), null::uuid, 'Invoice', null::text, i.status, i.total_cents,
        jsonb_build_object('outstanding_cents', case when i.status = 'issued' then public.payment_balance_internal(i.id)->>'outstanding_cents' end)
      from public.billing_invoices i
      where 'invoice' = any(kinds) and i.client_id = p_client_id
        and (household or exists(select 1 from public.billing_invoice_items it where it.invoice_id = i.id and it.pet_id = p_pet_id))
        and (p_before_at is null or (coalesce(i.issued_at, i.created_at), 'invoice:' || i.id) < (p_before_at, p_before_key))
      order by coalesce(i.issued_at, i.created_at) desc, i.id desc limit p_limit + 1) s11
    union all select * from (
      select m.kind, m.id, m.at, m.pet_id, m.title, m.detail, m.status, m.amount_cents, m.ref from (
        select 'payment'::text kind, p.id, p.created_at at, null::uuid pet_id, 'Payment received'::text title, null::text detail, 'settled'::text status, p.amount_cents, jsonb_build_object('invoice_id', p.invoice_id) ref, i.client_id, i.id invoice_id
        from public.invoice_payments p join public.billing_invoices i on i.id = p.invoice_id
        union all select 'refund', r.id, r.created_at, null, 'Refund issued', null, 'settled', r.amount_cents, jsonb_build_object('invoice_id', r.invoice_id), i.client_id, i.id
        from public.invoice_refunds r join public.billing_invoices i on i.id = r.invoice_id
        union all select 'credit', c.id, c.created_at, null, 'Credit applied', c.reason, 'applied', c.amount_cents, jsonb_build_object('invoice_id', c.invoice_id), i.client_id, i.id
        from public.billing_credits c join public.billing_invoices i on i.id = c.invoice_id
      ) m where m.kind = any(kinds) and m.client_id = p_client_id
        and (household or exists(select 1 from public.billing_invoice_items it where it.invoice_id = m.invoice_id and it.pet_id = p_pet_id))
        and (p_before_at is null or (m.at, m.kind || ':' || m.id) < (p_before_at, p_before_key))
      order by m.at desc, m.kind desc, m.id desc limit p_limit + 1) s12
    union all select * from (
      -- Messages are household-level; the patient view shows the household thread too.
      -- Never recordings, transcriptions or audio links.
      select case when m.type in ('CALL_INBOUND', 'CALL_OUTBOUND') then 'call' when m.type = 'VOICEMAIL' then 'voicemail' else 'message' end kind,
        m.id, m.created_at, null::uuid, m.type::text, left(m.content, 200), m.sender_type::text, null::bigint,
        jsonb_build_object('conversation_id', m.conversation_id, 'internal', m.is_internal, 'provider', m.provider)
      from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.client_id = p_client_id
        and (case when m.type in ('CALL_INBOUND', 'CALL_OUTBOUND') then 'call' when m.type = 'VOICEMAIL' then 'voicemail' else 'message' end) = any(kinds)
        and (p_before_at is null or (m.created_at, (case when m.type in ('CALL_INBOUND', 'CALL_OUTBOUND') then 'call' when m.type = 'VOICEMAIL' then 'voicemail' else 'message' end) || ':' || m.id) < (p_before_at, p_before_key))
      order by m.created_at desc, 1 desc, m.id desc limit p_limit + 1) s13
    union all select * from (
      select r.* from (
        select 'reminder'::text kind, j.id, j.created_at at, j.pet_id, j.source_kind title, j.channel detail,
          case when l.state = 'blocked' then 'blocked' when o.state is not null then o.state when j.status = 'invalidated' then 'invalidated' else 'scheduled' end status,
          null::bigint amount_cents, jsonb_build_object('reminder', 'care', 'due_on', j.due_on, 'scheduled_on', j.scheduled_on, 'reason', coalesce(l.reason, j.invalidation_reason)) ref
        from public.care_reminder_jobs j
        left join public.reminder_outbox_links l on l.job_kind = 'care' and l.job_id = j.id
        left join public.communication_outbox o on o.id = l.outbox_id
        where j.pet_id = any(pets)
        union all
        select 'reminder', ar.id, coalesce(ar.sent_at, ar.remind_at), a.pet_id, 'appointment', ar.channel,
          case when l.state = 'blocked' then 'blocked' when o.state is not null then o.state else lower(ar.status::text) end, null,
          jsonb_build_object('reminder', 'appointment', 'appointment_id', a.id, 'date', (a.scheduled_at at time zone 'America/Denver')::date, 'reason', coalesce(l.reason, ar.error_message))
        from public.appointment_reminders ar join public.appointments a on a.id = ar.appointment_id
        left join public.reminder_outbox_links l on l.job_kind = 'appointment' and l.job_id = ar.id
        left join public.communication_outbox o on o.id = l.outbox_id
        where a.client_id = p_client_id and (household or a.pet_id = p_pet_id) and (ar.status <> 'PENDING' or ar.remind_at <= now())
      ) r where 'reminder' = any(kinds) and (p_before_at is null or (r.at, 'reminder:' || r.id) < (p_before_at, p_before_key))
      order by r.at desc, r.id desc limit p_limit + 1) s14
    union all select * from (
      select 'record_release', r.id, r.created_at, r.pet_id, r.channel, r.recipient,
        case when exists(select 1 from public.record_release_events e where e.release_id = r.id and e.kind = 'withdrawn') then 'withdrawn' else 'prepared' end,
        null::bigint, jsonb_build_object('email', (select q.state from public.release_email_requests q where q.release_id = r.id order by q.created_at desc, q.id desc limit 1))
      from public.record_releases r
      where 'record_release' = any(kinds) and r.pet_id = any(pets) and (p_before_at is null or (r.created_at, 'record_release:' || r.id) < (p_before_at, p_before_key))
      order by r.created_at desc, r.id desc limit p_limit + 1) s15
  ), page as (
    select e.*, e.kind || ':' || e.id sort_key from entries e
    order by e.at desc, e.kind || ':' || e.id desc limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', pg.kind, 'id', pg.id, 'at', pg.at, 'sort_key', pg.sort_key, 'pet_id', pg.pet_id, 'pet_name', p.name,
      'title', pg.title, 'detail', pg.detail, 'status', pg.status, 'amount_cents', pg.amount_cents::text, 'ref', pg.ref) order by pg.at desc, pg.sort_key desc), '[]')
  into rows
  from page pg left join public.pets p on p.id = pg.pet_id;

  more := jsonb_array_length(rows) > p_limit;
  if more then rows := rows - p_limit; end if;
  last_entry := rows -> (jsonb_array_length(rows) - 1);
  return jsonb_build_object('version', 1, 'scope', case when household then 'household' else 'patient' end, 'client_id', p_client_id, 'pet_id', p_pet_id,
    'kinds', to_jsonb(kinds), 'entries', rows, 'has_more', more,
    'next_cursor', case when more then jsonb_build_object('before_at', last_entry->'at', 'before_key', last_entry->'sort_key') end);
end $$;

create function public.list_patient_timeline(p_patient_id uuid, p_kinds text[] default null, p_before_at timestamptz default null, p_before_key text default null, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare household uuid;
begin
  perform public.clinical_require_staff();
  if p_patient_id is null then raise exception 'Patient required' using errcode = '23514'; end if;
  select client_id into household from public.pets where id = p_patient_id;
  if not found then raise exception 'Patient not found' using errcode = 'P0002'; end if;
  return public.patient_360_timeline_internal(household, p_patient_id, p_kinds, p_before_at, p_before_key, p_limit);
end $$;

create function public.list_household_timeline(p_client_id uuid, p_kinds text[] default null, p_before_at timestamptz default null, p_before_key text default null, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.clinical_require_staff();
  if p_client_id is null then raise exception 'Household required' using errcode = '23514'; end if;
  if not exists(select 1 from public.clients where id = p_client_id) then raise exception 'Household not found' using errcode = 'P0002'; end if;
  return public.patient_360_timeline_internal(p_client_id, null, p_kinds, p_before_at, p_before_key, p_limit);
end $$;

revoke all on function public.patient_360_estimate_status_internal(uuid), public.patient_360_signals_internal(uuid, uuid),
  public.patient_360_header_internal(uuid), public.patient_360_timeline_internal(uuid, uuid, text[], timestamptz, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.read_patient_360(uuid), public.read_household_360(uuid),
  public.list_patient_timeline(uuid, text[], timestamptz, text, integer), public.list_household_timeline(uuid, text[], timestamptz, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.read_patient_360(uuid), public.read_household_360(uuid),
  public.list_patient_timeline(uuid, text[], timestamptz, text, integer), public.list_household_timeline(uuid, text[], timestamptz, text, integer)
  to authenticated;
