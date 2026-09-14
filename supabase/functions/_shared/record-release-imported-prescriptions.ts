import type { ReleaseSnapshot } from "./record-release-renderer.ts";

export interface PrescriptionObservation {
  snapshot_id: string;
  payload_hash: string;
  observed_head_version: number;
  external_id: string;
  original: Record<string, unknown>;
  page?: number;
}
export interface PrescriptionItem {
  source: PrescriptionObservation;
  reviewed: {
    start_on: string | null;
    start_date_status: string;
    note: string | null;
  };
  product: {
    id: string;
    version: number;
    name: string;
    kind: string;
    unit: string;
  } | null;
}
export interface PrescriptionRevision {
  id: string;
  version: number;
  version_hash: string;
  replaces_id: string | null;
  reason: string;
  approved_by: string;
  approved_at: string;
}
export interface ReleaseImportedPrescription extends PrescriptionRevision {
  pet_id: string;
  client_id: string;
  animal_link_id: string;
  source_origin: string;
  source_site_uid: string;
  prescription_external_id: string;
  expected_predecessor_hash: string | null;
  context: {
    patient_id: string;
    client_id: string;
    animal_link_id: string;
    patient_version: number;
    source: { origin: string; site_uid: string; animal_id: string };
    parent: PrescriptionObservation;
    consult: {
      status: string;
      reference?: unknown;
      snapshot_id?: string;
      payload_hash?: string;
      observed_head_version?: number;
    };
    item_run: { id: string; status: string; next_page: number };
    items: PrescriptionObservation[];
    selected_items: PrescriptionItem[];
    omitted_items: PrescriptionObservation[];
    reconciliation: Record<string, unknown>;
    reviewed: {
      prescribed_on: string | null;
      prescription_date_status: string;
      status: string;
      outside_author: string | null;
      reason: string;
      completeness: string;
      partial_reason: string | null;
    };
  };
  items: PrescriptionItem[];
  current: { is_latest: boolean; is_current: boolean; identity_valid: boolean };
  correction_history: PrescriptionRevision[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(v);
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || typeof v === "string";
function require(valid: unknown): asserts valid {
  if (!valid) throw new Error("Imported prescription provenance is invalid.");
}
const canonical = (v: unknown): string =>
  JSON.stringify(
    v,
    (_key, value) =>
      object(value)
        ? Object.fromEntries(
          Object.keys(value).sort().map((key) => [key, value[key]]),
        )
        : value,
  );
function date(value: string | null, status: string) {
  require(["date", "unknown", "uninterpreted"].includes(status));
  require(
    status === "date"
      ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number(value.slice(0, 4)) > 0 && Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value
      : value === null,
  );
}
function observation(v: PrescriptionObservation, parent: boolean) {
  require(
    object(v) && uuid(v.snapshot_id) && hash(v.payload_hash) &&
      positive(v.observed_head_version) &&
      text(v.external_id) && object(v.original) &&
      String(v.original.id) === v.external_id &&
      (parent || positive(v.page)),
  );
}
export function validateImportedPrescriptions(s: ReleaseSnapshot): void {
  if (s.schema_version !== 8 && s.schema_version !== 9) return;
  require(
    Array.isArray(s.imported_prescriptions) &&
      s.imported_prescriptions.length <= 20 &&
      s.selection && Array.isArray(s.selection.imported_prescription_ids),
  );
  const ids = new Set<string>(), identities = new Set<string>();
  for (const v of s.imported_prescriptions) {
    require(
      object(v) && uuid(v.id) && !ids.has(v.id) && v.pet_id === s.patient.id &&
        v.client_id === s.recipient.client_id && uuid(v.animal_link_id) &&
        positive(v.version) && hash(v.version_hash) && text(v.reason) &&
        uuid(v.approved_by) &&
        typeof v.approved_at === "string" &&
        Number.isFinite(Date.parse(v.approved_at)),
    );
    ids.add(v.id);
    const c = v.context;
    require(
      object(c) && object(c.source) && c.patient_id === v.pet_id &&
        c.client_id === v.client_id &&
        c.animal_link_id === v.animal_link_id && positive(c.patient_version) &&
        c.source.origin === v.source_origin &&
        c.source.site_uid === v.source_site_uid &&
        ["https://api.ezyvet.com", "https://api.trial.ezyvet.com"].includes(
          v.source_origin,
        ) &&
        text(v.source_site_uid) && text(c.source.animal_id),
    );
    observation(c.parent, true);
    require(
      c.parent.external_id === v.prescription_external_id &&
        String(c.parent.original.animal_id) === c.source.animal_id,
    );
    const identity = canonical([
      v.source_origin,
      v.source_site_uid,
      v.animal_link_id,
      v.prescription_external_id,
    ]);
    require(!identities.has(identity));
    identities.add(identity);
    require(
      object(c.consult) &&
        ["resolved", "not_supplied"].includes(c.consult.status),
    );
    if (c.consult.status === "resolved") {
      require(
        uuid(c.consult.snapshot_id) && hash(c.consult.payload_hash) &&
          positive(c.consult.observed_head_version) &&
          text(c.consult.reference) &&
          String(c.parent.original.consult_id) === c.consult.reference,
      );
    } else {require(
        c.parent.original.consult_id === null ||
          c.parent.original.consult_id === undefined ||
          c.parent.original.consult_id === "",
      );}
    require(
      object(c.item_run) && uuid(c.item_run.id) && text(c.item_run.status) &&
        positive(c.item_run.next_page),
    );
    require(
      Array.isArray(c.items) && Array.isArray(c.omitted_items) &&
        Array.isArray(c.selected_items) &&
        Array.isArray(v.items) && v.items.length <= 200 &&
        canonical(v.items) === canonical(c.selected_items),
    );
    for (const item of c.items) {
      observation(item, false);
      require(
        String(item.original.prescription_id) === v.prescription_external_id,
      );
    }
    const selected = new Set<string>();
    for (const item of v.items) {
      require(object(item));
      observation(item.source, false);
      require(
        !selected.has(item.source.snapshot_id) &&
          c.items.some((source) =>
            canonical(source) === canonical(item.source)
          ),
      );
      selected.add(item.source.snapshot_id);
      require(object(item.reviewed) && nullableText(item.reviewed.note));
      date(item.reviewed.start_on, item.reviewed.start_date_status);
      require(
        item.product === null ||
          object(item.product) && uuid(item.product.id) &&
            positive(item.product.version) &&
            text(item.product.name) && item.product.kind === "medication" &&
            typeof item.product.unit === "string",
      );
    }
    require(
      c.omitted_items.every((item) =>
        !selected.has(item.snapshot_id) &&
        c.items.some((source) => canonical(source) === canonical(item))
      ) &&
        c.items.every((item) =>
          selected.has(item.snapshot_id) ||
          c.omitted_items.some((omitted) =>
            canonical(omitted) === canonical(item)
          )
        ),
    );
    const r = c.reviewed, account = c.reconciliation;
    require(
      object(r) && r.reason === v.reason && nullableText(r.outside_author) &&
        ["active", "inactive", "unknown"].includes(r.status) &&
        ["complete", "partial"].includes(r.completeness),
    );
    date(r.prescribed_on, r.prescription_date_status);
    require(
      object(account) &&
        ["matched", "unresolved"].includes(String(account.status)) &&
        typeof account.sourceListPresent === "boolean" &&
        typeof account.scanComplete === "boolean",
    );
    for (
      const key of [
        "expectedIds",
        "observedIds",
        "missingIds",
        "unexpectedIds",
        "duplicateSourceIds",
        "duplicateObservedIds",
      ]
    ) {
      require(
        Array.isArray(account[key]) &&
          (account[key] as unknown[]).every((id) => typeof id === "string"),
      );
    }
    for (
      const key of ["invalidSourceReferences", "invalidObservedReferences"]
    ) {
      require(
        Array.isArray(account[key]) &&
          (account[key] as unknown[]).every((ref) =>
            object(ref) && Number.isInteger(ref.index) && "value" in ref
          ),
      );
    }
    if (r.completeness === "complete") {
      require(
        account.status === "matched" && account.sourceListPresent &&
          account.scanComplete &&
          c.omitted_items.length === 0 && r.partial_reason === null &&
          [
            "missingIds",
            "unexpectedIds",
            "duplicateSourceIds",
            "duplicateObservedIds",
            "invalidSourceReferences",
            "invalidObservedReferences",
          ].every((key) => (account[key] as unknown[]).length === 0),
      );
    } else {require(
        typeof r.partial_reason === "string" &&
          r.partial_reason.trim().length >= 5,
      );}
    require(
      object(v.current) &&
        [v.current.is_current, v.current.is_latest, v.current.identity_valid]
          .every((flag) => typeof flag === "boolean") &&
        (!v.current.is_current || v.current.identity_valid),
    );
    require(
      Array.isArray(v.correction_history) &&
        v.correction_history.length >= v.version,
    );
    const revisions = new Set<string>();
    for (const [index, h] of v.correction_history.entries()) {
      require(
        object(h) && uuid(h.id) && !revisions.has(h.id) &&
          h.version === index + 1 && hash(h.version_hash) &&
          text(h.reason) && uuid(h.approved_by) &&
          typeof h.approved_at === "string" &&
          Number.isFinite(Date.parse(h.approved_at)) &&
          h.replaces_id === (index ? v.correction_history[index - 1].id : null),
      );
      revisions.add(h.id);
    }
    const revision = v.correction_history[v.version - 1];
    require(
      [
        "id",
        "version",
        "version_hash",
        "replaces_id",
        "reason",
        "approved_by",
        "approved_at",
      ]
        .every((key) =>
          revision[key as keyof PrescriptionRevision] ===
            v[key as keyof PrescriptionRevision]
        ),
    );
    require(
      v.expected_predecessor_hash ===
          (v.version === 1
            ? null
            : v.correction_history[v.version - 2].version_hash) &&
        v.current.is_latest === (v.version === v.correction_history.length),
    );
  }
  require(
    s.selection.imported_prescription_ids.length === ids.size &&
      new Set(s.selection.imported_prescription_ids).size === ids.size &&
      s.selection.imported_prescription_ids.every((id) => ids.has(id)),
  );
}
const escape = (v: unknown) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const literal = (v: unknown) =>
  v === null || v === undefined
    ? "Not recorded"
    : escape(typeof v === "string" ? v : JSON.stringify(v));
const field = (label: string, v: unknown) =>
  `<div><dt>${escape(label)}</dt><dd>${literal(v)}</dd></div>`;
const original = (v: PrescriptionObservation) =>
  `<h4>Original source values</h4><dl>${
    Object.keys(v.original).sort().map((key) => field(key, v.original[key]))
      .join("")
  }</dl><dl>${field("Source reference", v.external_id)}${
    field("Snapshot", v.snapshot_id)
  }${field("Payload fingerprint", v.payload_hash)}${
    field("Observation revision", v.observed_head_version)
  }</dl>`;
export function renderImportedPrescriptions(s: ReleaseSnapshot): string {
  if (s.schema_version !== 8 && s.schema_version !== 9) return "";
  validateImportedPrescriptions(s);
  return s.imported_prescriptions!.map((v) => {
    const c = v.context, r = c.reviewed;
    return `<article><h2>Clinician-reviewed outside prescription history</h2><p>ezyVet prescription ${
      escape(v.prescription_external_id)
    } · Source site ${escape(v.source_site_uid)} · Animal ${
      escape(c.source.animal_id)
    } · Reviewed version ${v.version}</p><p>Reviewed by DVM record ${
      escape(v.approved_by)
    } · ${escape(v.approved_at)}</p>
      ${
      r.completeness === "partial"
        ? `<aside><strong>Partial historical account</strong><p>${
          literal(r.partial_reason)
        }</p></aside>`
        : "<p>Complete account of the reconciled source item list.</p>"
    }
      <dl>${field("Reviewed prescription date", r.prescribed_on)}${
      field("Prescription date interpretation", r.prescription_date_status)
    }${field("Reviewed status", r.status)}${
      field("Outside clinician attribution", r.outside_author)
    }${field("Review rationale", v.reason)}</dl>
      <p>These are outside historical observations. They do not authorize local prescribing, refills or dispensing. Source quantities and remaining amounts retain their original meaning and units.</p>
      <h3>Original prescription header</h3>${original(c.parent)}
      <h3>Reviewed prescription items</h3>${
      v.items.map((item) =>
        `<section><dl>${field("Reviewed start date", item.reviewed.start_on)}${
          field("Start date interpretation", item.reviewed.start_date_status)
        }${field("Review note", item.reviewed.note)}${
          field(
            "Optional local catalog match",
            item.product
              ? `${item.product.name} · version ${item.product.version} · catalog unit ${item.product.unit}`
              : null,
          )
        }</dl>${original(item.source)}</section>`
      ).join("")
    }
      ${
      c.omitted_items.length
        ? `<h3>Observed items omitted from clinical interpretation</h3>${
          c.omitted_items.map((item) => `<section>${original(item)}</section>`)
            .join("")
        }`
        : ""
    }
      <h3>Item reconciliation</h3><dl>${
      Object.keys(c.reconciliation).sort().map((key) =>
        field(key, c.reconciliation[key])
      ).join("")
    }</dl>
      <h3>Source provenance appendix</h3><dl>${
      field("Source origin", v.source_origin)
    }${field("Patient mapping", v.animal_link_id)}${
      field("Consultation evidence", c.consult)
    }${field("Item scan at approval", c.item_run)}${
      field("Reviewed version fingerprint", v.version_hash)
    }</dl>
      <p>${
      v.current.is_current
        ? "The reviewed source observations remain current."
        : "The source context differs from this preserved review."
    } ${
      v.current.is_latest
        ? "This is the latest reviewed version."
        : "A later review supersedes this historical version."
    }</p>
      <h3>Review revision references</h3>${
      v.correction_history.map((h) =>
        `<p>Version ${h.version} · ${escape(h.id)} · Fingerprint ${
          escape(h.version_hash)
        } · Replaces ${literal(h.replaces_id)} · DVM ${
          escape(h.approved_by)
        } · ${escape(h.approved_at)} · ${escape(h.reason)}</p>`
      ).join("")
    }</article>`;
  }).join("");
}
