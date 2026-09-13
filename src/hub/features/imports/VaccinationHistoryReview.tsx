import { refreshPatientReleases } from "../record-releases/refresh";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useVaccinationReviewOperation } from "./useVaccinationReviewOperation";
import {
  abandonVaccinationReview,
  approveVaccinationReview,
  listReviewVaccineProducts,
  listVaccinationReviewCandidates,
  listVaccinationReviewMappings,
  listVaccinationReviewRequests,
  prepareVaccinationReview,
  recoverVaccinationReview,
} from "./vaccination-review-api";
import { vaccinationReviewPayloadSchema } from "./vaccination-review-state";
import type {
  ImportedVaccination,
  ReviewCursor,
  VaccinationReviewEnvelope,
} from "./vaccination-review-state";
import type { VaccinationCandidate } from "./vaccination-api";
import {
  RawVaccinationEvidence,
  ImportedVaccinationEvidence,
} from "./ImportedVaccinationEvidence";
interface Props {
  actor: string;
  petId: string;
  patientVersion: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  correction: ImportedVaccination | null;
  onResetCorrection: () => void;
}
const empty = () => ({
  status: "",
  administration_date_status: "",
  administered_on: "",
  next_date_status: "",
  source_next_due_on: "",
  product_id: "",
  outside_author: "",
  reason: "",
});
const selectClass =
  "block w-full rounded-md border border-input bg-background p-2 text-sm";
