export interface ProblemFields {
  version: number;
  title: string;
  notes: string;
  onset_date: string | null;
  status: string;
  importance: string;
  updated_by: string;
  updated_at: string;
}
export interface HistorySources {
  problems?: Array<{
    id: string;
    created_by: string;
    created_at: string;
    current: ProblemFields;
    history: Array<{
      recorded_at: string;
      recorded_by: string;
      action: string;
      before: ProblemFields | null;
      after: ProblemFields | null;
    }>;
  }>;
  weights?: Array<{
    id: string;
    weight: number;
    unit: string;
    measured_at: string;
    recorded_by: string;
    created_at: string;
  }>;
  treatments?: Array<{
    id: string;
    kind: string;
    historical: boolean;
    product_name: string;
    manufacturer: string;
    lot_number: string;
    expires_on: string | null;
    quantity: number;
    dose: string;
    route: string;
    site: string;
    veterinarian: string;
    veterinarian_license: string;
    administered_at: string;
    next_due_on: string | null;
    source: string;
    created_by: string;
    created_at: string;
    corrections: Array<{
      id: string;
      reason: string;
      replacement_id: string | null;
      created_by: string;
      created_at: string;
    }>;
  }>;
  patient_summaries?: Array<{
    id: string;
    version: number;
    allergies: string | null;
    legacy_weight_lbs: number | null;
    provenance: string;
  }>;
}
const esc = (v: unknown) =>
  String(v ?? "Not recorded").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const field = (label: string, value: unknown) =>
  `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
function problem(p: ProblemFields) {
  return `<section class="${p.importance === "high" ? "clinical-alert" : ""}"><h3>${p.importance === "high" ? "IMPORTANT — " : ""}${esc(p.title)}</h3><dl>${field("Status", p.status)}${field("Importance", p.importance === "high" ? "IMPORTANT — high priority" : "Routine")}${field("Onset date", p.onset_date)}${field("Revision", p.version)}${field("Updated by", p.updated_by)}${field("Updated at", p.updated_at)}</dl><p>${esc(p.notes)}</p></section>`;
}
export function renderReleaseHistory(s: HistorySources): string {
  return (
    (s.patient_summaries || [])
      .map(
        (p) =>
          `<article><h2>Allergy and legacy profile summary</h2><p>${esc(p.provenance)}</p><section class="clinical-alert"><h3>Allergy information — review required</h3><p>${esc(p.allergies?.trim() || "No allergy text recorded; this does not establish absence of allergies.")}</p></section><p>Legacy weight: ${esc(p.legacy_weight_lbs)} lb. Measurement date unknown.</p><p>Patient version ${esc(p.version)}</p></article>`,
      )
      .join("") +
    (s.problems || [])
      .map(
        (p) =>
          `<article><h2>Problem / diagnosis history</h2>${problem(p.current)}<p>Authored ${esc(p.created_at)} by ${esc(p.created_by)}. Historical revisions below are retained clinical audit evidence; no missing past revision is reconstructed.</p>${p.history.map((h) => `<section><h3>Recorded revision · ${esc(h.recorded_at)} · ${esc(h.recorded_by)}</h3>${h.before ? `<h4>Before</h4>${problem(h.before)}` : ""}${h.after ? `<h4>After</h4>${problem(h.after)}` : ""}</section>`).join("")}</article>`,
      )
      .join("") +
    (s.weights?.length || 0
      ? `<article><h2>Dated weight measurements</h2>${s.weights!.map((w) => `<section><h3>${esc(w.measured_at)} · ${esc(w.weight)} ${esc(w.unit)}</h3><p>Recorded ${esc(w.created_at)} by ${esc(w.recorded_by)}</p></section>`).join("")}</article>`
      : "") +
    (s.treatments || [])
      .map(
        (t) =>
          `<article><h2>${esc(t.kind)} history · ${esc(t.product_name)}</h2>${t.corrections.length ? "<strong>CORRECTED HISTORICAL RECORD — do not treat this entry as a current administration or due date.</strong>" : ""}<dl>${field("Administration date/time", t.administered_at)}${field("Record origin", t.historical ? "Historical/imported" : "Native practice record")}${field("Source / provenance", t.source)}${field("Manufacturer", t.manufacturer)}${field("Lot number", t.lot_number)}${field("Lot expiry", t.expires_on)}${field("Quantity", t.quantity)}${field("Dose", t.dose)}${field("Route", t.route)}${field("Site", t.site)}${field("Veterinarian", t.veterinarian)}${field("License as recorded", t.veterinarian_license)}${field("Due date as recorded (not recalculated)", t.next_due_on)}${field("Recorded by", t.created_by)}${field("Recorded at", t.created_at)}</dl>${t.corrections.map((c) => `<section><h3>Correction</h3><p>${esc(c.reason)}</p><p>${esc(c.created_at)} · ${esc(c.created_by)}</p><p>Replacement record ID: ${esc(c.replacement_id)}${c.replacement_id && !s.treatments?.some((x) => x.id === c.replacement_id) ? " (not selected in this package)" : ""}</p></section>`).join("")}</article>`,
      )
      .join("")
  );
}
