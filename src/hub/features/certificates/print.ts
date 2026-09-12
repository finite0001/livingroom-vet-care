/** Versioned renderer: exclusively renders the issued snapshot, never live patient data. */
export interface CertificateSnapshot {
  schema_version: 1 | 2;
  due_plans?: Array<{
    plan_id: string;
    plan_version: number;
    group_key: string;
    group_name: string;
    template_id: string;
    template_version: number;
    product_id: string;
    treatment_id: string | null;
    last_administered_on: string;
    status: "current" | "proposed";
    reviewed_due_on: string | null;
  }>;
  kind: "vaccine_history" | "rabies";
  patient: {
    id: string;
    name: string;
    species: string;
    breed: string | null;
    dob: string | null;
    birth_date_precision: string;
    color: string | null;
    sex: string;
    neuter_status: string;
    microchip_id: string | null;
  };
  owner: { id: string; name: string; address: string; phone: string };
  issuer: {
    user_id: string;
    full_name: string;
    license_number: string;
    license_state: string;
    practice_name: string;
    practice_address: string;
    practice_phone: string;
  };
  vaccinations: Array<{
    treatment_id: string;
    historical: boolean;
    product_name: string;
    manufacturer: string;
    lot_number: string;
    lot_expires_on: string | null;
    dose: string;
    route: string;
    site: string;
    veterinarian: string;
    veterinarian_license: string;
    administered_on: string;
    next_due_on: string | null;
    source: string;
    age_at_administration: string | null;
  }>;
  details: {
    due_plan_review_version?: 2;
    administrator?: string;
    rabies_tag_number?: string;
    usda_duration?: string;
    vaccine_type?: string;
    owner_business_phone?: string;
    owner_business_phone_unavailable?: boolean;
    size_description?: string;
    initial_or_booster?: string;
    supervision_attested?: boolean;
  };
}
export interface IssuedCertificate {
  id: string;
  snapshot: CertificateSnapshot;
  signature_name: string;
  issued_at: string;
  attestation: string;
  replaces_id: string | null;
}
export interface CertificateEvent {
  id: string;
  kind: "void" | "superseded" | "treatment_corrected";
  reason: string;
  created_at: string;
  replacement_id: string | null;
}
const escape = (value: string | null | undefined) =>
  String(value || "Not recorded").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const field = (label: string, value: string | null | undefined) =>
  `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
/** Events must be freshly fetched with the certificate by an authorized caller before printing.
 * Pass null if status lookup failed: fail closed rather than print an apparently valid copy.
 */
export function renderVaccineCertificate(
  certificate: IssuedCertificate,
  events: readonly CertificateEvent[] | null,
): string {
  if (events === null)
    throw new Error("Refresh certificate status before printing.");
  const s = certificate.snapshot;
  if (
    ![1, 2].includes(s.schema_version) ||
    (s.schema_version === 2 &&
      (s.kind !== "vaccine_history" || !Array.isArray(s.due_plans))) ||
    !["rabies", "vaccine_history"].includes(s.kind) ||
    !s.vaccinations.length
  )
    throw new Error("Unsupported or empty certificate snapshot.");
  const title =
    s.kind === "rabies"
      ? "Rabies Vaccination Certificate"
      : "Vaccine History Certificate";
  const detail = s.details;
  const status = events.length
    ? `<aside role="alert"><strong>INVALIDATED — retained for historical reference</strong>${[
        ...events,
      ]
        .sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        )
        .map(
          (event) =>
            `<p>${escape(event.kind)}: ${escape(event.reason)} · ${escape(event.created_at)}${event.replacement_id ? ` · Replacement ${escape(event.replacement_id)}` : ""}</p>`,
        )
        .join("")}</aside>`
    : "";
  const duePlans =
    s.schema_version === 2
      ? `<section><h2>Patient due plans reviewed at issuance</h2><p>These plan dates were reviewed with this certificate. Later care-plan changes do not update this signed copy. Administration-specific dates remain in the history below. Plans awaiting review certify no next due date.</p>${s.due_plans!.length ? s.due_plans!.map((plan) => `<section><h2>${escape(plan.group_name)}</h2><dl>${field("Vaccine group", plan.group_key)}${field("Plan status", plan.status === "current" ? "Reviewed current plan at issuance" : "Awaiting review — no due date certified")}${field("Last administration anchor", plan.last_administered_on)}${field("Reviewed patient next due date", plan.status === "current" ? plan.reviewed_due_on : "No due date certified")}${field("Plan reference / version", `${plan.plan_id} / ${plan.plan_version}`)}</dl></section>`).join("") : "<p>No nonretired patient due plans are recorded. Administration dates below do not establish a current care schedule.</p>"}</section>`
      : "";
  const doses = s.vaccinations
    .map(
      (v) =>
        `<section><h2>${escape(v.product_name)}</h2><dl>${field("Administered on (America/Denver)", v.administered_on)}${field("Reviewed recorded next due date", v.next_due_on ?? "Not recorded — no due date certified")}${field("Manufacturer", v.manufacturer)}${field("Lot / serial number", v.lot_number)}${field("Lot expiration date", v.lot_expires_on)}${field("Dose", v.dose)}${field("Route", v.route)}${field("Site", v.site)}${field("Administering / supervising veterinarian", v.veterinarian)}${field("Treatment veterinarian license", v.veterinarian_license)}${field("Age at administration", v.age_at_administration)}${field("Record origin", v.historical ? `External history: ${v.source}` : "Practice administration")}${field("Treatment identifier", v.treatment_id)}</dl></section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(title)} — ${escape(s.patient.name)}</title><style>@page{size:letter;margin:0.55in}body{font:11px/1.3 Georgia,serif;color:CanvasText;background:Canvas;max-width:7.4in;margin:24px auto;padding:0 12px}header{border-bottom:2px solid;padding-bottom:6px}h1{font-size:21px;margin:8px 0}h2{font-size:15px;margin:8px 0}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 20px}dl div{break-inside:avoid;overflow-wrap:anywhere}dt{font-weight:bold}dd{margin:0;white-space:pre-wrap}section{margin:12px 0}aside{border:3px double;padding:12px;margin:16px 0}footer{border-top:1px solid;padding-top:6px;break-inside:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0;padding:0}h2{break-after:avoid}}</style></head><body><header><h2>${escape(s.issuer.practice_name)}</h2><p>${escape(s.issuer.practice_address)} · ${escape(s.issuer.practice_phone)}</p><h1>${escape(title)}</h1><p>Certificate ${escape(certificate.id)}</p></header>${status}<section><h2>Patient and owner</h2><dl>${field("Patient", s.patient.name)}${field("Species / breed", `${s.patient.species} / ${s.patient.breed || "Not recorded"}`)}${field("Birth date", s.patient.dob)}${field("Birth-date precision", s.patient.birth_date_precision)}${field("Color / markings", s.patient.color)}${field("Sex / sterilization", `${s.patient.sex} / ${s.patient.neuter_status}`)}${field("Microchip number", s.patient.microchip_id)}${field("Owner", s.owner.name)}${field("Owner address", s.owner.address)}${field("Owner home / primary phone", s.owner.phone)}</dl></section>${s.kind === "rabies" ? `<section><h2>Rabies administration details</h2><dl>${field("Actual vaccine administrator", detail.administrator)}${field("Rabies tag number", detail.rabies_tag_number)}${field("USDA licensed product duration (not the due-date calculation)", detail.usda_duration)}${field("Vaccine type", detail.vaccine_type)}${field("Initial vaccination / booster", detail.initial_or_booster)}${field("Size / weight as reviewed", detail.size_description)}${field("Owner business phone", detail.owner_business_phone || (detail.owner_business_phone_unavailable ? "Unavailable — confirmed at review" : null))}</dl></section>` : "<p>All uncorrected vaccine records in the reviewed snapshot, including external history. Recorded due dates are reproduced for each administration; this history does not determine which date is currently applicable and is not a rabies certificate.</p>"}${duePlans}${doses}<footer><p>${escape(certificate.attestation)}</p><p>Electronically signed by ${escape(certificate.signature_name)}, ${escape(s.issuer.license_state)} license ${escape(s.issuer.license_number)}<br>Issued ${escape(certificate.issued_at)} (ISO 8601 instant)</p>${certificate.replaces_id ? `<p>Reissues certificate ${escape(certificate.replaces_id)}.</p>` : ""}<p>Dates were reviewed by the issuing veterinarian. No automatic due-date rules are applied. Retain this certificate identifier when requesting verification or a corrected copy.</p></footer></body></html>`;
}
