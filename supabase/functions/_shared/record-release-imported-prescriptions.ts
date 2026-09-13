import type { ReleaseSnapshot } from "./record-release-renderer.ts";
import {
  reconcilePrescriptionItems,
  type PrescriptionItemReconciliation,
} from "./prescription-reconciliation.ts";
export interface PrescriptionObservation {
  snapshot_id: string;
  payload_hash: string;
  observed_head_version: number;
  external_id: string;
  original: Record<string, unknown>;
  page?: number;
}
export interface PrescriptionItemEvidence {
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
    reconciliation: PrescriptionItemReconciliation;
    selected_items: PrescriptionItemEvidence[];
    omitted_items: PrescriptionObservation[];
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
  items: PrescriptionItemEvidence[];
  current: { is_latest: boolean; identity_valid: boolean; is_current: boolean };
  correction_history: PrescriptionRevision[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const text = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const nullableText = (v: unknown, max = 2000) => v === null || text(v, max);
const instant = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function require(valid: unknown): asserts valid {
  if (!valid) throw new Error("Imported prescription provenance is invalid.");
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return (
    object(a) &&
    object(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]),
    )
  );
}
function date(value: string | null, status: string) {
  require(["date", "unknown", "uninterpreted"].includes(status));
  require(
    status === "date"
      ? typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number(value.slice(0, 4)) > 0 &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value
      : value === null,
  );
}
function observation(v: PrescriptionObservation, item = false) {
  require(
    object(v) &&
      uuid(v.snapshot_id) &&
      hash(v.payload_hash) &&
      positive(v.observed_head_version) &&
      text(v.external_id) &&
      object(v.original) &&
      String(v.original.id) === v.external_id &&
      (!item || positive(v.page)),
  );
}
export function validateImportedPrescriptions(s: ReleaseSnapshot): void {
  if (s.schema_version !== 8) return;
  require(
    Array.isArray(s.imported_prescriptions) &&
      s.imported_prescriptions.length <= 20 &&
      s.selection &&
      Array.isArray(s.selection.imported_prescription_ids),
  );
  const ids = new Set<string>(),
    identities = new Set<string>();
  for (const v of s.imported_prescriptions) {
    require(
      object(v) &&
        uuid(v.id) &&
        !ids.has(v.id) &&
        v.pet_id === s.patient.id &&
        v.client_id === s.recipient.client_id &&
        uuid(v.animal_link_id) &&
        positive(v.version) &&
        hash(v.version_hash),
    );
    ids.add(v.id);
    const c = v.context;
    require(
      object(c) &&
        object(c.source) &&
        c.patient_id === v.pet_id &&
        c.client_id === v.client_id &&
        c.animal_link_id === v.animal_link_id &&
        positive(c.patient_version) &&
        c.source.origin === v.source_origin &&
        c.source.site_uid === v.source_site_uid &&
        ["https://api.ezyvet.com", "https://api.trial.ezyvet.com"].includes(
          v.source_origin,
        ) &&
        text(v.source_site_uid) &&
        text(c.source.animal_id),
    );
    observation(c.parent);
    require(
      c.parent.external_id === v.prescription_external_id &&
        String(c.parent.original.animal_id) === c.source.animal_id,
    );
    const identity = JSON.stringify([
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
    if (c.consult.status === "resolved")
      require(
        uuid(c.consult.snapshot_id) &&
          hash(c.consult.payload_hash) &&
          positive(c.consult.observed_head_version) &&
          c.consult.reference != null &&
          String(c.parent.original.consult_id) === String(c.consult.reference),
      );
    else
      require(
        (c.consult.reference == null || c.consult.reference === "") &&
          (c.parent.original.consult_id == null ||
            c.parent.original.consult_id === "") &&
          (c.consult.reference ?? null) ===
            (c.parent.original.consult_id ?? null) &&
          ["snapshot_id", "payload_hash", "observed_head_version"].every(
            (k) => !Object.prototype.hasOwnProperty.call(c.consult, k),
          ),
      );
    require(
      object(c.item_run) &&
        uuid(c.item_run.id) &&
        text(c.item_run.status) &&
        positive(c.item_run.next_page),
    );
    require(
      Array.isArray(c.items) &&
        Array.isArray(c.omitted_items) &&
        Array.isArray(v.items) &&
        v.items.length <= 200 &&
        equal(v.items, c.selected_items),
    );
    const observed = new Map<string, PrescriptionObservation>();
    for (const item of c.items) {
      observation(item, true);
      require(
        String(item.original.prescription_id) === v.prescription_external_id,
      );
      observed.set(item.snapshot_id, item);
    }
    const accounted = new Set<string>();
    for (const item of v.items) {
      require(object(item));
      observation(item.source, true);
      require(
        !accounted.has(item.source.snapshot_id) &&
          c.items.some((source) => equal(source, item.source)),
      );
      accounted.add(item.source.snapshot_id);
      require(object(item.reviewed) && nullableText(item.reviewed.note));
      date(item.reviewed.start_on, item.reviewed.start_date_status);
      require(
        item.product === null ||
          (object(item.product) &&
            uuid(item.product.id) &&
            positive(item.product.version) &&
            text(item.product.name) &&
            item.product.kind === "medication" &&
            typeof item.product.unit === "string"),
      );
    }
    for (const item of c.omitted_items) {
      observation(item, true);
      require(
        !v.items.some(
          (selected) => selected.source.snapshot_id === item.snapshot_id,
        ) && c.items.some((source) => equal(source, item)),
      );
      accounted.add(item.snapshot_id);
    }
    require(accounted.size === observed.size);
    const r = c.reconciliation;
    require(
      object(r) &&
        ["matched", "unresolved"].includes(r.status) &&
        typeof r.sourceListPresent === "boolean" &&
        typeof r.scanComplete === "boolean",
    );
    for (const k of [
      "expectedIds",
      "observedIds",
      "missingIds",
      "unexpectedIds",
      "duplicateSourceIds",
      "duplicateObservedIds",
    ] as const)
      require(Array.isArray(r[k]) && r[k].every((x) => typeof x === "string"));
    for (const k of [
      "invalidSourceReferences",
      "invalidObservedReferences",
    ] as const)
      require(
        Array.isArray(r[k]) &&
          r[k].every(
            (x) =>
              object(x) &&
              Number.isSafeInteger(x.index) &&
              Object.prototype.hasOwnProperty.call(x, "value"),
          ),
      );
    require(
      equal(
        r,
        reconcilePrescriptionItems(
          c.parent.original.prescription_item_list ?? null,
          c.items.map((item) => item.external_id),
          c.item_run.status === "review_ready",
        ),
      ),
    );
    const matched =
      r.sourceListPresent &&
      r.scanComplete &&
      [
        r.missingIds,
        r.unexpectedIds,
        r.duplicateSourceIds,
        r.duplicateObservedIds,
        r.invalidSourceReferences,
        r.invalidObservedReferences,
      ].every((x) => x.length === 0);
    require((r.status === "matched") === matched);
    const reviewed = c.reviewed;
    require(
      object(reviewed) &&
        ["active", "inactive", "unknown"].includes(reviewed.status) &&
        nullableText(reviewed.outside_author, 500) &&
        text(v.reason) &&
        reviewed.reason === v.reason &&
        ["complete", "partial"].includes(reviewed.completeness),
    );
    date(reviewed.prescribed_on, reviewed.prescription_date_status);
    require(
      reviewed.completeness === "complete"
        ? matched &&
            c.omitted_items.length === 0 &&
            reviewed.partial_reason === null
        : text(reviewed.partial_reason) &&
            reviewed.partial_reason!.trim().length >= 5,
    );
    require(
      uuid(v.approved_by) &&
        instant(v.approved_at) &&
        object(v.current) &&
        ["is_latest", "identity_valid", "is_current"].every(
          (k) => typeof v.current[k as keyof typeof v.current] === "boolean",
        ) &&
        (!v.current.is_current || v.current.identity_valid),
    );
    require(
      v.replaces_id === null
        ? v.expected_predecessor_hash === null && v.version === 1
        : uuid(v.replaces_id) &&
            hash(v.expected_predecessor_hash) &&
            v.version > 1,
    );
    require(Array.isArray(v.correction_history));
    const refs = new Set<string>();
    for (const r of v.correction_history) {
      require(
        object(r) &&
          Object.keys(r).every((k) =>
            [
              "id",
              "version",
              "version_hash",
              "replaces_id",
              "reason",
              "approved_by",
              "approved_at",
            ].includes(k),
          ) &&
          uuid(r.id) &&
          !refs.has(r.id) &&
          r.version === refs.size + 1 &&
          hash(r.version_hash) &&
          text(r.reason) &&
          uuid(r.approved_by) &&
          instant(r.approved_at),
      );
      require(
        r.replaces_id ===
          (r.version === 1 ? null : v.correction_history[r.version - 2].id),
      );
      refs.add(r.id);
    }
    const selected = v.correction_history[v.version - 1];
    require(
      selected &&
        [
          "id",
          "version",
          "version_hash",
          "replaces_id",
          "reason",
          "approved_by",
          "approved_at",
        ].every(
          (k) =>
            selected[k as keyof PrescriptionRevision] ===
            v[k as keyof PrescriptionRevision],
        ),
    );
    require(
      v.replaces_id === null ||
        v.correction_history[v.version - 2].version_hash ===
          v.expected_predecessor_hash,
    );
    require(
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
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const literal = (v: unknown) =>
  v == null
    ? "Not recorded"
    : escape(typeof v === "string" ? v : JSON.stringify(v));
const field = (label: string, v: unknown) =>
  `<div><dt>${escape(label)}</dt><dd>${literal(v)}</dd></div>`;
const originals = (v: Record<string, unknown>) =>
  `<dl>${Object.keys(v)
    .sort()
    .map((k) => field(k, v[k]))
    .join("")}</dl>`;
const provenance = (v: PrescriptionObservation) =>
  `<dl>${field("Source reference", v.external_id)}${field("Snapshot", v.snapshot_id)}${field("Payload fingerprint", v.payload_hash)}${field("Observation revision", v.observed_head_version)}</dl>`;
export function renderImportedPrescriptions(s: ReleaseSnapshot): string {
  if (s.schema_version !== 8) return "";
  validateImportedPrescriptions(s);
  return s
    .imported_prescriptions!.map((v) => {
      const c = v.context,
        r = c.reviewed;
      return `<article><h2>Clinician-reviewed outside prescription history</h2><p>ezyVet prescription ${escape(v.prescription_external_id)} · Source site ${escape(v.source_site_uid)} · Animal ${escape(c.source.animal_id)} · Reviewed version ${v.version}</p><p>Reviewed by DVM record ${escape(v.approved_by)} · ${escape(v.approved_at)}</p><dl>${field("Reviewed prescription date", r.prescribed_on)}${field("Prescription date interpretation", r.prescription_date_status)}${field("Reviewed historical status", r.status)}${field("Outside prescriber attribution", r.outside_author)}${field("Review rationale", r.reason)}${field("Historical completeness", r.completeness)}${field("Partial history disclosure", r.partial_reason)}</dl><p>This is outside historical evidence. It does not authorize local prescribing, dispensing, dosing, refills, stock changes or billing. Source quantities and instructions below are preserved as text.</p><h3>Original prescription source values</h3>${originals(c.parent.original)}${v.items.map((item, i) => `<section><h3>Reviewed outside item ${i + 1}</h3><h4>Original item source values</h4>${originals(item.source.original)}<dl>${field("Reviewed start date", item.reviewed.start_on)}${field("Start date interpretation", item.reviewed.start_date_status)}${field("Separate interpretation note", item.reviewed.note)}${field("Optional local catalog match", item.product ? `${item.product.name} · ${item.product.kind} · catalog unit ${item.product.unit} · version ${item.product.version}` : null)}</dl><p>The catalog match does not establish the historical quantity unit or dose.</p>${provenance(item.source)}</section>`).join("")}<h3>Item reconciliation and omitted observations</h3>${originals(c.reconciliation as unknown as Record<string, unknown>)}<p>${c.omitted_items.length} observed item(s) were not selected for clinical interpretation. These source observations are retained below as unreviewed context.</p>${c.omitted_items.map((item) => `<section><h4>Observed item not selected for interpretation</h4>${originals(item.original)}${provenance(item)}</section>`).join("")}<h3>Source provenance appendix</h3>${provenance(c.parent)}${originals(c.consult)}<dl>${field("Reviewed version fingerprint", v.version_hash)}${field("Source item run", c.item_run.id)}</dl><p>${v.current.is_current ? "The reviewed source observations remain current." : "The source context differs from this preserved review."} ${v.current.is_latest ? "This is the latest reviewed version." : "A later review supersedes this historical version."}</p><h3>Review revision references</h3>${v.correction_history.map((r) => `<p>Version ${r.version} · ${escape(r.id)} · Fingerprint ${escape(r.version_hash)} · Replaces ${literal(r.replaces_id)} · DVM ${escape(r.approved_by)} · ${escape(r.approved_at)} · ${escape(r.reason)}</p>`).join("")}</article>`;
    })
    .join("");
}
