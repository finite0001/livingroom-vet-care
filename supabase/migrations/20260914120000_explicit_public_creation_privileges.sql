-- Application migrations execute as postgres. Do not alter managed creator roles
-- or global defaults affecting auth/storage/other schemas.
alter default privileges for role postgres in schema public
  revoke all on tables from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public,anon,authenticated,service_role;

-- These counters serve immutable history written by owner-executed functions.
-- Existing application table/RPC grants and sequence ownership are unchanged.
revoke all on sequence
  public.anesthesia_record_revisions_id_seq,
  public.care_plan_revisions_id_seq,
  public.communication_processing_history_id_seq,
  public.lab_work_revisions_id_seq,
  public.reminder_automation_policy_history_id_seq
from public,anon,authenticated,service_role;

-- Schema-local defaults cannot override implicit global PUBLIC function EXECUTE.
-- Every new application function must still explicitly revoke PUBLIC privileges.
-- supabase_admin defaults require managed-platform authority and remain unchanged.
