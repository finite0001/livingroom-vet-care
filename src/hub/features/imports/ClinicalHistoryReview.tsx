import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useHistoryOperation } from "./useHistoryOperation";
import {
  prepareHistoryRequest,
  recoverHistoryRequest,
  approveHistoryRequest,
  abandonHistoryRequest,
  listHistoryRequests,
} from "./history-api";
import { FrozenHistoryReview } from "./ImportedHistoryEvidence";
import type {
  HistoryCursor,
  HistoryPayload,
  HistoryRequestEnvelope,
  HistoryRequestKind,
} from "./history-state";
interface Props {
  actor: string;
  petId: string;
  kind: HistoryRequestKind;
  disabled: boolean;
  draftDirty: boolean;
  canPrepare: boolean;
  payload: () => HistoryPayload;
  onDirtyChange: (dirty: boolean) => void;
  onReset: () => void;
  onCommitted: () => void;
  children: ReactNode;
}
export function ClinicalHistoryReview({
  actor,
  petId,
  kind,
  disabled,
  draftDirty,
  canPrepare,
  payload,
  onDirtyChange,
  onReset,
  onCommitted,
  children,
}: Props) {
  const operation = useHistoryOperation({
    actor,
    petId,
    kind:
      kind === "history_approval"
        ? "approval"
        : kind === "problem_extraction"
          ? "extraction"
          : "discrepancy",
  });
  const [saved, setSaved] = useState<HistoryRequestEnvelope | null>(null),
    [checked, setChecked] = useState(false),
    [abandonChecked, setAbandonChecked] = useState(false),
    [notice, setNotice] = useState("");
  const [cursor, setCursor] = useState<HistoryCursor | null>(null);
  const history = useQuery({
    queryKey: ["ezyvet-history-requests", actor, petId, kind, cursor],
    queryFn: () => listHistoryRequests(actor, petId, kind, cursor),
    retry: false,
  });
  const dirty = operation.busy || !!operation.id || draftDirty;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const accept = (value: HistoryRequestEnvelope | null) => {
    if (!operation.alive.current) return;
    setSaved(value);
    setChecked(false);
    setAbandonChecked(false);
    if (!value) {
      setNotice(
        "No saved preparation is visible yet. Keep the original request or explicitly abandon it before starting another.",
      );
      return;
    }
    setNotice(
      value.request.status === "approved"
        ? "Original reviewed action is saved. Recovery did not create another action."
        : value.request.status === "abandoned"
          ? "Original request is abandoned and cannot be approved."
          : "Exact saved review recovered. Read its frozen evidence before explicitly approving.",
    );
    if (value.request.status === "approved") onCommitted();
    void history.refetch();
  };
  const recover = async () => {
    const id = operation.idRef.current;
    if (id) accept(await recoverHistoryRequest(id, actor, petId, kind));
  };
  const prepare = async () => {
    if (operation.idRef.current || disabled) return;
    const proposed = payload();
    const id = crypto.randomUUID();
    operation.retain(id);
    setSaved(null);
    setChecked(false);
    accept(await prepareHistoryRequest(id, actor, petId, kind, proposed));
  };
  const approve = async () => {
    if (
      !saved ||
      saved.request.status !== "prepared" ||
      !checked ||
      !saved.request.request_hash ||
      disabled
    )
      return;
    setChecked(false);
    accept(
      await approveHistoryRequest(
        saved.request.id,
        actor,
        petId,
        kind,
        saved.request.request_hash,
      ),
    );
  };
  const label =
    kind === "history_approval"
      ? "source history import"
      : kind === "problem_extraction"
        ? "local finding"
        : "source discrepancy";
  return (
    <section
      aria-label={`Review ${label}`}
      className="space-y-3 rounded-md border p-4"
    >
      <h3 className="font-semibold">Review {label}</h3>
      <fieldset
        disabled={disabled || operation.busy || !!operation.id}
        className="space-y-3"
      >
        {children}
      </fieldset>
      {operation.error && <p role="alert">{operation.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button
        disabled={disabled || operation.busy || !!operation.id || !canPrepare}
        onClick={() => void operation.run(prepare)}
      >
        Prepare {label} review
      </Button>
      {!operation.id && draftDirty && (
        <Button variant="outline" disabled={operation.busy} onClick={onReset}>
          Discard {label} draft
        </Button>
      )}
      {operation.id && (
        <div className="space-y-3">
          <p className="break-all text-xs">Review reference: {operation.id}</p>
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => void operation.run(recover)}
          >
            Recover original {label} review
          </Button>
          {saved?.request.review_context && (
            <FrozenHistoryReview context={saved.request.review_context} />
          )}
          {saved?.request.payload && (
            <div className="space-y-2">
              <p>Review reason: {String(saved.request.payload.reason)}</p>
              {"fields" in saved.request.payload && (
                <dl>
                  {Object.entries(
                    saved.request.payload.fields as Record<string, unknown>,
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="font-medium">
                        {(
                          {
                            title: "Local problem title",
                            notes: "Local problem notes",
                            onset_date: "Known onset",
                            status: "Local problem status",
                            importance: "Local importance",
                          } as Record<string, string>
                        )[key] ?? key}
                      </dt>
                      <dd className="whitespace-pre-wrap">
                        {value === null ? "Unknown" : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {saved.request.payload.action === "link" && (
                <p>
                  Link to the existing problem. Its local fields will remain
                  unchanged.
                </p>
              )}
            </div>
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
                I reviewed the complete frozen evidence and the exact proposed{" "}
                {label}.
              </label>
              <Button
                disabled={disabled || operation.busy || !checked}
                onClick={() => void operation.run(approve)}
              >
                Approve reviewed {label}
              </Button>
            </>
          )}
          {(!saved || saved.request.status === "prepared") && (
            <div>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={abandonChecked}
                  disabled={operation.busy}
                  onChange={(e) => setAbandonChecked(e.target.checked)}
                />
                Abandon this original request if it has not already been
                approved.
              </label>
              <Button
                variant="outline"
                disabled={operation.busy || !abandonChecked}
                onClick={() =>
                  void operation.run(async () => {
                    if (operation.idRef.current)
                      accept(
                        await abandonHistoryRequest(
                          operation.idRef.current,
                          actor,
                          petId,
                          kind,
                        ),
                      );
                  })
                }
              >
                Abandon original {label} review
              </Button>
            </div>
          )}
          {saved && saved.request.status !== "prepared" && (
            <Button
              variant="outline"
              disabled={operation.busy}
              onClick={() => {
                operation.finish();
                setSaved(null);
                setChecked(false);
                setAbandonChecked(false);
                setNotice("");
                onReset();
              }}
            >
              Close saved {label} review
            </Button>
          )}
        </div>
      )}
      <details>
        <summary>Earlier {label} requests</summary>
        {history.isError && (
          <p role="alert">Saved review discovery unavailable.</p>
        )}
        {history.data?.requests.map((e) => (
          <div key={e.request.id} className="flex flex-wrap gap-2 p-2">
            <span>
              {e.request.created_at} · {e.request.status}
            </span>
            <Button
              variant="outline"
              disabled={dirty}
              onClick={() =>
                void operation.run(async () => {
                  operation.retain(e.request.id);
                  setSaved(null);
                  await recover();
                })
              }
            >
              Recover review {e.request.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          disabled={operation.busy}
          onClick={() => void history.refetch()}
        >
          Refresh review history
        </Button>
        <Button
          variant="outline"
          disabled={operation.busy || !cursor}
          onClick={() => setCursor(null)}
        >
          Newest review requests
        </Button>
        <Button
          variant="outline"
          disabled={operation.busy || !history.data?.next_cursor}
          onClick={() => setCursor(history.data!.next_cursor)}
        >
          Older review requests
        </Button>
      </details>
    </section>
  );
}
