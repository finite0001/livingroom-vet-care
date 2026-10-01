import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { denverDateTime, denverInstant } from "../clinical/editor-state.ts";
export interface MonitoringObservation {
  at: string;
  label: string;
  value: number;
  unit: string;
  notes: string;
}
export interface AnesthesiaEvent {
  at: string;
  kind: string;
  description: string;
}
export interface AnesthesiaValues {
  procedure_name: string;
  started_at: string;
  ended_at: string | null;
  team: string;
  assessment: string;
  plan: string;
  recovery_notes: string;
  observations: MonitoringObservation[];
  events: AnesthesiaEvent[];
  source: string;
  source_description: string;
  original_document_id: string | null;
}
export interface AnesthesiaRecord extends AnesthesiaValues {
  id: string;
  pet_id: string;
  status: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  signed_by: string | null;
  signed_at: string | null;
}
export interface AnesthesiaRevision {
  id: number;
  record_id: string;
  version: number;
  snapshot: Json;
  actor_id: string;
  recorded_at: string;
}
export interface AnesthesiaAddendum {
  id: string;
  record_id: string;
  content: string;
  actor_id: string;
  recorded_at: string;
}
export interface AnesthesiaDrugAdministration {
  id: string;
  record_id: string;
  pet_id: string;
  request: Json;
  created_by: string;
  created_at: string;
}
// Mirrors public.anesthesia_validate: the jsonb collections are checked at the
// API boundary so a malformed row fails loudly instead of rendering partially.
const observationSchema = z.object({
  at: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  notes: z.string(),
});
const eventSchema = z.object({
  at: z.string(),
  kind: z.string(),
  description: z.string(),
});
const anesthesiaRecordSchema = z.object({
  id: z.string(),
  pet_id: z.string(),
  status: z.string(),
  version: z.number(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  signed_by: z.string().nullable(),
  signed_at: z.string().nullable(),
  procedure_name: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  team: z.string(),
  assessment: z.string(),
  plan: z.string(),
  recovery_notes: z.string(),
  observations: z.array(observationSchema),
  events: z.array(eventSchema),
  source: z.string(),
  source_description: z.string(),
  original_document_id: z.string().nullable(),
});
export function parseAnesthesiaRecord(value: unknown): AnesthesiaRecord {
  return anesthesiaRecordSchema.parse(value) as AnesthesiaRecord;
}
export interface ObservationDraft {
  at: string;
  label: string;
  value: string;
  unit: string;
  notes: string;
}
export interface AnesthesiaDraft extends Omit<
  AnesthesiaValues,
  "observations"
> {
  observations: ObservationDraft[];
}
export function emptyAnesthesia(): AnesthesiaDraft {
  return {
    procedure_name: "",
    started_at: "",
    ended_at: null,
    team: "",
    assessment: "",
    plan: "",
    recovery_notes: "",
    observations: [],
    events: [],
    source: "manual",
    source_description: "",
    original_document_id: null,
  };
}
export function anesthesiaDraft(row: AnesthesiaRecord): AnesthesiaDraft {
  const fields = emptyAnesthesia();
  for (const key of Object.keys(fields) as (keyof AnesthesiaDraft)[])
    Object.assign(fields, { [key]: row[key] });
  return {
    ...fields,
    started_at: denverDateTime(row.started_at),
    ended_at: row.ended_at ? denverDateTime(row.ended_at) : null,
    observations: row.observations.map((o) => ({
      ...o,
      at: denverDateTime(o.at),
      value: String(o.value),
    })),
    events: row.events.map((e) => ({ ...e, at: denverDateTime(e.at) })),
  };
}
export function anesthesiaValues(form: AnesthesiaDraft): AnesthesiaValues {
  return {
    ...form,
    started_at: denverInstant(form.started_at),
    ended_at: form.ended_at ? denverInstant(form.ended_at) : null,
    observations: form.observations.map((o) => {
      if (
        !o.label.trim() ||
        !o.unit.trim() ||
        !o.value.trim() ||
        !Number.isFinite(Number(o.value)) ||
        Math.abs(Number(o.value)) > 1e100
      )
        throw new Error(
          "Each monitoring observation needs a label, explicit unit and finite recorded value.",
        );
      return { ...o, at: denverInstant(o.at), value: Number(o.value) };
    }),
    events: form.events.map((e) => ({ ...e, at: denverInstant(e.at) })),
  };
}
