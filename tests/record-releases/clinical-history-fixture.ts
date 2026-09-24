import { sourceProvenanceArtifact } from "./source-provenance-fixture.ts";
import type {
  ReleaseImportedHistory,
  ReleaseProblemExtraction,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
const id = (n: number) =>
  `b6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic source/admin/DVM distinctions; no clinical acceptance or outside signature. */
export function clinicalHistoryArtifact() {
  const a = sourceProvenanceArtifact(), s = a.preview.snapshot;
  s.schema_version = 6;
  const h: ReleaseImportedHistory = {
    id: id(1),
    version: 1,
    version_hash: "1".repeat(64),
    pet_id: s.patient.id,
    animal_link_id: id(2),
    source: {
      origin: "https://api.trial.ezyvet.com",
      site_uid: "Synthetic site",
      animal_id: "77",
      history_id: "31",
    },
    snapshot_id: id(3),
    payload_hash: "2".repeat(64),
    observed_head_version: 1,
    original: {
      comments: "Outside report mentions a reaction <script>unsafe()</script>",
      history_system: "Unknown category",
      chain: "Opaque chain",
      timestamp: "unknown-source-date",
      vet_id: "Outside clinician <reference>",
      active: "true",
      consult_id: "12",
    },
    approved_by: id(4),
    approved_at: "2026-09-12T12:00:00Z",
    consult: {
      status: "verified",
      snapshot_id: id(5),
      payload_hash: "3".repeat(64),
      observed_head_version: 1,
      external_id: "12",
    },
    current: {
      snapshot_id: id(6),
      head_version: 2,
      scoped: true,
      is_current: false,
      source_active: "false",
    },
  };
  const problem = s.problems![0];
  problem.id = id(7);
  const e: ReleaseProblemExtraction = {
    id: id(8),
    problem_id: problem.id,
    action: "create",
    problem_version: problem.current.version,
    problem_fields: {
      title: problem.current.title,
      notes: problem.current.notes,
      onset_date: problem.current.onset_date,
      status: problem.current.status,
      importance: problem.current.importance,
    },
    extracted_by: id(9),
    extracted_at: "2026-09-12T13:00:00Z",
    sources: [{
      id: h.id,
      version: h.version,
      version_hash: h.version_hash,
      source: h.source,
      snapshot_id: h.snapshot_id,
      payload_hash: h.payload_hash,
      observed_head_version: h.observed_head_version,
      approved_by: h.approved_by,
      approved_at: h.approved_at,
      narrative_included: true,
    }],
    current_problem_version: problem.current.version + 1,
    locally_edited: true,
    discrepancy: {
      required: true,
      changed_from_original: true,
      reviewed: false,
      review_history: [{
        id: id(10),
        reviewed_by: id(9),
        reviewed_at: "2026-09-12T14:00:00Z",
        sources: [],
        source_heads: [{
          history_id: h.id,
          snapshot_id: h.snapshot_id,
          head_version: 1,
        }],
      }],
    },
  };
  e.discrepancy.review_history[0].sources = e.sources;
  problem.current.version++;
  problem.current.notes = "Subsequent local note remains distinct.";
  s.imported_histories = [h];
  s.problem_source_extractions = [e];
  return a;
}
