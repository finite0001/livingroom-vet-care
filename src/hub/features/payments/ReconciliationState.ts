export interface ReconciliationBlocker {
  kind: "observation" | "checkout_evidence" | "refund_evidence";
  id: string;
}
export interface ReconciliationTarget {
  invoice_id: string;
  family: "checkout" | "refund";
  request_id: string;
  provider_object_id: string;
  amount_cents: string;
  currency: "usd";
  account_id: string;
  livemode: boolean;
  blocker_refs: ReconciliationBlocker[];
  snapshot_hash: string;
}
export interface ReconciliationIntent {
  p_case_id: string;
  p_invoice_id: string;
  p_family: "checkout" | "refund";
  p_request_id: string;
  p_provider_object_id: string;
  p_blocker_refs: ReconciliationBlocker[];
  p_expected_case_hash: string;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const invalid = () =>
  new Error("Reconciliation evidence could not be verified.");
export function reconciliationObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown, re: RegExp) {
  if (typeof v !== "string" || !re.test(v)) throw invalid();
  return v;
}
export function reconciliationBlockers(v: unknown): ReconciliationBlocker[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 100) throw invalid();
  const rows = v.map((row) => {
    if (
      !reconciliationObject(row) ||
      Object.keys(row).sort().join(",") !== "id,kind"
    )
      throw invalid();
    return {
      kind: str(
        row.kind,
        /^(observation|checkout_evidence|refund_evidence)$/,
      ) as ReconciliationBlocker["kind"],
      id: str(row.id, uuid),
    };
  });
  if (new Set(rows.map((r) => `${r.kind}:${r.id}`)).size !== rows.length)
    throw invalid();
  return rows.sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  );
}
export function reconciliationTarget(
  v: unknown,
  invoice: string,
): ReconciliationTarget {
  if (
    !reconciliationObject(v) ||
    v.invoice_id !== invoice ||
    v.currency !== "usd" ||
    typeof v.livemode !== "boolean"
  )
    throw invalid();
  const family = str(v.family, /^(checkout|refund)$/) as "checkout" | "refund";
  return {
    invoice_id: invoice,
    family,
    request_id: str(v.request_id, uuid),
    provider_object_id: str(
      v.provider_object_id,
      family === "checkout"
        ? /^cs_[A-Za-z0-9_]{1,200}$/
        : /^re_[A-Za-z0-9]{1,200}$/,
    ),
    amount_cents: str(v.amount_cents, /^[1-9][0-9]{0,7}$/),
    currency: "usd",
    account_id: str(v.account_id, /^acct_[A-Za-z0-9]{1,200}$/),
    livemode: v.livemode,
    blocker_refs: reconciliationBlockers(v.blocker_refs),
    snapshot_hash: str(v.snapshot_hash, hash),
  };
}
export function reconciliationIntent(
  v: unknown,
  invoice: string,
): ReconciliationIntent {
  if (
    !reconciliationObject(v) ||
    Object.keys(v).sort().join(",") !==
      [
        "p_case_id",
        "p_invoice_id",
        "p_family",
        "p_request_id",
        "p_provider_object_id",
        "p_blocker_refs",
        "p_expected_case_hash",
      ]
        .sort()
        .join(",") ||
    v.p_invoice_id !== invoice
  )
    throw invalid();
  const family = str(v.p_family, /^(checkout|refund)$/) as
    | "checkout"
    | "refund";
  return {
    p_case_id: str(v.p_case_id, uuid),
    p_invoice_id: invoice,
    p_family: family,
    p_request_id: str(v.p_request_id, uuid),
    p_provider_object_id: str(
      v.p_provider_object_id,
      family === "checkout"
        ? /^cs_[A-Za-z0-9_]{1,200}$/
        : /^re_[A-Za-z0-9]{1,200}$/,
    ),
    p_blocker_refs: reconciliationBlockers(v.p_blocker_refs),
    p_expected_case_hash: str(v.p_expected_case_hash, hash),
  };
}
export interface ReconciliationCase {
  id: string;
  invoice_id: string;
  actor_id: string;
  family: "checkout" | "refund";
  request_id: string;
  provider_object_id: string;
  blocker_refs: ReconciliationBlocker[];
  snapshot_hash: string;
  created_at: string;
}
export interface ReconciliationProof {
  case_id: string;
  proof_hash: string;
  status: string;
  amount_cents: string;
  currency: "usd";
  account_id: string;
  livemode: boolean;
  provider_observed_at: string;
}
export interface ReconciliationReceipt {
  case_id: string;
  actor_id: string;
  proof_hash: string;
  ledger_evidence_id: string;
  created_at: string;
}
export interface ReconciliationReview {
  case: ReconciliationCase;
  capture: ReconciliationProof | null;
  resolution: ReconciliationReceipt | null;
}
function timestamp(v: unknown) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) throw invalid();
  return v;
}
export function reconciliationReview(
  value: unknown,
  invoice: string,
  id?: string,
): ReconciliationReview | null {
  if (value === null) return null;
  if (!reconciliationObject(value) || !reconciliationObject(value.case))
    throw invalid();
  const c = value.case;
  const intent = reconciliationIntent(
    {
      p_case_id: c.id,
      p_invoice_id: c.invoice_id,
      p_family: c.family,
      p_request_id: c.request_id,
      p_provider_object_id: c.provider_object_id,
      p_blocker_refs: c.blocker_refs,
      p_expected_case_hash: c.snapshot_hash,
    },
    invoice,
  );
  if (id && intent.p_case_id !== id) throw invalid();
  const review: ReconciliationReview = {
    case: {
      id: intent.p_case_id,
      invoice_id: invoice,
      actor_id: str(c.actor_id, uuid),
      family: intent.p_family,
      request_id: intent.p_request_id,
      provider_object_id: intent.p_provider_object_id,
      blocker_refs: intent.p_blocker_refs,
      snapshot_hash: intent.p_expected_case_hash,
      created_at: timestamp(c.created_at),
    },
    capture: null,
    resolution: null,
  };
  if (value.capture !== null) {
    const p = value.capture;
    if (
      !reconciliationObject(p) ||
      !reconciliationObject(p.evidence) ||
      p.case_id !== c.id
    )
      throw invalid();
    const e = p.evidence;
    if (
      e.family !== c.family ||
      e.request_id !== c.request_id ||
      e.object_id !== c.provider_object_id ||
      e.currency !== "usd" ||
      typeof e.livemode !== "boolean" ||
      Date.parse(timestamp(p.provider_observed_at)) !==
        Date.parse(timestamp(e.provider_observed_at))
    )
      throw invalid();
    const status = str(
      e.status,
      c.family === "checkout"
        ? /^(session_open|session_expired|payment_succeeded)$/
        : /^(pending|failed|succeeded)$/,
    );
    if (c.family === "checkout") {
      str(e.source_hash, hash);
      if (e.payment_id !== null) str(e.payment_id, /^pi_[A-Za-z0-9]+$/);
      if (status === "payment_succeeded" && e.payment_id === null)
        throw invalid();
    } else str(e.provider_payment_id, /^pi_[A-Za-z0-9]+$/);
    review.capture = {
      case_id: c.id as string,
      proof_hash: str(p.proof_hash, hash),
      status,
      amount_cents: str(e.amount_cents, /^[1-9][0-9]{0,7}$/),
      currency: "usd",
      account_id: str(e.account_id, /^acct_[A-Za-z0-9]{1,200}$/),
      livemode: e.livemode,
      provider_observed_at: timestamp(e.provider_observed_at),
    };
  }
  if (value.resolution !== null) {
    const r = value.resolution;
    if (
      !reconciliationObject(r) ||
      r.case_id !== c.id ||
      r.actor_id !== c.actor_id ||
      !review.capture ||
      r.proof_hash !== review.capture.proof_hash
    )
      throw invalid();
    review.resolution = {
      case_id: c.id as string,
      actor_id: r.actor_id as string,
      proof_hash: str(r.proof_hash, hash),
      ledger_evidence_id: str(r.ledger_evidence_id, uuid),
      created_at: timestamp(r.created_at),
    };
  }
  return review;
}
export function matchesReconciliationIntent(
  review: ReconciliationReview,
  intent: ReconciliationIntent,
  actor: string,
) {
  const c = review.case;
  return (
    c.actor_id === actor &&
    c.id === intent.p_case_id &&
    c.invoice_id === intent.p_invoice_id &&
    c.family === intent.p_family &&
    c.request_id === intent.p_request_id &&
    c.provider_object_id === intent.p_provider_object_id &&
    c.snapshot_hash === intent.p_expected_case_hash &&
    JSON.stringify(c.blocker_refs) === JSON.stringify(intent.p_blocker_refs)
  );
}
export function freshReconciliationProof(
  proof: ReconciliationProof,
  now = Date.now(),
) {
  const age = now - Date.parse(proof.provider_observed_at);
  return age >= 0 && age < 5 * 60000;
}

