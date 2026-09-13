import type { ReleaseSnapshot } from "./record-release-renderer.ts";
export interface ImportedHistorySource {
  origin: string;
  site_uid: string;
  animal_id: string;
  history_id: string;
}
export interface ImportedHistoryReference {
  id: string;
  version: number;
  version_hash: string;
  source: ImportedHistorySource;
  snapshot_id: string;
  payload_hash: string;
  observed_head_version: number;
  approved_by: string;
  approved_at: string;
}
export interface ReleaseImportedHistory extends ImportedHistoryReference {
  pet_id: string;
  animal_link_id: string;
  original: {
    comments: unknown;
    history_system: unknown;
    chain: unknown;
    timestamp: unknown;
    vet_id: unknown;
    active: unknown;
    consult_id: unknown;
  };
  consult: {
    status: "not_referenced" | "unresolved" | "verified";
    snapshot_id?: string;
    payload_hash?: string;
    observed_head_version?: number;
    external_id?: string;
  };
  current: {
    snapshot_id: string;
    head_version: number;
    scoped: boolean;
    is_current: boolean;
    source_active: unknown;
  };
}
export interface ReleaseProblemExtraction {
  id: string;
  problem_id: string;
  action: "create" | "link";
  problem_version: number;
  problem_fields: {
    title: string;
    notes: string;
    onset_date: string | null;
    status: string;
    importance: string;
  };
  extracted_by: string;
  extracted_at: string;
  sources: Array<ImportedHistoryReference & { narrative_included: boolean }>;
  current_problem_version: number;
  locally_edited: boolean;
  discrepancy: {
    required: boolean;
    reviewed: boolean;
    changed_from_original: boolean;
    review_history: Array<
      {
        id: string;
        reviewed_by: string;
        reviewed_at: string;
        sources: Array<
          ImportedHistoryReference & { narrative_included: boolean }
        >;
        source_heads: Array<
          { history_id: string; snapshot_id: string; head_version: number }
        >;
      }
    >;
  };
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(v);
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const text = (v: unknown) => typeof v === "string" && v.length > 0;
const instant = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function require(valid: unknown): asserts valid {
  if (!valid) throw new Error("Imported history provenance is invalid.");
}
function reference(r: ImportedHistoryReference) {
  require(
    object(r) && uuid(r.id) && positive(r.version) && hash(r.version_hash) &&
      uuid(r.snapshot_id) && hash(r.payload_hash) &&
      positive(r.observed_head_version) && uuid(r.approved_by) &&
      instant(r.approved_at),
  );
  require(
    object(r.source) &&
      ["https://api.ezyvet.com", "https://api.trial.ezyvet.com"].includes(
        r.source.origin,
      ) && text(r.source.site_uid) && text(r.source.animal_id) &&
      text(r.source.history_id),
  );
}
export function validateImportedHistory(s: ReleaseSnapshot): void {
  if (s.schema_version !== 6) return;
  require(
    Array.isArray(s.imported_histories) &&
      Array.isArray(s.problem_source_extractions),
  );
  const histories = new Map<string, ReleaseImportedHistory>();
  for (const h of s.imported_histories) {
    reference(h);
    require(
      !histories.has(h.id) && h.pet_id === s.patient.id &&
        uuid(h.animal_link_id),
    );
    histories.set(h.id, h);
    require(
      object(h.original) &&
        [
          "comments",
          "history_system",
          "chain",
          "timestamp",
          "vet_id",
          "active",
          "consult_id",
        ].every((k) => Object.hasOwn(h.original, k)),
    );
    require(
      object(h.consult) &&
        ["not_referenced", "unresolved", "verified"].includes(h.consult.status),
    );
    if (h.consult.status === "verified") {
      require(
        uuid(h.consult.snapshot_id) && hash(h.consult.payload_hash) &&
          positive(h.consult.observed_head_version) &&
          text(h.consult.external_id),
      );
    } else {require(
        ["snapshot_id", "payload_hash", "observed_head_version", "external_id"]
          .every((k) => !Object.hasOwn(h.consult, k)),
      );}
    require(
      object(h.current) && uuid(h.current.snapshot_id) &&
        positive(h.current.head_version) &&
        typeof h.current.scoped === "boolean" &&
        typeof h.current.is_current === "boolean" &&
        Object.hasOwn(h.current, "source_active"),
    );
    require(
      !h.current.is_current ||
        (h.current.snapshot_id === h.snapshot_id &&
          h.current.head_version === h.observed_head_version &&
          h.current.scoped),
    );
  }
  const extractions = new Set<string>();
  for (const e of s.problem_source_extractions) {
    require(object(e) && uuid(e.id) && !extractions.has(e.id));
    extractions.add(e.id);
    const problem = s.problems?.find((p) => p.id === e.problem_id);
    require(
      problem && ["create", "link"].includes(e.action) &&
        positive(e.problem_version) &&
        e.current_problem_version === problem.current.version &&
        e.problem_version <= e.current_problem_version &&
        e.locally_edited ===
          (e.problem_version !== e.current_problem_version) &&
        uuid(e.extracted_by) && instant(e.extracted_at),
    );
    require(
      object(e.problem_fields) &&
        ["title", "notes", "status", "importance"].every((k) =>
          typeof e.problem_fields[k as keyof typeof e.problem_fields] ===
            "string"
        ) &&
        (e.problem_fields.onset_date === null ||
          typeof e.problem_fields.onset_date === "string"),
    );
    if (!e.locally_edited) {
      require(
        Object.keys(e.problem_fields).every((k) =>
          e.problem_fields[k as keyof typeof e.problem_fields] ===
            problem.current[k as keyof typeof problem.current]
        ),
      );
    }
    require(Array.isArray(e.sources) && e.sources.length > 0);
    const sourceIds = new Set<string>();
    for (const r of e.sources) {
      reference(r);
      require(!sourceIds.has(r.id));
      sourceIds.add(r.id);
      const selected = histories.get(r.id);
      require(
        typeof r.narrative_included === "boolean" &&
          r.narrative_included === !!selected,
      );
      if (selected) {
        require(
          [
            "version",
            "version_hash",
            "snapshot_id",
            "payload_hash",
            "observed_head_version",
            "approved_by",
            "approved_at",
          ].every((k) =>
            r[k as keyof typeof r] === selected[k as keyof typeof selected]
          ) && ["origin", "site_uid", "animal_id", "history_id"].every((k) =>
            r.source[k as keyof typeof r.source] ===
              selected.source[k as keyof typeof selected.source]
          ),
        );
      }
    }
    require(
      object(e.discrepancy) && typeof e.discrepancy.required === "boolean" &&
        typeof e.discrepancy.reviewed === "boolean" &&
        typeof e.discrepancy.changed_from_original === "boolean" &&
        Array.isArray(e.discrepancy.review_history),
    );
    require(
      e.discrepancy.required ===
        (e.discrepancy.changed_from_original && !e.discrepancy.reviewed),
    );
    require(!e.discrepancy.reviewed || e.discrepancy.review_history.length > 0);
    const sameSource = (a: ImportedHistorySource, b: ImportedHistorySource) =>
      ["origin", "site_uid", "animal_id", "history_id"].every((k) =>
        a[k as keyof ImportedHistorySource] ===
          b[k as keyof ImportedHistorySource]
      );
    const reviewIds = new Set<string>();
    for (const review of e.discrepancy.review_history) {
      require(
        uuid(review.id) && !reviewIds.has(review.id) &&
          uuid(review.reviewed_by) && instant(review.reviewed_at) &&
          Array.isArray(review.source_heads) && Array.isArray(review.sources),
      );
      reviewIds.add(review.id);
      require(
        review.source_heads.length === e.sources.length &&
          review.sources.length === e.sources.length,
      );
      const reviewedOriginals = new Set<string>();
      for (const r of review.sources) {
        reference(r);
        require(
          e.sources.some((original) => sameSource(original.source, r.source)),
        );
        const selected = histories.get(r.id);
        require(r.narrative_included === !!selected);
        if (selected) {
          require(
            [
              "version",
              "version_hash",
              "snapshot_id",
              "payload_hash",
              "observed_head_version",
              "approved_by",
              "approved_at",
            ].every((k) =>
              r[k as keyof typeof r] === selected[k as keyof typeof selected]
            ) && ["origin", "site_uid", "animal_id", "history_id"].every((k) =>
              r.source[k as keyof typeof r.source] ===
                selected.source[k as keyof typeof selected.source]
            ),
          );
        }
      }
      for (const head of review.source_heads) {
        require(
          uuid(head.history_id) && uuid(head.snapshot_id) &&
            positive(head.head_version) &&
            !reviewedOriginals.has(head.history_id),
        );
        reviewedOriginals.add(head.history_id);
        const original = e.sources.find((r) => r.id === head.history_id);
        require(
          original &&
            review.sources.some((r) =>
              sameSource(original.source, r.source) &&
              r.snapshot_id === head.snapshot_id &&
              r.observed_head_version === head.head_version
            ),
        );
      }
    }
  }
}
const escape = (v: unknown) =>
  String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const literal = (v: unknown) =>
  v === null || v === undefined
    ? "Not recorded"
    : escape(typeof v === "string" ? v : JSON.stringify(v));
const field = (label: string, v: unknown) =>
  `<div><dt>${escape(label)}</dt><dd>${literal(v)}</dd></div>`;
const source = (r: ImportedHistoryReference) =>
  `<p>ezyVet history ${
    escape(r.source.history_id)
  } · Imported version ${r.version} · Source site ${
    escape(r.source.site_uid)
  } · Animal reference ${
    escape(r.source.animal_id)
  }</p><p>Source imported and reviewed by administrator record ${
    escape(r.approved_by)
  } · ${escape(r.approved_at)}</p>`;
export function renderImportedHistory(s: ReleaseSnapshot): string {
  if (s.schema_version !== 6) return "";
  validateImportedHistory(s);
  const histories = s.imported_histories!.map((h) =>
    `<article><h2>Imported outside history</h2>${source(h)}<dl>${
      field("Original source comments", h.original.comments)
    }${field("Source category reference", h.original.history_system)}${
      field("Source chain reference", h.original.chain)
    }${field("Original source date value", h.original.timestamp)}${
      field("Source clinician reference", h.original.vet_id)
    }${field("Original source active value", h.original.active)}${
      field("Source consult reference", h.original.consult_id)
    }</dl><p>Consult context: ${
      escape(
        h.consult.status === "verified"
          ? "Verified same-patient source observation"
          : h.consult.status === "unresolved"
          ? "Unresolved source reference"
          : "No source reference supplied",
      )
    }${
      h.consult.status === "verified"
        ? ` · Consult ${
          escape(h.consult.external_id)
        } · Observed version ${h.consult.observed_head_version}`
        : ""
    }.</p><p>${
      h.current.is_current
        ? "This imported version matches the current scoped source observation."
        : "The current source observation differs or has not been verified in the mapped scope. This historical version has not been overwritten."
    }</p><dl>${
      field("Current source active value", h.current.source_active)
    }</dl></article>`
  ).join("");
  const extractions = s.problem_source_extractions!.map((e) =>
    `<article><h2>Local problem source provenance</h2><p>Problem: ${
      escape(s.problems!.find((p) => p.id === e.problem_id)!.current.title)
    } · ${
      e.action === "create"
        ? "Created as a local clinical finding"
        : "Source linked to an existing local problem"
    }</p><p>Local DVM decision by record ${escape(e.extracted_by)} · ${
      escape(e.extracted_at)
    } · Original problem version ${e.problem_version}</p><dl>${
      field("Title at clinical decision", e.problem_fields.title)
    }${field("Notes at clinical decision", e.problem_fields.notes)}${
      field("Onset chosen locally", e.problem_fields.onset_date)
    }${field("Status chosen locally", e.problem_fields.status)}${
      field("Importance chosen locally", e.problem_fields.importance)
    }</dl><p>${
      e.locally_edited
        ? `The local problem was subsequently edited; its current version is ${e.current_problem_version}. The original decision above is preserved.`
        : "The local problem fields remain at the reviewed version."
    }</p>${
      e.sources.map((r) =>
        `<section>${source(r)}<p>${
          r.narrative_included
            ? "The original narrative is included in this package."
            : "The original narrative was not selected for this package."
        }</p></section>`
      ).join("")
    }<p>Source discrepancy: ${
      e.discrepancy.reviewed
        ? "Reviewed against the current source observations"
        : e.discrepancy.required
        ? "Local review is still required"
        : e.discrepancy.changed_from_original
        ? "Source differs from the original extraction"
        : "No discrepancy recorded"
    }.</p>${
      e.discrepancy.review_history.map((r) =>
        `<p>Discrepancy reviewed by record ${escape(r.reviewed_by)} · ${
          escape(r.reviewed_at)
        } · Source observations ${
          r.source_heads.map((h) =>
            `${escape(h.history_id)} (version ${h.head_version})`
          ).join(", ")
        }</p>${
          r.sources.map((h) =>
            `<section>${source(h)}<p>${
              h.narrative_included
                ? "This reviewed narrative is included in this package."
                : "This reviewed narrative was not selected for this package."
            }</p></section>`
          ).join("")
        }`
      ).join("")
    }</article>`
  ).join("");
  return histories || extractions
    ? `${histories}${extractions}<p>Outside source references are preserved as received. Administrator import review and local DVM decisions are separate; no outside signature or document-byte verification is inferred from this text.</p>`
    : "";
}
