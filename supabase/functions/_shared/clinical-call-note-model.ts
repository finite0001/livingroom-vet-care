import { z } from "zod";
import {
  CALL_LIMITS, callProjectionLine, callSha256, callSourceDocumentSchema,
} from "./clinical-call-model.ts";
import {
  noteHashSchema, noteTemplateDefinitionSchema, noteTemplateFieldSchema,
} from "./clinical-note-model.ts";

export const CALL_NOTE_PAYLOAD_CONTRACT = "clinical-call-note-payload-v1";
export const CALL_NOTE_LIMITS = {
  claims: 96, claims_per_section: 24, supports_per_claim: 8,
  supports: 192, payload_bytes: 256000,
} as const;

function wellFormed(value: string) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
const text = (max: number) => z.string().max(max)
  .refine((v) => !v.includes("\0") && wellFormed(v));
const nonblank = (max: number) => text(max).refine((v) => !!v.trim());
export const callNoteSupportSchema = z.object({
  segment_ordinal: z.number().int().min(1).max(CALL_LIMITS.segments),
  segment_sha256: noteHashSchema,
  from: z.number().int().min(0).max(CALL_LIMITS.characters),
  to: z.number().int().min(1).max(CALL_LIMITS.characters),
  quote: nonblank(1000),
}).strict().refine((v) => v.to > v.from, "A nonempty exact segment range is required.");
export const callNoteClaimSchema = z.object({
  text: nonblank(500),
  patient_scope: z.enum(["selected_patient", "other_patient", "unassigned"]),
  supports: z.array(callNoteSupportSchema).min(1).max(CALL_NOTE_LIMITS.supports_per_claim),
}).strict();
export const callNoteFieldSchema = z.object({
  field_id: noteTemplateFieldSchema.shape.id,
  status: z.enum(["supported", "missing", "uncertain"]),
  claims: z.array(callNoteClaimSchema).max(24),
  uncertainty: text(500),
}).strict().superRefine((v, c) => {
  if (v.status === "missing"
    ? v.claims.length !== 0 || v.uncertainty !== ""
    : v.claims.length === 0 || (v.status === "supported"
      ? v.uncertainty !== "" : !v.uncertainty.trim())) {
    c.addIssue({ code: "custom", message: "Field evidence and uncertainty status differ." });
  }
});
export const callNotePayloadSchema = z.object({
  contract_version: z.literal(CALL_NOTE_PAYLOAD_CONTRACT),
  fields: z.array(callNoteFieldSchema).min(1).max(48),
  review_flags: z.array(nonblank(500)).max(10),
}).strict();

function boundary(value: string, offset: number) {
  const before = value.charCodeAt(offset - 1), after = value.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

/**
 * Pure evidence validation, not authorization or clinical entailment. The caller
 * must load and authorize the retained source/template and bind their manifests
 * server-side; browser-supplied documents cannot establish trusted provenance.
 */
export async function validateCallNotePayload(value: unknown, source: unknown, definition: unknown) {
  const payload = callNotePayloadSchema.parse(value);
  const document = callSourceDocumentSchema.parse(source);
  const template = noteTemplateDefinitionSchema.parse(definition);
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > CALL_NOTE_LIMITS.payload_bytes) {
    throw Error("Call draft byte budget exceeded.");
  }
  if (payload.fields.length !== template.fields.length) {
    throw Error("Every pinned call template field must be returned exactly once.");
  }
  const labels = new Set(document.callers.map((c) => c.localIdentifier));
  if (labels.size !== document.callers.length) throw Error("Original speaker labels must be unique.");
  let projection = "", previousStart = -1;
  for (const [index, segment] of document.segments.entries()) {
    const line = callProjectionLine(segment, index + 1);
    if (segment.ordinal !== index + 1 || !labels.has(segment.caller)
      || segment.end < segment.start || segment.start < previousStart
      || !wellFormed(segment.text) || segment.projection_from !== projection.length
      || projection.length + line.length > CALL_LIMITS.characters
      || segment.projection_to !== projection.length + line.length
      || segment.text_sha256 !== await callSha256(segment.text)) {
      throw Error("Retained call segment identity differs.");
    }
    projection += line;
    previousStart = segment.start;
  }
  if (projection !== document.projection) throw Error("Retained call projection differs.");
  const counts = { subjective: 0, objective: 0, assessment: 0, plan: 0 };
  let claims = 0, supports = 0, eligible = 0;
  for (const [index, field] of payload.fields.entries()) {
    const pinned = template.fields[index];
    if (field.field_id !== pinned.id) throw Error("Pinned call field identity/order differs.");
    claims += field.claims.length;
    counts[pinned.destination] += field.claims.length;
    for (const claim of field.claims) {
      if (claim.patient_scope === "selected_patient") eligible++;
      const seen = new Set<string>();
      for (const support of claim.supports) {
        supports++;
        const segment = document.segments[support.segment_ordinal - 1];
        const key = `${support.segment_ordinal}:${support.from}:${support.to}`;
        if (!segment || seen.has(key) || support.segment_sha256 !== segment.text_sha256
          || support.to > segment.text.length || !boundary(segment.text, support.from)
          || !boundary(segment.text, support.to)
          || segment.text.slice(support.from, support.to) !== support.quote) {
          throw Error("Each call claim requires its own exact retained segment support.");
        }
        seen.add(key);
      }
    }
  }
  if (claims > CALL_NOTE_LIMITS.claims || supports > CALL_NOTE_LIMITS.supports
    || Object.values(counts).some((n) => n > CALL_NOTE_LIMITS.claims_per_section)
    || eligible === 0) {
    throw Error("Call claim budget exceeded or no selected-patient claims.");
  }
  return payload;
}

export interface CallNoteSections {
  subjective: string; objective: string; assessment: string; plan: string;
}

/** Proposed text only. Patient-scope labels still require explicit clinical review. */
export async function assembleCallNoteSections(value: unknown, source: unknown, definition: unknown) {
  const payload = await validateCallNotePayload(value, source, definition);
  const template = noteTemplateDefinitionSchema.parse(definition);
  const sections: CallNoteSections = { subjective: "", objective: "", assessment: "", plan: "" };
  for (const [index, field] of payload.fields.entries()) {
    const selected = field.claims.filter((c) => c.patient_scope === "selected_patient");
    if (!selected.length) continue;
    const pinned = template.fields[index];
    if (sections[pinned.destination]) sections[pinned.destination] += "\n\n";
    sections[pinned.destination] += `${pinned.label}:\n${selected.map((c) => c.text).join("\n")}`;
    if (sections[pinned.destination].length > 50000) throw Error("Proposed call section is too long.");
  }
  return sections;
}