export interface ReconciliationChoice {
  family: "checkout" | "refund";
  request_id: string;
  provider_object_id: string | null;
  amount_cents: string;
  reviewable: boolean;
  reasons: string[];
}
export interface ReconciliationWorkspace {
  targets: ReconciliationChoice[];
  cases: ReconciliationReview[];
  hasMoreCases: boolean;
}
export function reconciliationDiscovery(
  v: unknown,
  invoice: string,
  actor: string,
): ReconciliationWorkspace {
  if (
    !reconciliationObject(v) ||
    v.invoice_id !== invoice ||
    !Array.isArray(v.targets) ||
    !Array.isArray(v.cases) ||
    v.cases.length > 100 ||
    typeof v.has_more_cases !== "boolean"
  )
    throw invalid();
  const targets = v.targets.map((row) => {
    if (
      !reconciliationObject(row) ||
      row.currency !== "usd" ||
      typeof row.reviewable !== "boolean"
    )
      throw invalid();
    const family = str(row.family, /^(checkout|refund)$/) as
      | "checkout"
      | "refund";
    return {
      family,
      request_id: str(row.request_id, uuid),
      provider_object_id: str(
        row.provider_object_id,
        family === "checkout"
          ? /^cs_[A-Za-z0-9_]{1,200}$/
          : /^re_[A-Za-z0-9]{1,200}$/,
      ),
      amount_cents: str(row.amount_cents, /^[1-9][0-9]{0,7}$/),
      reviewable: row.reviewable,
      reasons: [],
    };
  });
  const cases = v.cases.map((row) => {
    const parsed = reconciliationReview(row, invoice);
    if (!parsed || parsed.case.actor_id !== actor) throw invalid();
    return parsed;
  });
  return { targets, cases, hasMoreCases: v.has_more_cases };
}
