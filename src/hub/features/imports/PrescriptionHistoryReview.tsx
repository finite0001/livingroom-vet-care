import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { refreshPatientReleases } from "../record-releases/refresh";
import { usePrescriptionReviewOperation } from "./usePrescriptionReviewOperation";
import {
  abandonPrescriptionReview,
  approvePrescriptionReview,
  getPrescriptionReviewCandidate,
  listPrescriptionReviewCandidates,
  listPrescriptionReviewRequests,
  listReviewMedicationProducts,
  preparePrescriptionReview,
  recoverPrescriptionReview,
} from "./prescription-review-api";
import type { PrescriptionReviewCandidate } from "./prescription-review-api";
import { prescriptionReviewPayloadSchema } from "./prescription-review-operation-state";
import type { PrescriptionReviewOperation } from "./prescription-review-operation-state";
import type {
  ImportedPrescription,
  PrescriptionCursor,
} from "./prescription-review-state";
import {
  RawPrescriptionEvidence,
  ImportedPrescriptionEvidence,
  ImportedPrescriptionItem,
} from "./ImportedPrescriptionEvidence";
interface Props {
  actor: string;
  petId: string;
  patientVersion: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  correction: ImportedPrescription | null;
  onResetCorrection: () => void;
}
interface ItemDraft {
  selected: boolean;
  start_date_status: string;
  start_on: string;
  note: string;
  product: { id: string; version: number; name: string; unit: string } | null;
}
const empty = () => ({
  status: "",
  prescription_date_status: "",
  prescribed_on: "",
  outside_author: "",
  reason: "",
  completeness: "",
  partial_reason: "",
});
const selectClass =
  "block w-full rounded-md border border-input bg-background p-2 text-sm";
