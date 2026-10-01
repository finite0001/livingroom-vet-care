-- Linkage integrity (audit 2026-09-30, section A + B10).
--
-- Clinical, consent, communication and labor history must never disappear as a
-- side effect of deleting a parent row. Every parent here is retired by state
-- (pets.archived_at / deceased_at, profiles.is_active, *.is_active) rather than
-- by DELETE, so the foreign keys below become ON DELETE RESTRICT.
--
-- New constraints that would have to scan legacy data are added NOT VALID: they
-- apply to every new or changed row immediately, but existing rows are only
-- checked by a later `alter table ... validate constraint ...` once the owner has
-- run the violator queries in docs (see the PR description).
--
-- Fixture cleanup in local test harnesses runs with session_replication_role =
-- replica, which skips FK and ordinary triggers, so it is unaffected.

-- ---------------------------------------------------------------------------
-- Helper: replace whatever single-column FK (table.column -> ref) exists, by
-- lookup in pg_constraint rather than by guessed name, with a named FK that has
-- the requested ON DELETE action. Session-local; dropped at end of migration.
-- ---------------------------------------------------------------------------
create function pg_temp.relink_fk(p_table regclass, p_column text, p_ref regclass, p_action text)
returns void language plpgsql as $$
declare
  con record;
  col smallint;
  base text := (select relname from pg_class where oid = p_table);
begin
  select attnum into strict col from pg_attribute where attrelid = p_table and attname = p_column and not attisdropped;
  for con in
    select conname from pg_constraint
    where contype = 'f' and conrelid = p_table and confrelid = p_ref and conkey = array[col]
  loop
    execute format('alter table %s drop constraint %I', p_table, con.conname);
  end loop;
  execute format(
    'alter table %s add constraint %I foreign key (%I) references %s(id) on delete %s',
    p_table, base || '_' || p_column || '_fkey', p_column, p_ref, p_action
  );
end $$;

-- A1/A2: patient history. A12: appointments.pet_id joins the same rule.
select pg_temp.relink_fk('public.pet_vaccinations', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.wellness_reminders', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.lab_results', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.consent_submissions', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.refill_requests', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.follow_up_instances', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.waitlist_entries', 'pet_id', 'public.pets', 'restrict');
select pg_temp.relink_fk('public.appointments', 'pet_id', 'public.pets', 'restrict');

-- A3: a signed consent outlives its template (retire templates via is_active).
select pg_temp.relink_fk('public.consent_submissions', 'template_id', 'public.consent_form_templates', 'restrict');

-- A4: legacy household-scoped rows (pets.client_id is already RESTRICT).
select pg_temp.relink_fk('public.conversations', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.client_files', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.client_notes', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.appointments', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.campaign_recipients', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.refill_requests', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.survey_responses', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.follow_up_instances', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.sms_consent', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.waitlist_entries', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.wellness_reminders', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.consent_submissions', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.lab_results', 'client_id', 'public.clients', 'restrict');
select pg_temp.relink_fk('public.payment_links', 'client_id', 'public.clients', 'restrict');
-- A4/A12: reminder jobs (and the reminder_outbox_links rows that name them)
-- must not vanish with their appointment.
select pg_temp.relink_fk('public.appointment_reminders', 'appointment_id', 'public.appointments', 'restrict');

-- A5: staff are deactivated (profiles.is_active = false), never deleted; a
-- profile delete would null administered_by / reviewed_by / assigned_dvm_id.
select pg_temp.relink_fk('public.profiles', 'id', 'auth.users', 'restrict');
-- A direct profile delete would still null those SET NULL actor columns, so the
-- browser path to it goes too (no src/ or edge-function caller deletes profiles).
drop policy if exists "Admins can delete profiles" on public.profiles;
revoke delete on public.profiles from anon, authenticated;

-- A6: labor and on-call history.
select pg_temp.relink_fk('public.time_entries', 'staff_id', 'auth.users', 'restrict');
select pg_temp.relink_fk('public.on_call_schedules', 'dvm_id', 'public.profiles', 'restrict');

-- A7: response/instance/recipient history outlives its survey/template/campaign.
select pg_temp.relink_fk('public.survey_responses', 'survey_id', 'public.surveys', 'restrict');
select pg_temp.relink_fk('public.follow_up_instances', 'template_id', 'public.follow_up_templates', 'restrict');
select pg_temp.relink_fk('public.campaign_recipients', 'campaign_id', 'public.campaigns', 'restrict');

