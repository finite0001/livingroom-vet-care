import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
export interface VaccineDueTemplate {
  id: string;
  group_key: string;
  name: string;
  product_ids: string[];
  interval_days: number;
  active: boolean;
  review_note: string;
  version: number;
  updated_by: string;
  updated_at: string;
}
export interface VaccineDuePlan {
  id: string;
  pet_id: string;
  template_id: string;
  template_version: number;
  template_snapshot: Json;
  group_key: string;
  product_id: string;
  treatment_id: string | null;
  last_administered_on: string;
  anchor_source: string;
  interval_days: number;
  proposed_due_on: string;
  current_due_on: string;
  status: string;
  reminders_enabled: boolean;
  override_reason: string;
  review_note: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}
export interface CareMessageTemplate {
  id: string;
  name: string;
  channel: string;
  days_before: number;
  body: string;
  active: boolean;
  review_note: string;
  version: number;
  updated_by: string;
  updated_at: string;
}
export interface CareReminderJob {
  id: string;
  source_kind: string;
  source_id: string;
  source_version: number;
  pet_id: string;
  client_id: string;
  message_template_id: string;
  message_template_version: number;
  channel: string;
  scheduled_on: string;
  due_on: string;
  rendered_body: string;
  source_snapshot: Json;
  template_snapshot: Json;
  status: string;
  invalidation_reason: string | null;
  created_at: string;
  invalidated_at: string | null;
}
export interface CareRevision {
  id: number;
  entity: string;
  entity_id: string;
  version: number;
  snapshot: Json;
  actor_id: string;
  recorded_at: string;
}
export interface SaveVaccinePlanArgs {
  p_id: string;
  p_pet_id: string;
  p_expected_version: number | null;
  p_template_id: string;
  p_template_version: number;
  p_product_id: string;
  p_treatment_id: string | null;
  p_last_administered_on: string;
  p_anchor_source: string;
  p_interval_days: number;
  p_current_due_on: string;
  p_status: string;
  p_reminders_enabled: boolean;
  p_override_reason: string;
  p_review_note: string;
}
export interface ReminderOutboxLink {
  job_kind: string;
  job_id: string;
  outbox_id: string | null;
  state: string;
  reason: string | null;
  invalidated_at: string | null;
  policy_id: string;
  policy_version: number;
  approving_actor_id: string | null;
  frozen_context: Json | null;
  created_at: string;
}
export const careDb = supabase;
export const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function messageError(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Request failed";
}
