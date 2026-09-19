import type { Database, Json } from "@/integrations/supabase/types";
export interface LabValues {
  test_name: string;
  status: string;
  due_date: string | null;
  collected_date: string | null;
  result_date: string | null;
  accession: string;
  notes: string;
  result_document_id: string | null;
  template_id: string | null;
  template_version: number | null;
  interval_days: number | null;
  interval_anchor: string | null;
  override_reason: string;
}
export interface LabOrder extends LabValues {
  id: string;
  pet_id: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}
export interface LabTemplate {
  id: string;
  name: string;
  interval_days: number;
  active: boolean;
  review_note: string;
  version: number;
  updated_by: string;
  updated_at: string;
}
export interface LabRevision {
  id: number;
  entity: string;
  entity_id: string;
  version: number;
  snapshot: Json;
  reason: string;
  actor_id: string;
  recorded_at: string;
}
interface Table<Row> {
  Row: { [K in keyof Row]: Row[K] };
  Insert: never;
  Update: never;
  Relationships: [];
}
export interface LabDatabase {
  public: {
    Tables: {
      patient_lab_orders: Table<LabOrder>;
      lab_due_templates: Table<LabTemplate>;
      lab_work_revisions: Table<LabRevision>;
    };
    Views: Database["public"]["Views"];
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
    Functions: {
      save_patient_lab_order: {
        Args: {
          p_id: string;
          p_pet_id: string;
          p_expected_version: number | null;
          p_values: Json;
          p_correction_reason: string;
        };
        Returns: LabOrder;
      };
      save_lab_due_template: {
        Args: {
          p_id: string;
          p_expected_version: number | null;
          p_name: string;
          p_interval_days: number;
          p_active: boolean;
          p_review_note: string;
        };
        Returns: LabTemplate;
      };
    };
  };
}
export const emptyLab = (): LabValues => ({
  test_name: "",
  status: "planned",
  due_date: null,
  collected_date: null,
  result_date: null,
  accession: "",
  notes: "",
  result_document_id: null,
  template_id: null,
  template_version: null,
  interval_days: null,
  interval_anchor: null,
  override_reason: "",
});
export function labValues(row: LabOrder): LabValues {
  return Object.fromEntries(
    Object.keys(emptyLab()).map((key) => [key, row[key as keyof LabValues]]),
  ) as unknown as LabValues;
}
export function dueFromInterval(anchor: string, days: number): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 36500
  )
    throw new Error(
      "Enter a valid anchor date and whole interval between 1 and 36,500 days.",
    );
  const date = new Date(`${anchor}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== anchor
  )
    throw new Error("Invalid anchor date.");
  date.setUTCDate(date.getUTCDate() + days);
  if (date.getUTCFullYear() > 9999)
    throw new Error("Due date is outside the supported range.");
  return date.toISOString().slice(0, 10);
}