export function PrescriptionHistoryReview({
  actor,
  petId,
  patientVersion,
  disabled,
  onDirtyChange,
  correction,
  onResetCorrection,
}: Props) {
  const operation = usePrescriptionReviewOperation(actor, petId),
    cache = useQueryClient();
  const [candidate, setCandidate] =
      useState<PrescriptionReviewCandidate | null>(null),
    [draft, setDraft] = useState(empty),
    [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [cursor, setCursor] = useState<PrescriptionCursor | null>(null),
    [requestCursor, setRequestCursor] = useState<PrescriptionCursor | null>(
      null,
    );
  const [saved, setSaved] = useState<PrescriptionReviewOperation | null>(null),
    [checked, setChecked] = useState(false),
    [abandonChecked, setAbandonChecked] = useState(false),
    [notice, setNotice] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const candidates = useQuery({
    queryKey: ["prescription-review-candidates", actor, petId, cursor],
    queryFn: () => listPrescriptionReviewCandidates(petId, cursor),
    retry: false,
  });
  const products = useQuery({
    queryKey: ["prescription-review-products", actor, productSearch],
    queryFn: () => listReviewMedicationProducts(productSearch),
    retry: false,
  });
  const requests = useQuery({
    queryKey: ["prescription-review-requests", actor, petId, requestCursor],
    queryFn: () => listPrescriptionReviewRequests(actor, petId, requestCursor),
    retry: false,
  });
  const draftDirty =
    !!candidate || !!correction || Object.values(draft).some(Boolean);
  const dirty = draftDirty || !!operation.intent || operation.busy;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const locked = disabled || operation.busy || !!operation.intent;
  const change = (key: keyof ReturnType<typeof empty>, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const changeItem = (id: string, patch: Partial<ItemDraft>) =>
    setItemDrafts((items) => ({ ...items, [id]: { ...items[id], ...patch } }));
  const uniqueItems =
    candidate?.source_context.items.filter(
      (item, index, rows) =>
        rows.findIndex((other) => other.snapshot_id === item.snapshot_id) ===
        index,
    ) ?? [];
  const reset = () => {
    setCandidate(null);
    setCursor(null);
    setDraft(empty());
    setItemDrafts({});
    setProductSearch("");
    onResetCorrection();
  };
  const proposed = () => {
    if (
      !candidate?.eligible_for_review ||
      candidate.patient_version !== patientVersion
    )
      throw new Error("Current patient source evidence required");
    const selected = uniqueItems.filter(
      (item) => itemDrafts[item.snapshot_id]?.selected,
    );
    if (
      draft.completeness === "complete" &&
      (candidate.source_context.reconciliation.status !== "matched" ||
        selected.length !== uniqueItems.length)
    )
      throw new Error("Complete account requires every matched source item");
    return prescriptionReviewPayloadSchema.parse({
      item_run_id: candidate.run.id,
      patient_version: patientVersion,
      interpretation: {
        prescribed_on:
          draft.prescription_date_status === "date"
            ? draft.prescribed_on
            : null,
        prescription_date_status: draft.prescription_date_status,
        status: draft.status,
        outside_author: draft.outside_author.trim() || null,
        reason: draft.reason,
        completeness: draft.completeness,
        partial_reason:
          draft.completeness === "partial" ? draft.partial_reason : null,
        replaces_id: correction?.id ?? null,
        expected_predecessor_hash: correction?.version_hash ?? null,
        items: selected.map((item) => {
          const d = itemDrafts[item.snapshot_id];
          return {
            snapshot_id: item.snapshot_id,
            start_on: d.start_date_status === "date" ? d.start_on : null,
            start_date_status: d.start_date_status,
            product_id: d.product?.id ?? null,
            product_version: d.product?.version ?? null,
            note: d.note.trim() || null,
          };
        }),
      },
    });
  };
  let canPrepare = false;
  try {
    proposed();
    canPrepare =
      !correction ||
      (!!candidate &&
        correction.animal_link_id === candidate.run.animal_link_id &&
        correction.prescription_external_id ===
          candidate.run.prescription_external_id &&
        correction.source_origin === candidate.run.source_origin &&
        correction.source_site_uid === candidate.run.source_site_uid);
  } catch {
    /* Leave unknown clinical fields for the reviewer to choose. */
  }
  const accept = (result: PrescriptionReviewOperation | null) => {
    if (!operation.alive.current) return;
    setSaved(result);
    setChecked(false);
    setAbandonChecked(false);
    setNotice(
      !result
        ? "No saved request is visible. Retry with the retained intent, recover again, or explicitly abandon this reference."
        : result.request.status === "prepared"
          ? "Saved review recovered. Read the frozen values before approval."
          : result.request.status === "approved"
            ? "Outside prescription history saved. Recovery uses the same receipt."
            : "Original review abandoned. It cannot be approved.",
    );
    if (result?.request.status === "approved") {
      void cache.invalidateQueries({
        queryKey: ["patient-imported-prescriptions", actor, petId],
      });
      void refreshPatientReleases(cache, petId);
    }
    void requests.refetch();
  };
  const recover = async () => {
    const i = operation.intentRef.current;
    if (i) {
      setSaved(null);
      setChecked(false);
      accept(await recoverPrescriptionReview(i.id, actor, petId, i.payload));
    }
  };
  const prepare = async () => {
    if (disabled || operation.intentRef.current || !canPrepare) return;
    const payload = proposed(),
      id = crypto.randomUUID();
    operation.retain({ id, actor, pet: petId, payload });
    accept(await preparePrescriptionReview(id, actor, petId, payload));
  };
  return (
    <section
      aria-label="Review outside prescription history"
      className="space-y-4 rounded-md border p-4"
    >
      <h3 className="font-semibold">Review outside prescription history</h3>
      <p className="text-sm">
        Choose the original prescription and interpret its history. Approval
        documents outside care; it does not authorize local prescribing, refills
        or dispensing.
      </p>
      {correction && (
        <p className="text-sm">
          Correcting outside prescription #{correction.prescription_external_id}
          , version {correction.version}. Choose current evidence and enter the
          full replacement interpretation.
        </p>
      )}
      <fieldset disabled={locked} className="space-y-4">
        <legend className="font-medium">Imported prescription evidence</legend>
        {candidates.isLoading && (
          <p role="status">Loading prescription sources…</p>
        )}
        {candidates.isError && (
          <p role="alert">Prescription source discovery unavailable.</p>
        )}
        {candidates.data?.candidates.length === 0 && (
          <p>No imported prescription runs on this page.</p>
        )}
        {candidates.data?.candidates.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <span>
              Prescription #{row.prescription_external_id} ·{" "}
              {row.source.site_uid} · {row.item_count} observed items ·{" "}
              {row.status}
            </span>
            <Button
              variant="outline"
              disabled={!!candidate}
              onClick={() =>
                void operation.run(async () => {
                  const value = await getPrescriptionReviewCandidate(
                    petId,
                    row.id,
                  );
                  if (!operation.alive.current) return;
                  setCandidate(value);
                  setDraft(empty());
                  setItemDrafts(
                    Object.fromEntries(
                      value.source_context.items.map((item) => [
                        item.snapshot_id,
                        {
                          selected: false,
                          start_date_status: "",
                          start_on: "",
                          note: "",
                          product: null,
                        },
                      ]),
                    ),
                  );
                })
              }
            >
              Inspect prescription {row.prescription_external_id} run{" "}
              {row.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={candidates.isFetching}
            onClick={() => void candidates.refetch()}
          >
            Refresh prescription sources
          </Button>
          <Button
            variant="outline"
            disabled={!cursor || candidates.isFetching}
            onClick={() => setCursor(null)}
          >
            Newest prescription sources
          </Button>
          <Button
            variant="outline"
            disabled={!candidates.data?.next_cursor || candidates.isFetching}
            onClick={() => setCursor(candidates.data!.next_cursor)}
          >
            Older prescription sources
          </Button>
        </div>
        {candidate && (
          <div className="space-y-4">
            <h4 className="font-medium">
              Prescription #{candidate.run.prescription_external_id} ·{" "}
              {candidate.run.source_site_uid}
            </h4>
            {!candidate.eligible_for_review && (
              <p role="alert">
                {candidate.unavailable_reason === "SOURCE_CONSULT_UNRESOLVED"
                  ? "The referenced consultation must be imported and resolved before clinical review."
                  : "Source or patient context has changed. Import current evidence before reviewing."}
              </p>
            )}
            {candidate.patient_version !== patientVersion && (
              <p role="alert">
                The patient changed. Refresh the patient chart before preparing
                this review.
              </p>
            )}
            <RawPrescriptionEvidence
              original={candidate.source_context.parent.original}
              label="Original prescription source values"
            />
            <p className="text-sm">
              Source item accounting:{" "}
              {candidate.source_context.reconciliation.status}. Scan finished:{" "}
              {candidate.source_context.reconciliation.scanComplete
                ? "yes"
                : "no"}
              .
            </p>
            <RawPrescriptionEvidence
              original={candidate.source_context.reconciliation}
              label="Complete source item accounting"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                Historical prescription status
                <select
                  className={selectClass}
                  value={draft.status}
                  onChange={(e) => change("status", e.target.value)}
                >
                  <option value="">Choose status</option>
                  <option value="active">Active in outside history</option>
                  <option value="inactive">Inactive in outside history</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>
                Prescription date interpretation
                <select
                  className={selectClass}
                  value={draft.prescription_date_status}
                  onChange={(e) =>
                    change("prescription_date_status", e.target.value)
                  }
                >
                  <option value="">Choose date interpretation</option>
                  <option value="date">Reviewed calendar date</option>
                  <option value="unknown">Unknown</option>
                  <option value="uninterpreted">
                    Source date left uninterpreted
                  </option>
                </select>
              </label>
              {draft.prescription_date_status === "date" && (
                <label>
                  Reviewed prescription date
                  <Input
                    type="date"
                    value={draft.prescribed_on}
                    onChange={(e) => change("prescribed_on", e.target.value)}
                  />
                </label>
              )}
              <label>
                Outside prescriber (leave blank if unknown)
                <Input
                  value={draft.outside_author}
                  onChange={(e) => change("outside_author", e.target.value)}
                />
              </label>
              <label>
                Historical account completeness
                <select
                  className={selectClass}
                  value={draft.completeness}
                  onChange={(e) => change("completeness", e.target.value)}
                >
                  <option value="">Choose completeness</option>
                  <option value="partial">Partial historical account</option>
                  <option
                    value="complete"
                    disabled={
                      candidate.source_context.reconciliation.status !==
                      "matched"
                    }
                  >
                    Complete matched account
                  </option>
                </select>
              </label>
            </div>
            {draft.completeness === "partial" && (
              <label className="block">
                Partial account disclosure
                <Textarea
                  value={draft.partial_reason}
                  onChange={(e) => change("partial_reason", e.target.value)}
                />
              </label>
            )}
            <label className="block">
              Review rationale
              <Textarea
                value={draft.reason}
                onChange={(e) => change("reason", e.target.value)}
              />
            </label>
            <label className="block">
              Search optional medication catalog matches
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </label>
            {products.isError && (
              <p role="alert">
                Medication catalog unavailable. Review may proceed without a
                catalog match.
              </p>
            )}
            {uniqueItems.map((item) => {
              const d = itemDrafts[item.snapshot_id];
              if (!d) return null;
              const match = d.product
                ? `${d.product.id}:${d.product.version}`
                : "";
              return (
                <div
                  key={item.snapshot_id}
                  className="space-y-3 rounded-md border p-3"
                >
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={d.selected}
                      onChange={(e) =>
                        changeItem(item.snapshot_id, {
                          selected: e.target.checked,
                        })
                      }
                    />
                    Include source medication item {item.external_id}
                  </label>
                  <RawPrescriptionEvidence
                    original={item.original}
                    label={`Original medication item ${item.external_id}`}
                  />
                  <fieldset
                    disabled={!d.selected}
                    className="grid gap-3 md:grid-cols-2"
                  >
                    <label>
                      Item {item.external_id} start date interpretation
                      <select
                        className={selectClass}
                        value={d.start_date_status}
                        onChange={(e) =>
                          changeItem(item.snapshot_id, {
                            start_date_status: e.target.value,
                          })
                        }
                      >
                        <option value="">Choose date interpretation</option>
                        <option value="date">Reviewed calendar date</option>
                        <option value="unknown">Unknown</option>
                        <option value="uninterpreted">
                          Source date left uninterpreted
                        </option>
                      </select>
                    </label>
                    {d.start_date_status === "date" && (
                      <label>
                        Item {item.external_id} reviewed start date
                        <Input
                          type="date"
                          value={d.start_on}
                          onChange={(e) =>
                            changeItem(item.snapshot_id, {
                              start_on: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    <label>
                      Item {item.external_id} optional catalog match
                      <select
                        className={selectClass}
                        value={match}
                        onChange={(e) => {
                          const product = products.data?.find(
                            (p) => `${p.id}:${p.version}` === e.target.value,
                          );
                          changeItem(item.snapshot_id, {
                            product: product
                              ? {
                                  id: product.id,
                                  version: product.version,
                                  name: product.name,
                                  unit: product.unit,
                                }
                              : null,
                          });
                        }}
                      >
                        <option value="">No local catalog match</option>
                        {d.product &&
                          !products.data?.some(
                            (p) => `${p.id}:${p.version}` === match,
                          ) && (
                            <option value={match}>
                              {d.product.name} · retained version{" "}
                              {d.product.version}
                            </option>
                          )}
                        {products.data?.map((p) => (
                          <option
                            key={`${p.id}:${p.version}`}
                            value={`${p.id}:${p.version}`}
                          >
                            {p.name} · version {p.version} · {p.unit}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Item {item.external_id} separate interpretation (optional)
                      <Textarea
                        value={d.note}
                        onChange={(e) =>
                          changeItem(item.snapshot_id, { note: e.target.value })
                        }
                      />
                    </label>
                  </fieldset>
                </div>
              );
            })}
            {!canPrepare && (
              <p className="text-sm text-muted-foreground">
                Choose the required interpretations and provide a review
                rationale. Partial accounts need a disclosure; each selected
                item needs an explicit start-date interpretation.
              </p>
            )}
          </div>
        )}
      </fieldset>
      {operation.error && <p role="alert">{operation.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button
        disabled={locked || !canPrepare || operation.storageBlocked}
        onClick={() => void operation.run(prepare)}
      >
        Prepare prescription review
      </Button>
      {!operation.intent && draftDirty && (
        <Button variant="outline" disabled={operation.busy} onClick={reset}>
          Discard prescription review draft
        </Button>
      )}
      {operation.intent && (
        <div className="space-y-3">
          <p className="break-all text-xs">
            Prescription review reference: {operation.intent.id}
          </p>
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => void operation.run(recover)}
          >
            Recover original prescription review
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
                      await preparePrescriptionReview(
                        i.id,
                        actor,
                        petId,
                        i.payload,
                      ),
                    );
                })
              }
            >
              Retry exact prescription preparation
            </Button>
          )}
          {saved?.request.review_context && (
            <div className="space-y-3">
              <h4 className="font-semibold">Frozen prescription review</h4>
              <dl className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt>Reviewed historical status</dt>
                  <dd>{saved.request.review_context.reviewed.status}</dd>
                </div>
                <div>
                  <dt>Prescription date</dt>
                  <dd>
                    {saved.request.review_context.reviewed.prescribed_on ??
                      saved.request.review_context.reviewed
                        .prescription_date_status}
                  </dd>
                </div>
                <div>
                  <dt>Outside prescriber</dt>
                  <dd>
                    {saved.request.review_context.reviewed.outside_author ??
                      "Unknown"}
                  </dd>
                </div>
              </dl>
              <p className="whitespace-pre-wrap break-words text-sm">
                Review rationale: {saved.request.review_context.reviewed.reason}
              </p>
              {saved.request.review_context.reviewed.partial_reason && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  Partial historical account:{" "}
                  {saved.request.review_context.reviewed.partial_reason}
                </p>
              )}
              {saved.request.review_context.selected_items.map((item) => (
                <ImportedPrescriptionItem
                  key={item.source.snapshot_id}
                  item={item}
                />
              ))}
              <RawPrescriptionEvidence
                original={saved.request.review_context.parent.original}
                label="Frozen original prescription"
              />
              <RawPrescriptionEvidence
                original={saved.request.review_context.reconciliation}
                label="Frozen source item accounting"
              />
              {saved.request.review_context.omitted_items.map((item) => (
                <RawPrescriptionEvidence
                  key={`${item.snapshot_id}:${item.page}`}
                  original={item.original}
                  label={`Omitted source item ${item.external_id}`}
                />
              ))}
            </div>
          )}
          {saved?.receipt && (
            <ImportedPrescriptionEvidence prescription={saved.receipt} />
          )}
          {saved?.request.status === "prepared" &&
            saved.clinical_approval_available && (
              <>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || operation.busy}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  I reviewed the frozen source evidence and exact prescription
                  interpretation.
                </label>
                <Button
                  disabled={!checked || disabled || operation.busy}
                  onClick={() =>
                    void operation.run(async () => {
                      if (saved.request.payload && saved.request.request_hash) {
                        setChecked(false);
                        accept(
                          await approvePrescriptionReview(
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
                  Approve outside prescription history
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
                Abandon this original prescription request if it has not been
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
                        await abandonPrescriptionReview(
                          i.id,
                          actor,
                          petId,
                          i.payload,
                        ),
                      );
                  })
                }
              >
                Abandon original prescription review
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
              Close resolved prescription review
            </Button>
          )}
        </div>
      )}
      <details>
        <summary>Saved prescription review requests</summary>
        {requests.isError && (
          <p role="alert">Saved prescription request discovery unavailable.</p>
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
              Recover prescription request {e.request.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => void requests.refetch()}
          >
            Refresh saved prescription requests
          </Button>
          <Button
            variant="outline"
            disabled={!requestCursor || operation.busy}
            onClick={() => setRequestCursor(null)}
          >
            Newest prescription requests
          </Button>
          <Button
            variant="outline"
            disabled={!requests.data?.next_cursor || operation.busy}
            onClick={() => setRequestCursor(requests.data!.next_cursor)}
          >
            Older prescription requests
          </Button>
        </div>
      </details>
    </section>
  );
}
