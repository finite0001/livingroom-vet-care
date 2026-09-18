import type { ReleaseSnapshot } from "./record-release-renderer.ts";
export interface ReleaseImportedVaccination {
  id: string;
  pet_id: string;
  animal_link_id: string;
  client_id: string;
  version: number;
  version_hash: string;
  source: {
    origin: string;
    site_uid: string;
    animal_id: string;
    vaccination_id: string;
  };
  snapshot_id: string;
  payload_hash: string;
  observed_head_version: number;
  original: Record<string, unknown>;
  consult: {
    snapshot_id: string;
    payload_hash: string;
    observed_head_version: number;
    external_id: string;
  };
  reviewed: {
    administered_on: string | null;
    administration_date_status: "date" | "unknown" | "uninterpreted";
    source_next_due_on: string | null;
    next_date_status: "date" | "unknown" | "uninterpreted";
    status: "administered" | "not_administered" | "unknown";
    outside_author: string | null;
  };
  product: { id: string; version: number; name: string; kind: string } | null;
  reason: string;
  replaces_id: string | null;
  expected_predecessor_hash: string | null;
  approved_by: string;
  approved_at: string;
  current: {
    is_current: boolean;
    is_latest: boolean;
    snapshot_id: string;
    head_version: number;
    consult_snapshot_id: string;
    consult_head_version: number;
    identity_valid: boolean;
  };
  correction_history: Array<
    {
      id: string;
      version: number;
      version_hash: string;
      replaces_id: string | null;
      reason: string;
      approved_by: string;
      approved_at: string;
    }
  >;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(v);
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const text = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const instant = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function require(valid: unknown): asserts valid {
  if (!valid) throw new Error("Imported vaccination provenance is invalid.");
}
function date(value: string | null, status: string) {
  require(["date", "unknown", "uninterpreted"].includes(status));
  require(
    status === "date"
      ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value
      : value === null,
  );
}
export function validateImportedVaccinations(s: ReleaseSnapshot): void {
  if (s.schema_version !== 7 && s.schema_version !== 8 && s.schema_version !== 9 && s.schema_version !== 10 && s.schema_version !== 11 && s.schema_version !== 12) return;
  require(
    Array.isArray(s.imported_vaccinations) &&
      s.imported_vaccinations.length <= 20,
  );
  require(s.selection && Array.isArray(s.selection.imported_vaccination_ids));
  const ids = new Set<string>(), identities = new Set<string>();
  for (const v of s.imported_vaccinations) {
    require(
      object(v) && uuid(v.id) && !ids.has(v.id) && v.pet_id === s.patient.id &&
        v.client_id === s.recipient.client_id && uuid(v.animal_link_id) &&
        positive(v.version) && hash(v.version_hash),
    );
    ids.add(v.id);
    require(
      object(v.source) &&
        ["https://api.ezyvet.com", "https://api.trial.ezyvet.com"].includes(
          v.source.origin,
        ) && text(v.source.site_uid) && text(v.source.animal_id) &&
        text(v.source.vaccination_id),
    );
    const identity = JSON.stringify([
      v.source.origin,
      v.source.site_uid,
      v.animal_link_id,
      v.source.vaccination_id,
    ]);
    require(!identities.has(identity));
    identities.add(identity);
    require(
      uuid(v.snapshot_id) && hash(v.payload_hash) &&
        positive(v.observed_head_version) && object(v.original),
    );
    require(
      String(v.original.id) === v.source.vaccination_id && object(v.consult) &&
        uuid(v.consult.snapshot_id) && hash(v.consult.payload_hash) &&
        positive(v.consult.observed_head_version) &&
        text(v.consult.external_id) &&
        String(v.original.consult_id) === v.consult.external_id,
    );
    require(
      object(v.reviewed) &&
        ["administered", "not_administered", "unknown"].includes(
          v.reviewed.status,
        ) &&
        (v.reviewed.outside_author === null ||
          text(v.reviewed.outside_author, 500)),
    );
    date(v.reviewed.administered_on, v.reviewed.administration_date_status);
    date(v.reviewed.source_next_due_on, v.reviewed.next_date_status);
    require(
      v.product === null ||
        object(v.product) && uuid(v.product.id) &&
          positive(v.product.version) && text(v.product.name) &&
          v.product.kind === "vaccine",
    );
    require(text(v.reason) && uuid(v.approved_by) && instant(v.approved_at));
    require(
      v.replaces_id === null
        ? v.expected_predecessor_hash === null && v.version === 1
        : uuid(v.replaces_id) && hash(v.expected_predecessor_hash) &&
          v.version > 1,
    );
    require(
      object(v.current) &&
        ["is_current", "is_latest", "identity_valid"].every((k) =>
          typeof v.current[k as keyof typeof v.current] === "boolean"
        ) && uuid(v.current.snapshot_id) && positive(v.current.head_version) &&
        uuid(v.current.consult_snapshot_id) &&
        positive(v.current.consult_head_version),
    );
    require(
      !v.current.is_current ||
        v.current.identity_valid && v.current.snapshot_id === v.snapshot_id &&
          v.current.head_version === v.observed_head_version &&
          v.current.consult_snapshot_id === v.consult.snapshot_id &&
          v.current.consult_head_version === v.consult.observed_head_version,
    );
    require(Array.isArray(v.correction_history));
    const refs = new Set<string>();
    for (const r of v.correction_history) {
      require(
        object(r) && Object.keys(r).every((k) =>
          [
            "id",
            "version",
            "version_hash",
            "replaces_id",
            "reason",
            "approved_by",
            "approved_at",
          ].includes(k)
        ) && uuid(r.id) && !refs.has(r.id) && positive(r.version) &&
          hash(r.version_hash) &&
          (r.replaces_id === null || uuid(r.replaces_id)) && text(r.reason) &&
          uuid(r.approved_by) && instant(r.approved_at),
      );
      require(
        r.version === refs.size + 1 &&
          (r.version === 1
            ? r.replaces_id === null
            : r.replaces_id === v.correction_history[r.version - 2].id),
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
        ].every((k) =>
          selected[k as keyof typeof selected] === v[k as keyof typeof v]
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
    s.selection.imported_vaccination_ids.length === ids.size &&
      new Set(s.selection.imported_vaccination_ids).size === ids.size &&
      s.selection.imported_vaccination_ids.every((id) => ids.has(id)),
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
export function renderImportedVaccinations(s: ReleaseSnapshot): string {
  if (s.schema_version !== 7 && s.schema_version !== 8 && s.schema_version !== 9 && s.schema_version !== 10 && s.schema_version !== 11 && s.schema_version !== 12) return "";
  validateImportedVaccinations(s);
  return s.imported_vaccinations!.map((v) =>
    `<article><h2>Clinician-reviewed outside vaccination history</h2><p>ezyVet vaccination ${
      escape(v.source.vaccination_id)
    } · Source site ${escape(v.source.site_uid)} · Animal ${
      escape(v.source.animal_id)
    } · Reviewed version ${v.version}</p><p>Reviewed by DVM record ${
      escape(v.approved_by)
    } · ${escape(v.approved_at)}</p><dl>${
      field("Reviewed administration date", v.reviewed.administered_on)
    }${
      field(
        "Administration date interpretation",
        v.reviewed.administration_date_status,
      )
    }${field("Reviewed outside next-date", v.reviewed.source_next_due_on)}${
      field("Next-date interpretation", v.reviewed.next_date_status)
    }${field("Reviewed status", v.reviewed.status)}${
      field("Outside clinician attribution", v.reviewed.outside_author)
    }${field("Review rationale", v.reason)}${
      field(
        "Optional local catalog match",
        v.product
          ? `${v.product.name} · ${v.product.kind} · version ${v.product.version}`
          : null,
      )
    }</dl><p>These are outside historical observations. They do not establish local administration, an active due plan, vaccine certificate eligibility, historical manufacturer, lot, dose or route.</p><h3>Original source values</h3><dl>${
      Object.keys(v.original).sort().map((k) => field(k, v.original[k])).join(
        "",
      )
    }</dl><h3>Source provenance appendix</h3><dl>${
      field("Vaccination snapshot", v.snapshot_id)
    }${field("Vaccination payload fingerprint", v.payload_hash)}${
      field("Vaccination observation revision", v.observed_head_version)
    }${field("Consult reference", v.consult.external_id)}${
      field("Consult snapshot", v.consult.snapshot_id)
    }${field("Consult payload fingerprint", v.consult.payload_hash)}${
      field("Consult observation revision", v.consult.observed_head_version)
    }${field("Reviewed version fingerprint", v.version_hash)}</dl><p>${
      v.current.is_current
        ? "The reviewed source observations remain current."
        : "The source context differs from this preserved review."
    } ${
      v.current.is_latest
        ? "This is the latest reviewed version."
        : "A later review supersedes this historical version."
    }</p>${
      v.correction_history.length
        ? `<h3>Review revision references</h3>${
          v.correction_history.map((r) =>
            `<p>Version ${r.version} · ${escape(r.id)} · Fingerprint ${
              escape(r.version_hash)
            } · Replaces ${literal(r.replaces_id)} · DVM ${
              escape(r.approved_by)
            } · ${escape(r.approved_at)} · ${escape(r.reason)}</p>`
          ).join("")
        }`
        : ""
    }</article>`
  ).join("");
}
