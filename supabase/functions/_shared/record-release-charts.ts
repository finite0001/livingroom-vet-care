export interface ChartAddendum {
  id: string;
  content: string;
  created_at?: string;
  recorded_at?: string;
  created_by?: string;
  actor_id?: string;
}
interface SignedChart {
  id: string;
  version: number;
  signed_by: string;
  signed_at: string;
  addenda: ChartAddendum[];
}
export interface ReleaseDental extends SignedChart {
  species_family: string;
  dentition: string;
  visit_at: string;
  notes: string;
  teeth: Record<
    string,
    {
      presence: string;
      findings: string;
      planned: string;
      performed: string;
      measurements: Array<{ label: string; value_mm: number }>;
    }
  >;
}
export interface ReleaseQol extends SignedChart {
  template_version: string;
  observed_at: string;
  observer: string;
  appetite: string;
  drinking: string;
  mobility: string;
  comfort: string;
  social_engagement: string;
  good_days: string;
  notes: string;
}
export interface ReleaseAnesthesia extends SignedChart {
  procedure_name: string;
  started_at: string;
  ended_at: string | null;
  team: string;
  assessment: string;
  plan: string;
  recovery_notes: string;
  source: string;
  included_original_document_id: string | null;
  observations: Array<{
    at: string;
    label: string;
    value: number;
    unit: string;
    notes: string;
  }>;
  events: Array<{ at: string; kind: string; description: string }>;
}
export interface ReleaseLesion {
  id: string;
  version: number;
  label: string;
  observations: Array<{
    id: string;
    observed_at: string;
    label: string;
    body_view: string;
    x: number;
    y: number;
    length_mm: number | null;
    width_mm: number | null;
    depth_mm: number | null;
    notes: string;
    created_by: string;
    created_at: string;
    photo_document_id: string | null;
    corrections: Array<{
      id: string;
      reason: string;
      created_at: string;
      created_by: string;
    }>;
  }>;
}
export interface ChartSources {
  dental_charts?: ReleaseDental[];
  qol_records?: ReleaseQol[];
  anesthesia_records?: ReleaseAnesthesia[];
  lesions?: ReleaseLesion[];
}
const esc = (value: unknown) =>
  String(value ?? "Not recorded").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const field = (label: string, value: unknown) =>
  `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
const additions = (chart: SignedChart) =>
  `<p>Source version ${esc(chart.version)} · Signed ${esc(chart.signed_at)} · Signer record ${esc(chart.signed_by)}</p>${chart.addenda.map((a) => `<section><h3>Signed-record addendum</h3><p>${esc(a.content)}</p><p>${esc(a.created_at || a.recorded_at)} · Author record ${esc(a.created_by || a.actor_id)}</p></section>`).join("")}`;
export function renderReleaseCharts(
  s: ChartSources,
  attachmentName: (id: string | null) => string,
): string {
  const dental = (s.dental_charts || [])
    .map(
      (d) =>
        `<article><h2>Signed dental chart</h2><p>${esc(d.visit_at)} · ${esc(d.species_family)} · ${esc(d.dentition)}</p><p>${esc(d.notes)}</p>${Object.entries(
          d.teeth,
        )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([tooth, v]) =>
              `<section><h3>Tooth ${esc(tooth)}</h3><dl>${field("Presence", v.presence)}${field("Findings", v.findings)}${field("Planned", v.planned)}${field("Performed", v.performed)}</dl>${v.measurements.map((m) => `<p>${esc(m.label)}: ${esc(m.value_mm)} mm</p>`).join("")}</section>`,
          )
          .join("")}${additions(d)}</article>`,
    )
    .join("");
  const qol = (s.qol_records || [])
    .map(
      (q) =>
        `<article><h2>Signed qualitative QOL observation</h2><p>${esc(q.observed_at)} · Observer ${esc(q.observer)} · Template ${esc(q.template_version)}</p><p>Qualitative observations only; no validated score or prognosis is calculated.</p><dl>${field("Appetite", q.appetite)}${field("Drinking", q.drinking)}${field("Mobility", q.mobility)}${field("Comfort", q.comfort)}${field("Social engagement", q.social_engagement)}${field("Good days", q.good_days)}</dl><p>${esc(q.notes)}</p>${additions(q)}</article>`,
    )
    .join("");
  const anesthesia = (s.anesthesia_records || [])
    .map(
      (a) =>
        `<article><h2>Signed anesthesia record: ${esc(a.procedure_name)}</h2><dl>${field("Started", a.started_at)}${field("Ended", a.ended_at)}${field("Team", a.team)}${field("Record origin", a.source)}${field("Selected original", attachmentName(a.included_original_document_id))}</dl><h3>Assessment</h3><p>${esc(a.assessment)}</p><h3>Plan</h3><p>${esc(a.plan)}</p><h3>Documented observations</h3><table><thead><tr><th>Time</th><th>Observation</th><th>Value / unit</th><th>Notes</th></tr></thead><tbody>${a.observations.map((o) => `<tr><td>${esc(o.at)}</td><td>${esc(o.label)}</td><td>${esc(o.value)} ${esc(o.unit)}</td><td>${esc(o.notes)}</td></tr>`).join("")}</tbody></table><h3>Documented events</h3>${a.events.map((e) => `<p>${esc(e.at)} · ${esc(e.kind)}: ${esc(e.description)}</p>`).join("")}<h3>Recovery</h3><p>${esc(a.recovery_notes)}</p>${additions(a)}</article>`,
    )
    .join("");
  const lesions = (s.lesions || [])
    .map(
      (l) =>
        `<article><h2>Body-map history: ${esc(l.label)}</h2><p>Stable lesion ${esc(l.id)} · Version ${esc(l.version)}. Dated staff observations, not a signed diagnostic chart. All observations and corrections are retained.</p>${l.observations
          .map((o) => {
            if (
              !Number.isFinite(o.x) ||
              !Number.isFinite(o.y) ||
              o.x < 0 ||
              o.x > 1 ||
              o.y < 0 ||
              o.y > 1
            )
              throw new Error("Invalid schematic coordinates.");
            return `<section><h3>${esc(o.observed_at)} · ${esc(o.label)}</h3>${o.corrections.length ? "<p><strong>Corrected observation — historical measurement</strong></p>" : ""}<figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220" width="140" height="154" role="img" aria-label="Species-neutral schematic, ${esc(o.body_view)} view"><ellipse cx="100" cy="110" rx="52" ry="90" fill="none" stroke="currentColor"/><circle cx="${50 + o.x * 100}" cy="${20 + o.y * 180}" r="5" fill="currentColor"/></svg><figcaption>Species-neutral location schematic, ${esc(o.body_view)} view. Not an anatomical diagnosis.</figcaption></figure><dl>${field("Normalized X / Y", `${o.x} / ${o.y}`)}${field("Length (mm)", o.length_mm)}${field("Width (mm)", o.width_mm)}${field("Depth (mm)", o.depth_mm)}${field("Selected photo", attachmentName(o.photo_document_id))}</dl><p>${esc(o.notes)}</p><p>Recorded ${esc(o.created_at)} · Author record ${esc(o.created_by)}</p>${o.corrections.map((c) => `<p>Correction ${esc(c.created_at)}: ${esc(c.reason)} · Author record ${esc(c.created_by)}</p>`).join("")}</section>`;
          })
          .join("")}</article>`,
    )
    .join("");
  return dental + qol + anesthesia + lesions;
}
