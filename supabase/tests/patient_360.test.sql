begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Staff: active staff, inactive staff, and an active profile without a staff role.
insert into auth.users(id, email, raw_user_meta_data) values
('36000000-0000-4000-8000-000000000001', 'p360-staff@example.test', '{"first_name":"Three","last_name":"Sixty"}'),
('36000000-0000-4000-8000-000000000002', 'p360-inactive@example.test', '{}'),
('36000000-0000-4000-8000-000000000003', 'p360-norole@example.test', '{}'),
('36000000-0000-4000-8000-000000000004', 'p360-uploader@example.test', '{}');
update public.profiles set is_active = true where id in ('36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000004');
update public.profiles set is_active = false where id = '36000000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id, role) values
('36000000-0000-4000-8000-000000000001', 'STAFF'), ('36000000-0000-4000-8000-000000000002', 'STAFF'), ('36000000-0000-4000-8000-000000000004', 'TECH');

-- Clinical rows are written under a staff session, as the app does.
select set_config('request.jwt.claims', '{"sub":"36000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Household A: Luna (active), Milo (active), Old (archived). Household B: Rex.
insert into public.clients(id, first_name, last_name, full_name, primary_phone, primary_email, preferred_channel) values
('36100000-0000-4000-8000-000000000001', 'Ada', 'Lovelace', 'Ada Lovelace', '+17205550360', 'ada@example.test', 'SMS'),
('36100000-0000-4000-8000-000000000002', 'Other', 'Family', 'Other Family', '+17205550361', 'other@example.test', 'EMAIL');
insert into public.pets(id, client_id, name, species, allergies, archived_at) values
('36200000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', 'Luna', 'Dog', 'Penicillin', null),
('36200000-0000-4000-8000-000000000002', '36100000-0000-4000-8000-000000000001', 'Milo', 'Cat', null, null),
('36200000-0000-4000-8000-000000000003', '36100000-0000-4000-8000-000000000001', 'Old', 'Cat', null, now() - interval '1 year'),
('36200000-0000-4000-8000-000000000004', '36100000-0000-4000-8000-000000000002', 'Rex', 'Dog', null, null);

insert into public.patient_problems(id, pet_id, title, status, importance) values
('36300000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000001', 'Seizure history', 'active', 'high'),
('36300000-0000-4000-8000-000000000002', '36200000-0000-4000-8000-000000000001', 'Resolved otitis', 'resolved', 'high');

-- Appointments: Luna past + upcoming, Milo upcoming, Rex upcoming (other household).
insert into public.appointments(id, client_id, pet_id, scheduled_at, duration_minutes, appointment_type, status, visit_type) values
('36400000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000001', now() - interval '20 days', 30, 'Wellness exam', 'COMPLETED', 'housecall'),
('36400000-0000-4000-8000-000000000002', '36100000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000001', now() + interval '3 days', 30, 'Recheck', 'SCHEDULED', 'housecall'),
('36400000-0000-4000-8000-000000000003', '36100000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000002', now() + interval '1 day', 30, 'Dental consult', 'CONFIRMED', 'clinic'),
('36400000-0000-4000-8000-000000000004', '36100000-0000-4000-8000-000000000002', '36200000-0000-4000-8000-000000000004', now() + interval '2 hours', 30, 'Other household visit', 'SCHEDULED', 'clinic');

-- Clinical: unsigned SOAP for Luna, overdue vaccine for Luna and archived Old, overdue lab for Milo and Old.
insert into public.clinical_encounters(id, pet_id, visit_at, visit_type, status) values
('36500000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000001', now() - interval '20 days', 'housecall', 'draft');
insert into public.patient_treatments(id, pet_id, kind, historical, product_name, manufacturer, lot_number, site, veterinarian_license, quantity, dose, route, veterinarian, administered_at, next_due_on, source, request) values
('36500000-0000-4000-8000-000000000002', '36200000-0000-4000-8000-000000000001', 'vaccine', true, 'Synthetic Rabies 1yr', '', '', '', '', 1, '1 mL', 'SC', 'Dr. Synthetic', now() - interval '400 days', (now() at time zone 'America/Denver')::date - 35, 'historical_entry', '{}'),
('36500000-0000-4000-8000-000000000003', '36200000-0000-4000-8000-000000000003', 'vaccine', true, 'Synthetic FVRCP', '', '', '', '', 1, '1 mL', 'SC', 'Dr. Synthetic', now() - interval '800 days', (now() at time zone 'America/Denver')::date - 400, 'historical_entry', '{}');
insert into public.patient_lab_orders(id, pet_id, test_name, status, due_date, created_by, updated_by) values
('36500000-0000-4000-8000-000000000004', '36200000-0000-4000-8000-000000000002', 'Senior panel', 'ordered', (now() at time zone 'America/Denver')::date - 5, '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001'),
('36500000-0000-4000-8000-000000000005', '36200000-0000-4000-8000-000000000003', 'Archived patient panel', 'planned', (now() at time zone 'America/Denver')::date - 5, '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001');

-- Documents: a finalized one and another user's in-progress upload.
insert into public.patient_documents(id, pet_id, file_name, file_path, mime_type, file_size, category, source, visibility) values
('36500000-0000-4000-8000-000000000006', '36200000-0000-4000-8000-000000000001', 'luna-xray.png', 'set-by-guard', 'image/png', 100, 'medical_record', 'Upload', 'internal');
update public.patient_documents set status = 'ready' where id = '36500000-0000-4000-8000-000000000006';
select set_config('request.jwt.claims', '{"sub":"36000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
insert into public.patient_documents(id, pet_id, file_name, file_path, mime_type, file_size, category, source, visibility) values
('36500000-0000-4000-8000-000000000007', '36200000-0000-4000-8000-000000000001', 'someone-else-uploading.png', 'set-by-guard', 'image/png', 100, 'medical_record', 'Upload', 'internal');
select set_config('request.jwt.claims', '{"sub":"36000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Billing: a draft invoice, an issued invoice for Luna with a credit (4000 outstanding), a paid-off invoice for Milo.
insert into public.billing_invoices(id, client_id, status, total_cents, issued_at, created_at) values
('36600000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', 'draft', null, null, now() - interval '1 day'),
('36600000-0000-4000-8000-000000000002', '36100000-0000-4000-8000-000000000001', 'issued', 5000, now() - interval '15 days', now() - interval '16 days'),
('36600000-0000-4000-8000-000000000003', '36100000-0000-4000-8000-000000000001', 'issued', 2000, now() - interval '14 days', now() - interval '14 days');
insert into public.catalog_products(id, name, kind, unit, unit_price_cents, created_by) values
('36600000-0000-4000-8000-000000000008', 'Synthetic exam', 'service', 'visit', 5000, '36000000-0000-4000-8000-000000000001');
insert into public.billing_invoice_items(id, invoice_id, pet_id, product_id, description, quantity, unit_price_cents) values
('36600000-0000-4000-8000-000000000004', '36600000-0000-4000-8000-000000000002', '36200000-0000-4000-8000-000000000001', '36600000-0000-4000-8000-000000000008', 'Exam', 1, 5000),
('36600000-0000-4000-8000-000000000005', '36600000-0000-4000-8000-000000000003', '36200000-0000-4000-8000-000000000002', '36600000-0000-4000-8000-000000000008', 'Exam', 1, 2000);
insert into public.billing_credits(id, invoice_id, amount_cents, reason, created_by, created_at) values
('36600000-0000-4000-8000-000000000006', '36600000-0000-4000-8000-000000000002', 1000, 'Courtesy', '36000000-0000-4000-8000-000000000001', now() - interval '13 days'),
('36600000-0000-4000-8000-000000000007', '36600000-0000-4000-8000-000000000003', 2000, 'Written off', '36000000-0000-4000-8000-000000000001', now() - interval '13 days');

-- Messages: client text, staff reply, then a missed call, a voicemail with audio, and an internal note.
insert into public.conversations(id, client_id, status, is_read) values
('36700000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', 'ACTIVE', false),
('36700000-0000-4000-8000-000000000002', '36100000-0000-4000-8000-000000000002', 'ACTIVE', true);
insert into public.messages(id, conversation_id, type, sender_type, content, is_internal, audio_url, transcription, created_at) values
('36700000-0000-4000-8000-000000000003', '36700000-0000-4000-8000-000000000001', 'SMS', 'CLIENT', 'Can Luna come in?', false, null, null, now() - interval '5 hours'),
('36700000-0000-4000-8000-000000000004', '36700000-0000-4000-8000-000000000001', 'SMS', 'STAFF', 'Yes, booking now.', false, null, null, now() - interval '4 hours'),
('36700000-0000-4000-8000-000000000005', '36700000-0000-4000-8000-000000000001', 'CALL_INBOUND', 'CLIENT', 'Missed incoming call', false, null, null, now() - interval '3 hours'),
('36700000-0000-4000-8000-000000000006', '36700000-0000-4000-8000-000000000001', 'VOICEMAIL', 'CLIENT', 'Voicemail · 0m 42s', false, 'https://recordings.example.test/secret-audio', 'secret transcription words', now() - interval '2 hours'),
('36700000-0000-4000-8000-000000000007', '36700000-0000-4000-8000-000000000001', 'NOTE', 'STAFF', 'Internal: call back after 3', true, null, null, now() - interval '1 hour'),
('36700000-0000-4000-8000-000000000008', '36700000-0000-4000-8000-000000000002', 'SMS', 'CLIENT', 'Other household text', false, null, null, now() - interval '30 minutes');

-- Refills: an open legacy request for Luna (legacy history is read-only; seeded around its guard).
alter table public.refill_requests disable trigger legacy_refill_read_only;
insert into public.refill_requests(id, client_id, pet_id, medication_name, status, requested_at) values
('36800000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000001', 'Synthetic carprofen', 'REQUESTED', now() - interval '6 hours'),
('36800000-0000-4000-8000-000000000002', '36100000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000002', 'Picked up already', 'PICKED_UP', now() - interval '60 days');
alter table public.refill_requests enable trigger legacy_refill_read_only;

-- Estimates: an unpublished estimate for Luna.
insert into public.native_estimate_drafts(id, client_id, pet_id, created_by, created_at) values
('36600000-0000-4000-8000-000000000009', '36100000-0000-4000-8000-000000000001', '36200000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', now() - interval '2 days');

-- Reminders: a failed appointment reminder for Luna's past visit.
insert into public.appointment_reminders(id, appointment_id, remind_at, channel, status, error_message, appointment_version) values
('36900000-0000-4000-8000-000000000001', '36400000-0000-4000-8000-000000000001', now() - interval '21 days', 'SMS', 'FAILED', 'Carrier rejected', 1),
('36900000-0000-4000-8000-000000000002', '36400000-0000-4000-8000-000000000002', now() + interval '2 days', 'SMS', 'PENDING', null, 1);
update public.appointment_reminders set updated_at = now() - interval '21 days' where id = '36900000-0000-4000-8000-000000000001';

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- Grants: only the four read entry points are callable, and only by signed-in users.
select ok(has_function_privilege('authenticated', 'public.read_patient_360(uuid)', 'EXECUTE'), 'Staff sessions can call read_patient_360');
select ok(has_function_privilege('authenticated', 'public.read_household_360(uuid)', 'EXECUTE'), 'Staff sessions can call read_household_360');
select ok(has_function_privilege('authenticated', 'public.list_patient_timeline(uuid,text[],timestamptz,text,integer)', 'EXECUTE'), 'Staff sessions can call list_patient_timeline');
select ok(has_function_privilege('authenticated', 'public.list_household_timeline(uuid,text[],timestamptz,text,integer)', 'EXECUTE'), 'Staff sessions can call list_household_timeline');
select ok(not has_function_privilege('anon', 'public.read_patient_360(uuid)', 'EXECUTE'), 'Anonymous callers cannot read a patient 360');
select ok(not has_function_privilege('anon', 'public.list_household_timeline(uuid,text[],timestamptz,text,integer)', 'EXECUTE'), 'Anonymous callers cannot read a household timeline');
select ok(not has_function_privilege('service_role', 'public.read_household_360(uuid)', 'EXECUTE'), 'Service role has no 360 read grant');
select ok(not has_function_privilege('authenticated', 'public.patient_360_timeline_internal(uuid,uuid,text[],timestamptz,text,integer)', 'EXECUTE'), 'Timeline internals are not callable');
select ok(not has_function_privilege('authenticated', 'public.patient_360_signals_internal(uuid,uuid)', 'EXECUTE'), 'Signal internals are not callable');
select ok(not has_function_privilege('authenticated', 'public.patient_360_header_internal(uuid)', 'EXECUTE'), 'Header internals are not callable');
select ok(not has_function_privilege('authenticated', 'public.patient_360_estimate_status_internal(uuid)', 'EXECUTE'), 'Estimate status internals are not callable');

set local role authenticated;

-- Access control.
select pg_temp.as_user('36000000-0000-4000-8000-000000000002');
select throws_ok($$select public.read_patient_360('36200000-0000-4000-8000-000000000001')$$, '42501', 'Active staff access required', 'Inactive staff cannot read a patient 360');
select throws_ok($$select public.list_household_timeline('36100000-0000-4000-8000-000000000001')$$, '42501', 'Active staff access required', 'Inactive staff cannot read a household timeline');
select pg_temp.as_user('36000000-0000-4000-8000-000000000003');
select throws_ok($$select public.read_household_360('36100000-0000-4000-8000-000000000001')$$, '42501', 'Active staff access required', 'An active profile without a staff role cannot read a household 360');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001')$$, '42501', 'Active staff access required', 'An active profile without a staff role cannot read a patient timeline');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.read_patient_360('36200000-0000-4000-8000-000000000001')$$, '42501', 'Active staff access required', 'A session without a subject cannot read');

select pg_temp.as_user('36000000-0000-4000-8000-000000000001');
select throws_ok($$select public.read_patient_360('36200000-0000-4000-8000-0000000000ff')$$, 'P0002', 'Patient not found', 'Unknown patient is reported, not empty');
select throws_ok($$select public.read_household_360('36100000-0000-4000-8000-0000000000ff')$$, 'P0002', 'Household not found', 'Unknown household is reported, not empty');
select throws_ok($$select public.list_patient_timeline(null)$$, '23514', 'Patient required', 'Patient timeline requires a patient');

-- Patient 360 header.
create temp table r(k text primary key, v jsonb);
grant all on r to authenticated;
insert into r values ('luna', public.read_patient_360('36200000-0000-4000-8000-000000000001'));
insert into r values ('household', public.read_household_360('36100000-0000-4000-8000-000000000001'));
insert into r values ('milo', public.read_patient_360('36200000-0000-4000-8000-000000000002'));

select is((select v->>'scope' from r where k = 'luna'), 'patient', 'Patient read is patient-scoped');
select is((select v #>> '{patient,name}' from r where k = 'luna'), 'Luna', 'Patient identity returned');
select is((select v #>> '{patient,allergies}' from r where k = 'luna'), 'Penicillin', 'Allergy red flag returned');
select is((select (v #>> '{patient,active_problem_count}')::int from r where k = 'luna'), 1, 'Only active problems counted');
select is((select jsonb_array_length(v->'high_priority_problems') from r where k = 'luna'), 1, 'High-priority active problem surfaces as a red flag');
select is((select jsonb_array_length(v->'high_priority_problems') from r where k = 'milo'), 0, 'Another pet''s problem is not a red flag for Milo');
select is((select v #>> '{household,full_name}' from r where k = 'luna'), 'Ada Lovelace', 'Household contact returned with the patient');
select is((select v #>> '{household,preferred_channel}' from r where k = 'luna'), 'SMS', 'Preferred channel returned');
select is((select (v #>> '{sms_consent,can_message}')::boolean from r where k = 'luna'), false, 'SMS consent state reflects no recorded consent');
select is((select jsonb_array_length(v->'pets') from r where k = 'luna'), 3, 'Household pets listed, including archived');
select is((select v->'pets'->2->>'name' from r where k = 'luna'), 'Old', 'Inactive pets sort last');
select is((select v #>> '{balance,outstanding_cents}' from r where k = 'luna'), '4000', 'Balance due is the household outstanding after credits');
select is((select (v #>> '{balance,open_invoice_count}')::int from r where k = 'household'), 1, 'Only invoices with a balance count as open');

-- Next-step signals, patient scope.
select is((select jsonb_array_length(v #> '{signals,vaccines_overdue}') from r where k = 'luna'), 1, 'Luna has one overdue vaccine group');
select is((select v #>> '{signals,vaccines_overdue,0,group_name}' from r where k = 'luna'), 'Synthetic Rabies 1yr', 'Overdue vaccine named');
select is((select jsonb_array_length(v #> '{signals,labs_overdue}') from r where k = 'luna'), 0, 'Milo''s lab is not Luna''s next step');
select is((select jsonb_array_length(v #> '{signals,labs_overdue}') from r where k = 'milo'), 1, 'Milo has an overdue lab');
select is((select v #>> '{signals,unsigned_records,0,kind}' from r where k = 'luna'), 'encounter', 'Unsigned SOAP surfaces');
select is((select v #>> '{signals,unsigned_records,0,id}' from r where k = 'luna'), '36500000-0000-4000-8000-000000000001', 'Unsigned SOAP identified for deep link');
select is((select jsonb_array_length(v #> '{signals,invoices_draft}') from r where k = 'luna'), 1, 'Household draft invoice surfaces on the patient too');
select is((select v #>> '{signals,invoices_unpaid,0,outstanding_cents}' from r where k = 'luna'), '4000', 'Unpaid invoice carries its outstanding amount');
select is((select v #>> '{signals,estimates_open,0,status}' from r where k = 'luna'), 'draft', 'Unpublished estimate surfaces as a draft to finish');
select is((select jsonb_array_length(v #> '{signals,estimates_open}') from r where k = 'milo'), 0, 'Luna''s estimate is not Milo''s next step');
select is((select jsonb_array_length(v #> '{signals,refills_open}') from r where k = 'luna'), 1, 'Open refill request surfaces');
select is((select jsonb_array_length(v #> '{signals,refills_open}') from r where k = 'milo'), 0, 'Picked-up refill is not a next step');
select is((select v #>> '{signals,upcoming_appointment,id}' from r where k = 'luna'), '36400000-0000-4000-8000-000000000002', 'Luna''s next appointment, not Milo''s');
select is((select v #>> '{signals,upcoming_appointment,id}' from r where k = 'household'), '36400000-0000-4000-8000-000000000003', 'Household next appointment is the soonest of its pets');
select is((select v #>> '{signals,communication,conversation_id}' from r where k = 'luna'), '36700000-0000-4000-8000-000000000001', 'Active household thread identified');
select is((select (v #>> '{signals,communication,unread}')::boolean from r where k = 'luna'), true, 'Unread thread flagged');
select is((select (v #>> '{signals,communication,awaiting_reply}')::boolean from r where k = 'luna'), true, 'Client contact after the last staff reply awaits a reply');
select is((select (v #>> '{signals,communication,missed_calls}')::int from r where k = 'luna'), 1, 'Missed call since last reply counted');
select is((select (v #>> '{signals,communication,voicemails}')::int from r where k = 'luna'), 1, 'Voicemail since last reply counted');
select is((select jsonb_array_length(v #> '{signals,reminders_failing}') from r where k = 'luna'), 1, 'Failed reminder surfaces');
select is((select v #>> '{signals,reminders_failing,0,reason}' from r where k = 'luna'), 'Carrier rejected', 'Failed reminder reason returned');

-- Household scope aggregates across active pets only.
select is((select jsonb_array_length(v #> '{signals,vaccines_overdue}') from r where k = 'household'), 1, 'Archived pet''s overdue vaccine is not a household next step');
select is((select jsonb_array_length(v #> '{signals,labs_overdue}') from r where k = 'household'), 1, 'Archived pet''s overdue lab is not a household next step');
select is((select v #>> '{signals,labs_overdue,0,pet_name}' from r where k = 'household'), 'Milo', 'Household signals name the pet');
select is((select v->'patient' from r where k = 'household'), 'null'::jsonb, 'Household read has no patient');

-- Private media and other households never leak into the read model.
select ok((select v::text from r where k = 'household') !~ '(secret-audio|secret transcription|Other household)', 'Household 360 omits recordings, transcriptions and other households');

-- Timeline: household scope, newest first, keyset pagination without gaps or duplicates.
create temp table pages(n int, entries jsonb, more boolean, cursor jsonb);
grant all on pages to authenticated;
do $$
declare page jsonb; n int := 0; before_at timestamptz; before_key text;
begin
  loop
    n := n + 1;
    page := public.list_household_timeline('36100000-0000-4000-8000-000000000001', null, before_at, before_key, 4);
    insert into pages values (n, page->'entries', (page->>'has_more')::boolean, page->'next_cursor');
    exit when not (page->>'has_more')::boolean or n > 20;
    before_at := (page #>> '{next_cursor,before_at}')::timestamptz;
    before_key := page #>> '{next_cursor,before_key}';
  end loop;
end $$;
create temp view all_entries as select p.n, e.ordinality i, e.value v from pages p, jsonb_array_elements(p.entries) with ordinality e;
grant all on all_entries to authenticated;
select ok((select count(*) from pages) > 1, 'Household timeline spans several pages at page size 4');
select is((select count(*) from all_entries), (select count(distinct v->>'sort_key') from all_entries), 'No entry repeats across pages');
select ok(not exists(select 1 from all_entries a join all_entries b on (a.n, a.i) < (b.n, b.i)
  and ((a.v->>'at')::timestamptz, a.v->>'sort_key') < ((b.v->>'at')::timestamptz, b.v->>'sort_key')), 'Entries are strictly newest first across pages');
select is((select count(*) from all_entries), (select jsonb_array_length(public.list_household_timeline('36100000-0000-4000-8000-000000000001', null, null, null, 100)->'entries'))::bigint,
  'Paginated walk returns exactly the single-page result');
select is((select count(*) from pages where not more), 1::bigint, 'Only the last page reports no more entries');
select is((select cursor from pages where not more), 'null'::jsonb, 'The last page carries no next cursor');

select is((select count(*) from all_entries where v->>'kind' = 'appointment'), 3::bigint, 'Household appointments listed (not the other household''s)');
select is((select count(*) from all_entries where v->>'kind' = 'message'), 3::bigint, 'Household texts and the internal note listed');
select is((select count(*) from all_entries where v->>'kind' = 'call'), 1::bigint, 'Calls typed as calls');
select is((select count(*) from all_entries where v->>'kind' = 'voicemail'), 1::bigint, 'Voicemails typed as voicemails');
select is((select count(*) from all_entries where v->>'kind' = 'document'), 1::bigint, 'Only finalized documents appear; another user''s upload does not');
select is((select count(*) from all_entries where v->>'kind' = 'invoice'), 3::bigint, 'Household invoices listed');
select is((select count(*) from all_entries where v->>'kind' = 'credit'), 2::bigint, 'Credits listed');
select is((select count(*) from all_entries where v->>'kind' = 'reminder'), 1::bigint, 'Due or sent reminders listed; future pending reminders are not');
select is((select count(*) from all_entries where v->>'kind' = 'refill'), 2::bigint, 'Refill requests listed');
select is((select v->>'status' from all_entries where v->>'kind' = 'estimate'), 'draft', 'Estimates carry their lifecycle status');
select is((select count(*) from all_entries where v->>'kind' = 'treatment'), 2::bigint, 'Treatments for every household pet, including archived');
select is((select v->>'pet_name' from all_entries where v->>'kind' = 'encounter'), 'Luna', 'Entries carry the pet name');
select is((select v->>'status' from all_entries where v->>'kind' = 'encounter'), 'draft', 'Entries carry the source status');
select is((select v #>> '{ref,conversation_id}' from all_entries where v->>'id' = '36700000-0000-4000-8000-000000000003'), '36700000-0000-4000-8000-000000000001', 'Messages carry the thread for deep links');
select is((select v #>> '{ref,internal}' from all_entries where v->>'id' = '36700000-0000-4000-8000-000000000007'), 'true', 'Internal notes are flagged');
select ok((select string_agg(v::text, '') from all_entries) !~ '(secret-audio|secret transcription|Other household|someone-else-uploading)', 'Timeline omits media, other households and in-progress uploads');

-- Patient scope: only Luna's own records plus the household thread; invoices only with Luna's items.
create temp table luna_t as select e.value v from jsonb_array_elements(public.list_patient_timeline('36200000-0000-4000-8000-000000000001', null, null, null, 100)->'entries') e;
grant all on luna_t to authenticated;
select is((select count(*) from luna_t where v->>'kind' = 'appointment'), 2::bigint, 'Patient timeline has only the patient''s appointments');
select is((select count(*) from luna_t where v->>'kind' = 'invoice'), 1::bigint, 'Patient timeline has only invoices with the patient''s items');
select is((select count(*) from luna_t where v->>'kind' = 'credit'), 1::bigint, 'Patient timeline has credits on those invoices only');
select is((select count(*) from luna_t where v->>'kind' in ('message', 'call', 'voicemail')), 5::bigint, 'Patient timeline includes the household thread');
select is((select count(*) from luna_t where v->>'pet_id' = '36200000-0000-4000-8000-000000000002'), 0::bigint, 'No sibling records in the patient timeline');
select is((select count(*) from luna_t where v->>'kind' = 'refill'), 1::bigint, 'Only the patient''s refills');

-- Kind filters.
select is((select count(*) from jsonb_array_elements(public.list_patient_timeline('36200000-0000-4000-8000-000000000001', array['call','voicemail'], null, null, 100)->'entries') e
  where e.value->>'kind' not in ('call', 'voicemail')), 0::bigint, 'Kind filter returns only requested kinds');
select is(jsonb_array_length(public.list_patient_timeline('36200000-0000-4000-8000-000000000001', array['call','voicemail'], null, null, 100)->'entries'), 2, 'Kind filter returns every requested entry');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', array['recording'], null, null, 10)$$, '23514', 'Unknown timeline kind', 'Unknown kinds rejected');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', array[]::text[], null, null, 10)$$, '23514', 'Unknown timeline kind', 'Empty kind filter rejected');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', null, null, null, 0)$$, '23514', 'Timeline page size must be 1-100', 'Zero page size rejected');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', null, null, null, 101)$$, '23514', 'Timeline page size must be 1-100', 'Oversized page rejected');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', null, now(), null, 10)$$, '23514', 'Invalid timeline cursor', 'Half a cursor rejected');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', null, 'infinity', 'message:36700000-0000-4000-8000-000000000003', 10)$$, '23514', 'Invalid timeline cursor', 'Infinite cursor rejected');
select throws_ok($$select public.list_patient_timeline('36200000-0000-4000-8000-000000000001', null, now(), 'x'' or 1=1', 10)$$, '23514', 'Invalid timeline cursor', 'Malformed cursor key rejected');

-- The read model is read-only: nothing it reads changed.
reset role;
select is((select count(*) from public.messages where conversation_id = '36700000-0000-4000-8000-000000000001'), 5::bigint, 'Reads do not write thread entries');
select is((select is_read from public.conversations where id = '36700000-0000-4000-8000-000000000001'), false, 'Reads do not mark the thread read');

select * from finish();
rollback;