-- A8: conversation history is archived, never deleted (guard_conversation_history
-- already refuses DELETE); the FKs now say the same thing.
select pg_temp.relink_fk('public.messages', 'conversation_id', 'public.conversations', 'restrict');
select pg_temp.relink_fk('public.message_attachments', 'message_id', 'public.messages', 'restrict');
drop function if exists public.delete_conversation_cascade(uuid);

-- A10: the intended SET NULL never applied (add column if not exists was a no-op).
select pg_temp.relink_fk('public.appointments', 'updated_by', 'auth.users', 'set null');

-- ---------------------------------------------------------------------------
-- A1: patients are archived (archived_at) or marked deceased (deceased_at),
-- never deleted. The guard fires before any FK check so the caller gets one
-- clear message. errcode 23503 matches what an FK-blocked delete reports.
-- ---------------------------------------------------------------------------
create function public.guard_pet_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Patients cannot be deleted; archive the patient (archived_at) or record deceased_at instead'
    using errcode = '23503', hint = 'Use save_patient to archive; clinical history stays attached to the patient.';
end $$;
create trigger guard_pet_delete before delete on public.pets
  for each row execute function public.guard_pet_delete();
revoke all on function public.guard_pet_delete() from public, anon, authenticated, service_role;

drop policy if exists "Admins delete pets" on public.pets;
revoke delete on public.pets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- A11: the patient on a legacy row must belong to that row's household.
-- MATCH SIMPLE (the default) skips rows whose pet_id is null, which is the
-- intended meaning: a household-only row has no patient to agree with.
-- DEFERRABLE so a future ownership-transfer workflow can move a patient and
-- its legacy rows in one transaction (pets_version refuses transfers today).
-- ---------------------------------------------------------------------------
alter table public.pets add constraint pets_id_client_id_key unique (id, client_id);

do $$
declare t text;
begin
  foreach t in array array['lab_results','consent_submissions','refill_requests','wellness_reminders','waitlist_entries','follow_up_instances'] loop
    execute format(
      'alter table public.%I add constraint %I foreign key (pet_id, client_id) references public.pets(id, client_id) deferrable initially immediate not valid',
      t, t || '_pet_household_fkey'
    );
  end loop;
end $$;

-- A14: actor columns without an FK. Staff actors reference public.profiles (A9).
alter table public.response_metrics
  add constraint response_metrics_staff_id_fkey foreign key (staff_id) references public.profiles(id) not valid;
alter table public.client_files
  add constraint client_files_uploaded_by_fkey foreign key (uploaded_by) references public.profiles(id) not valid;

-- ---------------------------------------------------------------------------
-- A17: legacy clinical tables are read-only history. Nothing in src/ or
-- supabase/functions writes them; native vaccinations and lab work have their
-- own audited tables and RPCs.
-- ---------------------------------------------------------------------------
drop policy if exists "Active staff insert pet_vaccinations" on public.pet_vaccinations;
drop policy if exists "Active staff update pet_vaccinations" on public.pet_vaccinations;
drop policy if exists "Admins delete pet_vaccinations" on public.pet_vaccinations;
drop policy if exists "Active staff insert lab_results" on public.lab_results;
drop policy if exists "Active staff update lab_results" on public.lab_results;
drop policy if exists "Admins delete lab_results" on public.lab_results;
revoke insert, update, delete, truncate on public.pet_vaccinations, public.lab_results from anon, authenticated;
comment on table public.pet_vaccinations is
  'Legacy (pre-native) vaccination history. Read-only for app roles; new vaccinations use the native vaccination tables and RPCs.';
comment on table public.lab_results is
  'Legacy (pre-native) lab result history. Read-only for app roles; new lab work uses patient_lab_orders and related RPCs.';

-- A18: vocabulary checks. Only PENDING (the default) has ever been written to
-- lab_results.status by code; REVIEWED pairs with reviewed_by/reviewed_at.
alter table public.lab_results
  add constraint lab_results_status_check check (status in ('PENDING', 'RECEIVED', 'REVIEWED')) not valid;
alter table public.appointment_reminders
  add constraint appointment_reminders_channel_check check (channel in ('SMS', 'EMAIL')) not valid;
comment on column public.lab_results.status is
  'Legacy upper-case vocabulary (PENDING, RECEIVED, REVIEWED). Native lab orders use lower-case states in patient_lab_orders.status.';