export function VaccinationHistoryReview({
  actor,
  petId,
  patientVersion,
  disabled,
  onDirtyChange,
  correction,
  onResetCorrection,
}: Props) {
  const operation = useVaccinationReviewOperation(actor, petId),
    cache = useQueryClient();
  const [mapping, setMapping] = useState(""),
    [candidate, setCandidate] = useState<VaccinationCandidate | null>(null),
    [draft, setDraft] = useState(empty);
  const [cursor, setCursor] = useState<ReviewCursor | null>(null),
    [requestCursor, setRequestCursor] = useState<ReviewCursor | null>(null);
  const [saved, setSaved] = useState<VaccinationReviewEnvelope | null>(null),
    [checked, setChecked] = useState(false),
    [abandonChecked, setAbandonChecked] = useState(false),
    [notice, setNotice] = useState("");
  const mappings = useQuery({
    queryKey: ["vaccination-review-mappings", actor, petId],
    queryFn: () => listVaccinationReviewMappings(petId),
    retry: false,
  });
  const candidates = useQuery({
    queryKey: ["vaccination-review-candidates", actor, petId, mapping, cursor],
    queryFn: () => listVaccinationReviewCandidates(petId, mapping, cursor),
    enabled: !!mapping,
    retry: false,
  });
  const [productSearch, setProductSearch] = useState("");
  const products = useQuery({
    queryKey: ["vaccination-review-products", actor, productSearch],
    queryFn: () => listReviewVaccineProducts(productSearch),
    retry: false,
  });
  const requests = useQuery({
    queryKey: ["vaccination-review-requests", actor, petId, requestCursor],
    queryFn: () => listVaccinationReviewRequests(actor, petId, requestCursor),
    retry: false,
  });
  const draftDirty =
    !!mapping ||
    !!candidate ||
    !!correction ||
    Object.values(draft).some(Boolean);
  const dirty = draftDirty || !!operation.intent || operation.busy;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const locked = disabled || operation.busy || !!operation.intent;
  const change = (key: keyof ReturnType<typeof empty>, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const reset = () => {
    setMapping("");
    setCandidate(null);
    setCursor(null);
    setDraft(empty());
    setProductSearch("");
    onResetCorrection();
  };
  const proposed = () => {
    const product = products.data?.find((p) => p.id === draft.product_id);
    return vaccinationReviewPayloadSchema.parse({
      animal_link_id: candidate?.animal_link_id,
      patient_version: patientVersion,
      snapshot_id: candidate?.id,
      payload_hash: candidate?.payload_hash,
      observed_head_version: candidate?.observed_head_version,
      consult_snapshot_id: candidate?.consult_snapshot_id,
      consult_payload_hash: candidate?.consult_payload_hash,
      consult_observed_head_version: candidate?.consult_observed_head_version,
      product_id: draft.product_id || null,
      product_version: product?.version ?? null,
      administered_on:
        draft.administration_date_status === "date"
          ? draft.administered_on
          : null,
      administration_date_status: draft.administration_date_status,
      source_next_due_on:
        draft.next_date_status === "date" ? draft.source_next_due_on : null,
      next_date_status: draft.next_date_status,
      status: draft.status,
      outside_author: draft.outside_author.trim() || null,
      reason: draft.reason,
      replaces_id: correction?.id ?? null,
      expected_predecessor_hash: correction?.version_hash ?? null,
    });
  };
  let canPrepare = false;
  try {
    proposed();
    canPrepare =
      !!candidate?.eligible_for_review &&
      (!correction ||
        (correction.animal_link_id === candidate.animal_link_id &&
          correction.source.vaccination_id === candidate.external_id));
  } catch {
    /* Incomplete fields are presented without inferring values. */
  }
  const accept = (result: VaccinationReviewEnvelope | null) => {
    if (!operation.alive.current) return;
    setSaved(result);
    setChecked(false);
    setAbandonChecked(false);
    setNotice(
      !result
        ? "No saved request is visible. Retry preparation with the retained intent, recover again, or explicitly abandon this reference."
        : result.request.status === "prepared"
          ? "Saved review recovered. Read the frozen values before approval."
          : result.request.status === "approved"
            ? "Outside vaccination history saved. Recovery uses the same receipt."
            : "Original review abandoned. It cannot be approved.",
    );
    if (result?.request.status === "approved") {
      void cache.invalidateQueries({
        queryKey: ["patient-imported-vaccinations", actor, petId],
      });
      void refreshPatientReleases(cache, petId);
    }
    void requests.refetch();
  };
  const recover = async () => {
    const i = operation.intentRef.current;
    if (i)
      accept(await recoverVaccinationReview(i.id, actor, petId, i.payload));
  };
  const prepare = async () => {
    if (disabled || operation.intentRef.current) return;
    const payload = proposed(),
      id = crypto.randomUUID();
    operation.retain({ id, actor, pet: petId, payload });
    accept(await prepareVaccinationReview(id, actor, petId, payload));
  };
  return (
    <section
      aria-label="Review outside vaccination history"
      className="space-y-4 rounded-md border p-4"
    >
      <h3 className="font-semibold">Review outside vaccination history</h3>
      <p className="text-sm">
        Choose the original evidence and explicitly interpret its dates and
        status. Approval records outside history. Active due plans, reminders,
        certificates, stock and billing require their own decisions.
      </p>
      {correction && (
        <p>
          Correcting outside vaccination #{correction.source.vaccination_id},
          version {correction.version}. Choose current evidence and enter the
          full replacement interpretation.
        </p>
      )}
      <fieldset disabled={locked} className="space-y-3">
        <label className="block">
          ezyVet patient mapping
          <select
            className={selectClass}
            value={mapping}
            onChange={(e) => {
              setMapping(e.target.value);
              setCandidate(null);
              setCursor(null);
            }}
          >
            <option value="">Choose an imported patient mapping</option>
            {mappings.data?.map((m) => (
              <option key={m.link_id} value={m.link_id}>
                {m.source_site_uid} · animal {m.external_id}
              </option>
            ))}
          </select>
        </label>
        {mappings.isError && (
          <p role="alert">Patient source mappings unavailable.</p>
        )}
        {mappings.data?.length === 0 && (
          <p>
            No imported patient mapping is available. An administrator must link
            source records first.
          </p>
        )}
        {candidates.isError && (
          <p role="alert">
            Scoped vaccination evidence unavailable. Refresh before review.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {candidates.data?.candidates.map((c) => (
            <Button
              variant="outline"
              key={`${c.id}:${c.observed_head_version}`}
              disabled={
                !c.eligible_for_review ||
                (!!correction &&
                  (correction.animal_link_id !== c.animal_link_id ||
                    correction.source.vaccination_id !== c.external_id))
              }
              onClick={() => setCandidate(c)}
            >
              Review source vaccination {c.external_id}
              {!c.eligible_for_review ? " — changed source" : ""}
            </Button>
          ))}
        </div>
        {candidate && (
          <div className="space-y-2">
            <p>
              Selected vaccination #{candidate.external_id}, revision{" "}
              {candidate.observed_head_version}; consult #
              {candidate.consult_external_id}, revision{" "}
              {candidate.consult_observed_head_version}.
            </p>
            <RawVaccinationEvidence original={candidate.payload} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!mapping || candidates.isFetching}
            onClick={() => {
              setCandidate(null);
              void candidates.refetch();
            }}
          >
            Refresh source evidence
          </Button>
          <Button
            variant="outline"
            disabled={!cursor}
            onClick={() => {
              setCursor(null);
              setCandidate(null);
            }}
          >
            Newest source vaccinations
          </Button>
          <Button
            variant="outline"
            disabled={!candidates.data?.next_cursor}
            onClick={() => {
              setCursor(candidates.data!.next_cursor);
              setCandidate(null);
            }}
          >
            Older source vaccinations
          </Button>
        </div>
        <label className="block">
          Reviewed vaccination status
          <select
            className={selectClass}
            value={draft.status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">Choose an interpretation</option>
            <option value="administered">
              Administered outside this practice
            </option>
            <option value="not_administered">Not administered</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        {(
          [
            [
              "administration_date_status",
              "administered_on",
              "Administration date",
            ],
            ["next_date_status", "source_next_due_on", "Source next date"],
          ] as const
        ).map(([statusKey, dateKey, label]) => (
          <div key={statusKey} className="space-y-2">
            <label className="block">
              {label} interpretation
              <select
                className={selectClass}
                value={draft[statusKey]}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [statusKey]: e.target.value,
                    [dateKey]: "",
                  }))
                }
              >
                <option value="">Choose how to record this date</option>
                <option value="date">Reviewed calendar date</option>
                <option value="unknown">Unknown</option>
                <option value="uninterpreted">
                  Preserve source without interpreting
                </option>
              </select>
            </label>
            {draft[statusKey] === "date" && (
              <label className="block">
                Reviewed {label.toLowerCase()}
                <Input
                  type="date"
                  value={draft[dateKey]}
                  onChange={(e) => change(dateKey, e.target.value)}
                />
              </label>
            )}
          </div>
        ))}
        <label className="block">
          Search local vaccine catalog
          <Input
            value={productSearch}
            maxLength={100}
            onChange={(e) => {
              setProductSearch(e.target.value);
              change("product_id", "");
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Up to 50 matching active vaccines. Search by name to narrow the list.
        </p>
        <label className="block">
          Local vaccine product (optional)
          <select
            className={selectClass}
            value={draft.product_id}
            onChange={(e) => change("product_id", e.target.value)}
          >
            <option value="">No local product selected</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · catalog version {p.version}
              </option>
            ))}
          </select>
        </label>
        {products.isError && (
          <p role="alert">
            Catalog unavailable. You may preserve outside history without a
            local product.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          A catalog match does not establish the historical manufacturer, lot,
          dose or route. The reviewed source next date does not start reminders.
        </p>
        <label className="block">
          Outside clinician attribution (optional)
          <Input
            maxLength={500}
            value={draft.outside_author}
            onChange={(e) => change("outside_author", e.target.value)}
          />
        </label>
        <label className="block">
          Vaccination review rationale
          <Textarea
            maxLength={2000}
            value={draft.reason}
            onChange={(e) => change("reason", e.target.value)}
          />
        </label>
      </fieldset>
      {operation.error && <p role="alert">{operation.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button
        disabled={locked || !canPrepare || operation.storageBlocked}
        onClick={() => void operation.run(prepare)}
      >
        Prepare vaccination review
      </Button>
      {!operation.intent && draftDirty && (
        <Button variant="outline" disabled={operation.busy} onClick={reset}>
          Discard vaccination review draft
        </Button>
      )}
      {operation.intent && (
        <div className="space-y-3">
          <p className="break-all text-xs">
            Vaccination review reference: {operation.intent.id}
          </p>
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => void operation.run(recover)}
          >
            Recover original vaccination review
          </Button>
          {!saved && operation.intent.payload && (
            <Button
              variant="outline"
              disabled={operation.busy || disabled}
              onClick={() =>
                void operation.run(async () => {
                  const i = operation.intentRef.current;
                  if (i?.payload)
                    accept(
                      await prepareVaccinationReview(
                        i.id,
                        actor,
                        petId,
                        i.payload,
                      ),
                    );
                })
              }
            >
              Retry exact vaccination preparation
            </Button>
          )}
          {saved?.request.payload && (
            <div className="space-y-2">
              <h4 className="font-semibold">Frozen review values</h4>
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                {Object.entries(saved.request.payload).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt>{key.replace(/_/g, " ")}</dt>
                    <dd className="break-words whitespace-pre-wrap">
                      {value === null
                        ? "Unknown / not selected"
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {saved?.request.review_context && (
            <details>
              <summary>Complete frozen source and catalog evidence</summary>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(saved.request.review_context, null, 2)}
              </pre>
            </details>
          )}
          {saved?.receipt && (
            <ImportedVaccinationEvidence vaccination={saved.receipt} />
          )}
          {saved?.request.status === "prepared" && (
            <>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || operation.busy}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I reviewed the frozen source evidence and exact vaccination
                interpretation.
              </label>
              <Button
                disabled={!checked || disabled || operation.busy}
                onClick={() =>
                  void operation.run(async () => {
                    if (saved.request.payload && saved.request.request_hash) {
                      setChecked(false);
                      accept(
                        await approveVaccinationReview(
                          saved.request.id,
                          actor,
                          petId,
                          saved.request.request_hash,
                          saved.request.payload,
                        ),
                      );
                    }
                  })
                }
              >
                Approve outside vaccination history
              </Button>
            </>
          )}
          {(!saved || saved.request.status === "prepared") && (
            <>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={abandonChecked}
                  disabled={operation.busy}
                  onChange={(e) => setAbandonChecked(e.target.checked)}
                />
                Abandon this original vaccination request if it has not been
                approved.
              </label>
              <Button
                variant="outline"
                disabled={!abandonChecked || operation.busy}
                onClick={() =>
                  void operation.run(async () => {
                    const i = operation.intentRef.current;
                    if (i)
                      accept(
                        await abandonVaccinationReview(
                          i.id,
                          actor,
                          petId,
                          i.payload,
                        ),
                      );
                  })
                }
              >
                Abandon original vaccination review
              </Button>
            </>
          )}
          {saved && saved.request.status !== "prepared" && (
            <Button
              variant="outline"
              disabled={operation.busy}
              onClick={() => {
                if (operation.finish()) {
                  setSaved(null);
                  setNotice("");
                  reset();
                }
              }}
            >
              Close resolved vaccination review
            </Button>
          )}
        </div>
      )}
      <details>
        <summary>Saved vaccination review requests</summary>
        {requests.isError && (
          <p role="alert">Saved vaccination request discovery unavailable.</p>
        )}
        {requests.data?.requests.map((e) => (
          <div
            key={e.request.id}
            className="flex flex-wrap items-center gap-2 py-2"
          >
            <span>
              {e.request.created_at} · {e.request.status}
            </span>
            <Button
              variant="outline"
              disabled={dirty || disabled}
              onClick={() =>
                void operation.run(async () => {
                  operation.retain({
                    id: e.request.id,
                    actor,
                    pet: petId,
                    payload: e.request.payload,
                  });
                  setSaved(null);
                  await recover();
                })
              }
            >
              Recover vaccination request {e.request.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => void requests.refetch()}
          >
            Refresh saved vaccination requests
          </Button>
          <Button
            variant="outline"
            disabled={!requestCursor || operation.busy}
            onClick={() => setRequestCursor(null)}
          >
            Newest vaccination requests
          </Button>
          <Button
            variant="outline"
            disabled={!requests.data?.next_cursor || operation.busy}
            onClick={() => setRequestCursor(requests.data!.next_cursor)}
          >
            Older vaccination requests
          </Button>
        </div>
      </details>
    </section>
  );
}