-- ---------------------------------------------------------------------------
-- Documentation-only decisions (A9, A13, A15, A16, A20).
-- ---------------------------------------------------------------------------
comment on table public.profiles is
  'Staff identity. Convention for NEW staff actor columns (created_by, reviewed_by, assigned_*, actor_id): reference public.profiles(id), not auth.users(id). profiles.id = auth.users.id, and staff are deactivated (is_active=false), never deleted. Older columns that reference auth.users are left as-is.';
comment on column public.profiles.role is
  'DEPRECATED. Not used for authorization. public.user_roles is authoritative (has_role / is_active_staff).';

comment on column public.reminder_outbox_links.job_id is
  'Intentionally polymorphic: appointment_reminders.id when job_kind=''appointment'', care_reminder_jobs.id when job_kind=''care''. Written only by queue_due_reminders(); appointment reminder rows can no longer be deleted out from under it (RESTRICT on the appointments chain).';
comment on column public.audit_logs.record_id is
  'Intentionally polymorphic (any audited table); no FK by design so audit rows survive.';
comment on column public.care_plan_revisions.entity_id is
  'Intentionally polymorphic revision subject; integrity enforced by the care-plan RPCs.';
comment on column public.care_reminder_jobs.source_id is
  'Intentionally polymorphic source (due plan / certificate); integrity enforced by the care reminder RPCs.';
comment on column public.document_link_grants.source_id is
  'Intentionally polymorphic document source; integrity enforced by the document link RPCs.';
comment on column public.lab_work_revisions.entity_id is
  'Intentionally polymorphic revision subject; integrity enforced by the lab work RPCs.';
comment on column public.record_release_sources.source_id is
  'Intentionally polymorphic release source; integrity enforced by the record release RPCs and frozen snapshots.';

comment on column public.outbound_deliveries.appointment_reminder_id is
  'FROZEN: retired outbound_deliveries reminder pipeline. Pairs with appointment_reminders.outbound_delivery_id; neither side is written by new code.';
comment on column public.urgent_alerts.campaign_id is
  'LEGACY/UNUSED: text, not a uuid FK to campaigns.id. Left as-is; do not build on it.';

-- ---------------------------------------------------------------------------
-- A21: index FK columns used by joins and by RESTRICT checks on parent delete.
-- ---------------------------------------------------------------------------
create index if not exists communication_outbox_conversation_id_idx on public.communication_outbox(conversation_id);
create index if not exists communication_outbox_client_id_idx on public.communication_outbox(client_id);
create index if not exists communication_inbound_conversation_id_idx on public.communication_inbound(conversation_id);
create index if not exists communication_inbound_client_id_idx on public.communication_inbound(client_id);
create index if not exists patient_treatments_invoice_id_idx on public.patient_treatments(invoice_id);
create index if not exists native_dispenses_pet_id_idx on public.native_dispenses(pet_id);
create index if not exists lab_results_client_id_idx on public.lab_results(client_id);
create index if not exists consent_submissions_client_id_idx on public.consent_submissions(client_id);
create index if not exists consent_submissions_pet_id_idx on public.consent_submissions(pet_id);
create index if not exists consent_submissions_template_id_idx on public.consent_submissions(template_id);
create index if not exists wellness_reminders_pet_id_idx on public.wellness_reminders(pet_id);
create index if not exists record_releases_client_id_idx on public.record_releases(client_id);
create index if not exists patient_documents_encounter_id_idx on public.patient_documents(encounter_id);
create index if not exists waitlist_entries_pet_id_idx on public.waitlist_entries(pet_id);
create index if not exists follow_up_instances_pet_id_idx on public.follow_up_instances(pet_id);
create index if not exists follow_up_instances_template_id_idx on public.follow_up_instances(template_id);
create index if not exists on_call_schedules_dvm_id_idx on public.on_call_schedules(dvm_id);
create index if not exists survey_responses_survey_id_idx on public.survey_responses(survey_id);
create index if not exists campaign_recipients_campaign_id_idx on public.campaign_recipients(campaign_id);

-- ---------------------------------------------------------------------------
-- B10: the legacy staff outbound queue is service-role only. Re-asserted here
-- because hosted projects may still carry the earlier default EXECUTE grant.
-- ---------------------------------------------------------------------------
revoke execute on function public.enqueue_staff_outbound_message(uuid, uuid, public.channel_type, text, text, text, timestamptz, text)
  from public, anon, authenticated;

drop function pg_temp.relink_fk(regclass, text, regclass, text);
