import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { PrescriptionRpc } from "./prescription-api";
import type { NativeDispense } from "./fulfillment-api";
import { correctionEqual } from "./fulfillment-corrections-api";
import {
  createNativeReconciliationApi,
  createNativeReturnDiscrepancyApi,
  reconciliationIntentSchema,
  discrepancyIntentSchema,
  reconciliationAttestations,
  type ReconciliationHistoryEvent,
} from "./fulfillment-reconciliation-api";
import {
  returnMilli,
  type ReturnIntakeBalance,
} from "./fulfillment-returns-api";
import type {
  ReconciliationIntent as ReturnIntent,
  ReconciliationPreview as ReturnPreview,
  ReconciliationRead as ReturnRead,
  ReturnDiscrepancyIntent,
  ReturnDiscrepancyPreview,
} from "../../../../supabase/functions/_shared/native-return-reconciliation-contract";
import { usePrescriptionOperation } from "./usePrescriptionOperation";
import { PrescriptionOperationControls } from "./PrescriptionOperationControls";
interface Props {
  actor: string;
  dispense: NativeDispense;
  medicationName: string;
  evidenceRevision: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onConfirmed: () => void;
  onClose: () => void;
}
const blockerLabels: Record<string, string> = {
  policy_disabled:
    "Practice return-to-stock policy is disabled or unconfigured.",
  dvm_required: "An active DVM must review and record restocking.",
  custody_not_retained: "Material was not retained in clinic custody.",
  package_not_sealed: "Packaging was not recorded as sealed and intact.",
  storage_not_controlled: "Controlled storage was not established.",
  original_pickup_exists:
    "An original pickup exists, even if its acknowledgment was later disputed.",
  product_inactive: "Current catalog product is inactive.",
  unit_changed: "Current product unit differs from the signed dispense unit.",
  lot_review_hold: "An unresolved discrepancy holds this lot for review.",
  insufficient_available_stock:
    "Available stock is insufficient for this correction. Report the discrepancy for review.",
  lot_expired: "One or more selected lots are expired on the practice date.",
};
function returnActionLabel(action: ReturnIntent["action"]) {
  return {
    intake: "Physical intake",
    dispose: "Completed disposal",
    restock: "Return to available stock",
    retract_intake: "Correction of intake claim",
    retract_disposal: "Correction of disposal claim",
    retract_restock: "Correction of available-stock return",
  }[action];
}
export function NativeDispenseReturns(p: Props) {
  return (
    <ReturnsWorkspace
      key={`${p.actor}:${p.dispense.pet_id}:${p.dispense.id}`}
      {...p}
    />
  );
}
function ReturnsWorkspace({
  actor,
  dispense,
  medicationName,
  evidenceRevision,
  disabled,
  onDirtyChange,
  onConfirmed,
  onClose,
}: Props) {
  const target = useMemo(
    () => ({
      authorization_id: dispense.authorization_id,
      pet_id: dispense.pet_id,
      dispense_id: dispense.id,
    }),
    [dispense],
  );
  const api = useMemo(
      () =>
        createNativeReconciliationApi(
          supabase as unknown as PrescriptionRpc,
          actor,
          target,
        ),
      [actor, target],
    ),
    cache = useQueryClient();
  const alive = useRef(true),
    readGeneration = useRef(0),
    attempted = useRef(-1);
  const [current, setCurrent] = useState<ReturnRead | null>(null),
    [events, setEvents] = useState<ReconciliationHistoryEvent[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [observed, setObserved] = useState(-1),
    [policyStale, setPolicyStale] = useState(false);
  const [action, setAction] = useState<ReturnIntent["action"]>("intake"),
    [sourceId, setSourceId] = useState(""),
    [discrepancyId, setDiscrepancyId] = useState(""),
    [physicalAck, setPhysicalAck] = useState(false),
    [intakeId, setIntakeId] = useState(""),
    [intake, setIntake] = useState<ReturnIntakeBalance | null>(null),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [custody, setCustody] = useState<ReturnIntent["custody"]>("unknown"),
    [condition, setCondition] =
      useState<ReturnIntent["package_condition"]>("unknown"),
    [storage, setStorage] =
      useState<ReturnIntent["storage_history"]>("unknown"),
    [reason, setReason] = useState(""),
    [note, setNote] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnPreview | null>(null),
    [ack, setAck] = useState(false),
    [restockAck, setRestockAck] = useState(false),
    [modified, setModified] = useState(false);
  const operation = usePrescriptionOperation({
    actor,
    patientId: dispense.pet_id,
    execute: api.execute,
    recover: api.recover,
    onConfirmed: () => {
      setModified(false);
      setReason("");
      setNote("");
      setQuantities({});
      setIntakeId("");
      setSourceId("");
      setDiscrepancyId("");
      setPhysicalAck(false);
      setIntake(null);
      setPreview(null);
      setAck(false);
      setRestockAck(false);
      onConfirmed();
      void load();
    },
  });
  const [discrepancyDirty, setDiscrepancyDirty] = useState(false);
  const dirty = modified || operation.dirty;
  useEffect(() => {
    onDirtyChange(dirty || discrepancyDirty);
  }, [dirty, discrepancyDirty, onDirtyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Invalidate responses for this keyed workspace, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      readGeneration.current++;
      onDirtyChange(false);
    };
  }, [onDirtyChange]);
  useEffect(
    () =>
      cache.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.query.queryKey[0] === "native-return-policy" &&
          event.query.state.isInvalidated
        )
          setPolicyStale(true);
      }),
    [cache],
  );
  useEffect(() => {
    if (
      !dirty &&
      !busy &&
      observed !== evidenceRevision &&
      attempted.current !== evidenceRevision
    ) {
      attempted.current = evidenceRevision;
      void load();
    } // guarded keyed read, no draft-triggered reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, observed, evidenceRevision]);
  async function load(more = false) {
    setBusy(true);
    setError("");
    const generation = ++readGeneration.current;
    try {
      const [r, p] = await Promise.all([
        api.read(),
        api.history(more ? cursor : null),
      ]);
      if (!alive.current || generation !== readGeneration.current) return;
      if (
        !r ||
        !correctionEqual(r.head, p.head) ||
        !correctionEqual(r.discrepancies.head, p.discrepancy_head) ||
        (more && current && !correctionEqual(current.head, p.head))
      )
        throw new Error(
          "Return evidence changed. Refresh before continuing through history.",
        );
      if (
        r.authorization_hash !== dispense.authorization_hash ||
        r.dispensed_at !== dispense.dispensed_at
      )
        throw new Error("Original dispense differs from this return target.");
      setCurrent(r);
      setEvents((old) => (more ? [...old, ...p.events] : p.events));
      setCursor(p.next_before_version);
      setObserved(evidenceRevision);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Return history could not be read.",
        );
    } finally {
      if (alive.current && generation === readGeneration.current)
        setBusy(false);
    }
  }
  async function chooseIntake(id: string) {
    setIntakeId(id);
    setIntake(null);
    setQuantities({});
    setModified(true);
    setError("");
    if (!id) return;
    setBusy(true);
    const generation = ++readGeneration.current;
    try {
      const r = await api.readIntake(id);
      if (!alive.current || generation !== readGeneration.current) return;
      if (!r) throw new Error("This intake is unavailable.");
      if (
        current &&
        (!correctionEqual(current.head, r.head) ||
          !correctionEqual(current.discrepancies.head, r.discrepancy_head))
      )
        setObserved(-1);
      setIntake(r.intake);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Intake could not be read.");
    } finally {
      if (alive.current && generation === readGeneration.current)
        setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    setAck(false);
    setRestockAck(false);
    try {
      const allocations = Object.entries(quantities)
        .filter(([, v]) => v.trim() !== "")
        .map(([allocation_id, quantity]) => ({
          allocation_id,
          quantity: quantity.trim(),
        }))
        .sort((a, b) => a.allocation_id.localeCompare(b.allocation_id));
      const source = events.find((e) => e.id === sourceId);
      const intent = reconciliationIntentSchema.parse({
        target,
        action,
        intake_id: action === "intake" ? null : intakeId,
        correction_target:
          action.startsWith("retract_") && source
            ? { event_id: source.id, record_hash: source.record_hash }
            : null,
        discrepancy_id: action.startsWith("retract_")
          ? discrepancyId || null
          : null,
        allocations,
        custody: action === "intake" ? custody : null,
        package_condition: action === "intake" ? condition : null,
        storage_history: action === "intake" ? storage : null,
        reason: reason.trim(),
        note: note.trim(),
      });
      const p = await api.preview(intent);
      if (!alive.current) return;
      if (
        p.context.authorization_hash !== dispense.authorization_hash ||
        p.context.dispensed_at !== dispense.dispensed_at ||
        p.context.allocations.length !== dispense.allocations.length ||
        p.context.allocations.some(
          (a) =>
            !dispense.allocations.some(
              (original) =>
                original.lot_id === a.lot_id &&
                original.quantity === a.dispensed_quantity,
            ),
        )
      )
        throw new Error(
          "Return review differs from the selected original dispense allocations.",
        );
      if (
        p.context.stock_review &&
        p.blockers.includes("unit_changed") !==
          (p.context.stock_review.product.unit !== dispense.unit)
      )
        throw new Error(
          "Current product unit evidence is inconsistent; refresh before restocking.",
        );
      setPreview(p);
      setPolicyStale(false);
      setObserved(evidenceRevision);
      if (p.context.intake) setIntake(p.context.intake);
      if (p.allowed)
        operation.review({
          id: crypto.randomUUID(),
          kind: "record_return_v2",
          payload: {
            intent,
            expected_context_hash: p.context_hash,
            expected_head: p.context.head,
            expected_discrepancy_head: p.context.discrepancy_head,
            physical_attestations: reconciliationAttestations(action),
            attest_review: true,
            attest_restock: action === "restock",
          },
        });
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Return review failed; entered values are retained.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const isCorrection = action.startsWith("retract_");
  const selectedSource = events.find((e) => e.id === sourceId);
  const locked = disabled || busy || operation.dirty || discrepancyDirty;
  const correctionRemaining = current?.replay.correction_remaining.find(
    (e) => e.event_id === sourceId,
  );
  const rows =
    current?.allocations.filter(
      (a) =>
        action === "intake" ||
        intake?.allocations.some((i) => i.allocation_id === a.allocation_id),
    ) ?? [];
  return (
    <section
      className="space-y-3 rounded border p-3"
      aria-label="Physical return records"
    >
      <h4 className="font-medium">Physical return and disposition</h4>
      <p>
        {medicationName} · original dispense {dispense.quantity} {dispense.unit}{" "}
        · {dispense.dispensed_at}
      </p>
      <p>
        Receipt and disposal do not change available stock. A separately
        reviewed restock can increase available stock only. No action here
        changes charges, payments, refill status or prescription allowance.
      </p>
      {(observed !== evidenceRevision || policyStale) && current && (
        <p role="status">
          Return or policy evidence needs fresh review. Your draft and any
          original uncertain operation are retained.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={locked || dirty}
        onClick={() => void load()}
      >
        Refresh return records
      </Button>
      {current && (
        <ReturnDiscrepancies
          actor={actor}
          evidenceRevision={evidenceRevision}
          target={target}
          current={current}
          events={events}
          disabled={disabled || busy || dirty}
          onDirtyChange={setDiscrepancyDirty}
          onConfirmed={() => {
            onConfirmed();
            void load();
          }}
        />
      )}
      <h5 className="font-medium">Current allocation balances</h5>
      <p>
        These balances reflect recorded corrections. Original claims remain in
        event history.
      </p>
      {current?.allocations.map((a) => (
        <div className="rounded border p-2" key={a.allocation_id}>
          <p>
            Lot {a.lot_number} · expiry {a.expires_on}
          </p>
          <p>
            Dispensed {a.dispensed_quantity}; recorded returned{" "}
            {a.returned_quantity}; remaining to return{" "}
            {a.remaining_returnable_quantity} {dispense.unit}
          </p>
          <p>
            Held {a.held_quantity}; disposed {a.disposed_quantity}; restocked{" "}
            {a.restocked_quantity}
          </p>
        </div>
      ))}
      <fieldset disabled={locked || !current} className="space-y-3">
        <label className="block">
          Return action
          <select
            aria-label="Return action"
            className="block w-full rounded border bg-background p-2"
            value={action}
            onChange={(e) => {
              setAction(e.target.value as ReturnIntent["action"]);
              setQuantities({});
              setSourceId("");
              setDiscrepancyId("");
              setPhysicalAck(false);
              setIntakeId("");
              setIntake(null);
              setPreview(null);
              setModified(true);
            }}
          >
            <option value="intake">
              Record physical intake into held custody
            </option>
            <option value="dispose">Record completed disposal</option>
            <option value="restock">Review return to available stock</option>
            <option value="retract_intake">
              Correct an incorrect intake claim
            </option>
            <option value="retract_disposal">
              Correct a disposal that did not occur
            </option>
            <option value="retract_restock">
              Remove an incorrect restock from available stock
            </option>
          </select>
        </label>
        {isCorrection && (
          <>
            <label className="block">
              Original event to correct
              <select
                aria-label="Original event to correct"
                className="block w-full rounded border bg-background p-2"
                value={sourceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSourceId(id);
                  setPhysicalAck(false);
                  const source = events.find((e) => e.id === id);
                  void chooseIntake(
                    source
                      ? source.action === "intake"
                        ? source.id
                        : source.intake_id!
                      : "",
                  );
                }}
              >
                <option value="">Choose exact original event</option>
                {events
                  .filter(
                    (e) =>
                      e.action ===
                      (action === "retract_intake"
                        ? "intake"
                        : action === "retract_disposal"
                          ? "dispose"
                          : "restock"),
                  )
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      Event {e.sequence} · {e.reason}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Earlier claims stay visible. Only the selected remaining
              quantities can be corrected; no prescription allowance or money is
              restored.
            </p>
            <label className="block">
              Link an open discrepancy (optional)
              <select
                aria-label="Link an open discrepancy"
                className="block w-full rounded border bg-background p-2"
                value={discrepancyId}
                onChange={(e) => {
                  setDiscrepancyId(e.target.value);
                  setModified(true);
                }}
              >
                <option value="">No case link</option>
                {current?.discrepancies.cases
                  .filter(
                    (c) =>
                      c.status === "open" && c.source.event_id === sourceId,
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      Report {c.report.sequence} · {c.report.observation}
                    </option>
                  ))}
              </select>
            </label>
            {selectedSource && (
              <p>
                Original event {selectedSource.sequence}: {selectedSource.note}
              </p>
            )}
          </>
        )}
        {action !== "intake" && !isCorrection && (
          <>
            <label className="block">
              Original return intake
              <select
                aria-label="Original return intake"
                className="block w-full rounded border bg-background p-2"
                value={intakeId}
                onChange={(e) => void chooseIntake(e.target.value)}
              >
                <option value="">Choose exact intake</option>
                {events
                  .filter((e) => e.action === "intake")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      Intake {e.sequence} · {e.created_at} · {e.reason}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Choose a recorded intake. Load earlier history below if needed;
              quantities are read from its current held balance.
            </p>
            {intake && (
              <p>
                Original custody: {intake.custody}; packaging:{" "}
                {intake.package_condition}; storage: {intake.storage_history}.
              </p>
            )}
          </>
        )}
        {action === "intake" && (
          <>
            <label className="block">
              Custody before receipt
              <select
                aria-label="Custody before receipt"
                className="block w-full rounded border bg-background p-2"
                value={custody ?? "unknown"}
                onChange={(e) => {
                  setCustody(e.target.value as ReturnIntent["custody"]);
                  setModified(true);
                }}
              >
                <option value="unknown">Unknown</option>
                <option value="client_returned">
                  Returned from client custody
                </option>
                <option value="clinic_retained">
                  Continuously retained in clinic custody
                </option>
              </select>
            </label>
            <label className="block">
              Packaging condition
              <select
                aria-label="Packaging condition"
                className="block w-full rounded border bg-background p-2"
                value={condition ?? "unknown"}
                onChange={(e) => {
                  setCondition(
                    e.target.value as ReturnIntent["package_condition"],
                  );
                  setModified(true);
                }}
              >
                {["unknown", "sealed_intact", "opened", "damaged"].map((v) => (
                  <option key={v} value={v}>
                    {v.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Storage history
              <select
                aria-label="Storage history"
                className="block w-full rounded border bg-background p-2"
                value={storage ?? "unknown"}
                onChange={(e) => {
                  setStorage(e.target.value as ReturnIntent["storage_history"]);
                  setModified(true);
                }}
              >
                {["unknown", "controlled", "compromised"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {rows.map((a) => {
          const available = isCorrection
            ? (() => {
                const remaining =
                  correctionRemaining?.allocations.find(
                    (b) => b.allocation_id === a.allocation_id,
                  )?.quantity ?? "0.000";
                const held =
                  intake?.allocations.find(
                    (b) => b.allocation_id === a.allocation_id,
                  )?.held_quantity ?? "0.000";
                return action === "retract_intake" &&
                  returnMilli(held) < returnMilli(remaining)
                  ? held
                  : remaining;
              })()
            : action === "intake"
              ? a.remaining_returnable_quantity
              : (intake?.allocations.find(
                  (i) => i.allocation_id === a.allocation_id,
                )?.held_quantity ?? "0.000");
          return (
            <label className="block" key={a.allocation_id}>
              Quantity for lot {a.lot_number} · {available} {dispense.unit}{" "}
              available for this action
              <Input
                aria-label={`Quantity for lot ${a.lot_number}`}
                inputMode="decimal"
                value={quantities[a.allocation_id] ?? ""}
                disabled={returnMilli(available) === 0n}
                onChange={(e) => {
                  setQuantities((old) => ({
                    ...old,
                    [a.allocation_id]: e.target.value,
                  }));
                  setModified(true);
                }}
              />
            </label>
          );
        })}
        <label className="block">
          Return or disposition reason
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setModified(true);
            }}
          />
        </label>
        <label className="block">
          Custody and disposition note
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setModified(true);
            }}
          />
        </label>
        <p>
          Only known original allocations can be attributed here. Describe
          actual receipt or completed disposition and custody facts; notes are
          shareable in explicitly selected client medical records.
        </p>
        <Button onClick={() => void review()}>Review return evidence</Button>
      </fieldset>
      {preview && (
        <section
          className="space-y-2 rounded border p-3"
          aria-label="Reviewed return evidence"
        >
          <h5>Reviewed {returnActionLabel(preview.context.intent.action)}</h5>
          {preview.context.intent.allocations.map((a) => (
            <p key={a.allocation_id}>
              {
                preview.context.allocations.find(
                  (b) => b.allocation_id === a.allocation_id,
                )?.lot_number
              }
              : {a.quantity} {dispense.unit}
            </p>
          ))}
          <p>{preview.context.intent.reason}</p>
          <p className="whitespace-pre-wrap">{preview.context.intent.note}</p>
          {preview.context.stock_review && (
            <p>
              Current product {preview.context.stock_review.product.name}, unit{" "}
              {preview.context.stock_review.product.unit}; practice date{" "}
              {preview.context.stock_review.practice_date}; policy revision{" "}
              {preview.context.policy?.version}.
            </p>
          )}
          {!preview.allowed && (
            <div role="alert">
              <p>This action is blocked for the reviewed record:</p>
              <ul>
                {preview.blockers.map((b) => (
                  <li key={b}>
                    {blockerLabels[b] ??
                      "Additional server review required: " + b}
                  </li>
                ))}
              </ul>
              <Link to="/hub/settings">Review practice policy settings</Link>
            </div>
          )}
          {operation.state.phase === "review" && (
            <>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={disabled}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I verified the exact original lots, actual quantities and
                custody or completed disposition. This reason and note are
                suitable for a selected client medical-record release.
              </label>
              {isCorrection && (
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={physicalAck}
                    disabled={disabled}
                    onChange={(e) => setPhysicalAck(e.target.checked)}
                  />
                  {action === "retract_intake"
                    ? "I confirmed this original intake claim is incorrect for the selected quantities."
                    : action === "retract_disposal"
                      ? "I confirmed these quantities were not destroyed and remain physically held."
                      : "I confirmed these quantities have been removed from available stock and remain physically held."}
                </label>
              )}
              {action === "restock" && (
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={restockAck}
                    disabled={disabled}
                    onChange={(e) => setRestockAck(e.target.checked)}
                  />
                  As the reviewing DVM, I explicitly attest this guarded return
                  to available stock under the current reviewed policy.
                </label>
              )}
            </>
          )}
        </section>
      )}
      <fieldset disabled={disabled}>
        <PrescriptionOperationControls
          state={operation.state}
          error={operation.error}
          notice={operation.notice}
          commitLabel="Save reviewed return record"
          reviewConfirmed={
            ack &&
            (!isCorrection || physicalAck) &&
            (action !== "restock" || restockAck) &&
            !policyStale &&
            observed === evidenceRevision
          }
          onCommit={operation.commit}
          onRecover={operation.recoverOriginal}
          onDiscard={() => {
            operation.discard();
            setPreview(null);
            setAck(false);
            setRestockAck(false);
          }}
        />
      </fieldset>
      <h5 className="font-medium">Return event history</h5>
      {events.map((e) => (
        <article className="rounded border p-2" key={e.id}>
          <p>
            {returnActionLabel(e.action)} · {e.actor.name} · {e.created_at}
          </p>
          <p>{e.reason}</p>
          <p className="whitespace-pre-wrap">{e.note}</p>
          {e.allocations.map((a) => (
            <p key={a.allocation_id}>
              {current?.allocations.find(
                (b) => b.allocation_id === a.allocation_id,
              )?.lot_number ?? a.lot_id}{" "}
              · {a.quantity} {dispense.unit}
              {a.movement_id ? " · available-stock movement recorded" : ""}
            </p>
          ))}
        </article>
      ))}
      {cursor && (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void load(true)}
        >
          Load earlier return events
        </Button>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy || operation.locked || discrepancyDirty}
        onClick={onClose}
      >
        Close return panel{dirty ? " and discard draft" : ""}
      </Button>
    </section>
  );
}

interface DiscrepancyProps {
  actor: string;
  evidenceRevision: number;
  target: { authorization_id: string; pet_id: string; dispense_id: string };
  current: ReturnRead;
  events: ReconciliationHistoryEvent[];
  disabled: boolean;
  onDirtyChange: (value: boolean) => void;
  onConfirmed: () => void;
}
function ReturnDiscrepancies({
  actor,
  evidenceRevision,
  target,
  current,
  events,
  disabled,
  onDirtyChange,
  onConfirmed,
}: DiscrepancyProps) {
  const api = useMemo(
    () =>
      createNativeReturnDiscrepancyApi(
        supabase as unknown as PrescriptionRpc,
        actor,
        target,
      ),
    [actor, target],
  );
  const [action, setAction] =
      useState<ReturnDiscrepancyIntent["action"]>("report"),
    [sourceId, setSourceId] = useState(""),
    [caseId, setCaseId] = useState(""),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [observation, setObservation] = useState(""),
    [correctionIds, setCorrectionIds] = useState<string[]>([]),
    [modified, setModified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnDiscrepancyPreview | null>(null),
    [ack, setAck] = useState(false),
    [confirmedOriginal, setConfirmedOriginal] = useState(false);
  const alive = useRef(true);
  const [reviewedLocal, setReviewedLocal] = useState<{
    revision: number;
    head: ReturnRead["head"];
    discrepancyHead: ReturnRead["head"];
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirtyChange(false);
    };
  }, [onDirtyChange]);
  const operation = usePrescriptionOperation({
    actor,
    patientId: target.pet_id,
    execute: api.execute,
    recover: api.recover,
    onConfirmed: () => {
      setModified(false);
      setPreview(null);
      setObservation("");
      setQuantities({});
      setCaseId("");
      setSourceId("");
      setCorrectionIds([]);
      setAck(false);
      setConfirmedOriginal(false);
      onConfirmed();
    },
  });
  const dirty = modified || operation.dirty;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const selectedCase = current.discrepancies.cases.find((c) => c.id === caseId);
  const source = events.find(
    (e) => e.id === (selectedCase?.source.event_id ?? sourceId),
  );
  const locked = disabled || busy || operation.dirty;
  const fresh =
    !preview ||
    (reviewedLocal?.revision === evidenceRevision &&
      correctionEqual(reviewedLocal.head, current.head) &&
      correctionEqual(
        reviewedLocal.discrepancyHead,
        current.discrepancies.head,
      ));
  async function review() {
    setBusy(true);
    setError("");
    setAck(false);
    setConfirmedOriginal(false);
    try {
      if (!source && !selectedCase)
        throw new Error(
          "Choose the exact source event; load earlier return history if necessary.",
        );
      const allocations = selectedCase
        ? selectedCase.allocations.map((a) => ({
            allocation_id: a.allocation_id,
            quantity: a.quantity,
          }))
        : Object.entries(quantities)
            .filter(([, v]) => v.trim())
            .map(([allocation_id, quantity]) => ({
              allocation_id,
              quantity: quantity.trim(),
            }))
            .sort((a, b) => a.allocation_id.localeCompare(b.allocation_id));
      const intent = discrepancyIntentSchema.parse({
        target,
        action,
        case_id: action === "report" ? null : caseId,
        source: selectedCase?.source ?? {
          event_id: source!.id,
          record_hash: source!.record_hash,
        },
        allocations,
        observation: observation.trim(),
        correction_ids:
          action === "resolve_corrected" ? [...correctionIds].sort() : [],
      });
      const p = await api.preview(intent);
      if (!alive.current) return;
      setPreview(p);
      setReviewedLocal({
        revision: evidenceRevision,
        head: current.head,
        discrepancyHead: current.discrepancies.head,
      });
      if (p.allowed)
        operation.review({
          id: crypto.randomUUID(),
          kind: "record_return_discrepancy",
          payload: {
            intent,
            expected_context_hash: p.context_hash,
            expected_return_head: p.context.return_head,
            expected_discrepancy_head: p.context.discrepancy_head,
            attest_physical_review: true,
            attest_original_quantities_custody_and_stock_accurate:
              action === "resolve_confirmed_original",
          },
        });
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Discrepancy review failed; your draft is retained.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded border p-3"
      aria-label="Return discrepancies"
    >
      <h5 className="font-medium">Physical quantity discrepancies</h5>
      <p>
        Record uncertain or conflicting physical facts for review. An open case
        holds its lots for review. A note does not correct quantities or remove
        the hold.
      </p>
      <p role="status">
        {current.discrepancies.open_case_count} open cases ·{" "}
        {current.discrepancies.held_lot_ids.length} lots held for review
      </p>
      {current.discrepancies.cases.map((c) => (
        <article className="rounded border p-2" key={c.id}>
          <p>
            Report {c.report.sequence} · {c.status.replace(/_/g, " ")}
          </p>
          <p>
            {c.report.actor.name} · {c.report.created_at}
          </p>
          <p className="whitespace-pre-wrap">{c.report.observation}</p>
          {c.allocations.map((a) => (
            <p key={a.allocation_id}>
              {current.allocations.find(
                (b) => b.allocation_id === a.allocation_id,
              )?.lot_number ?? a.lot_id}
              : {a.quantity}
            </p>
          ))}
          {c.decisions.map((d) => (
            <p key={d.id}>
              {d.action.replace(/_/g, " ")} · {d.actor.name}: {d.observation}
            </p>
          ))}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={locked} className="space-y-3">
        <label className="block">
          Discrepancy action
          <select
            aria-label="Discrepancy action"
            className="block w-full rounded border bg-background p-2"
            value={action}
            onChange={(e) => {
              setAction(e.target.value as ReturnDiscrepancyIntent["action"]);
              setCaseId("");
              setSourceId("");
              setCorrectionIds([]);
              setQuantities({});
              setPreview(null);
              setModified(true);
            }}
          >
            <option value="report">Report a physical discrepancy</option>
            <option value="note">Add a factual review note</option>
            <option value="resolve_corrected">
              Resolve with recorded quantity corrections
            </option>
            <option value="resolve_confirmed_original">
              DVM confirms original facts are accurate
            </option>
          </select>
        </label>
        {action === "report" ? (
          <label className="block">
            Disputed original event
            <select
              aria-label="Disputed original event"
              className="block w-full rounded border bg-background p-2"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setQuantities({});
                setModified(true);
              }}
            >
              <option value="">Choose the exact original claim</option>
              {events
                .filter((e) => !e.action.startsWith("retract_"))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    Event {e.sequence} · {e.action} · {e.reason}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label className="block">
            Open discrepancy
            <select
              aria-label="Open discrepancy"
              className="block w-full rounded border bg-background p-2"
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                setCorrectionIds([]);
                setModified(true);
              }}
            >
              <option value="">Choose an open case</option>
              {current.discrepancies.cases
                .filter((c) => c.status === "open")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    Report {c.report.sequence} · {c.report.observation}
                  </option>
                ))}
            </select>
          </label>
        )}
        {action === "report" &&
          source?.allocations.map((a) => (
            <label key={a.allocation_id} className="block">
              Disputed quantity for lot{" "}
              {current.allocations.find(
                (b) => b.allocation_id === a.allocation_id,
              )?.lot_number ?? a.lot_id}{" "}
              · original claim {a.quantity}
              <Input
                aria-label={`Disputed quantity ${a.allocation_id}`}
                inputMode="decimal"
                value={quantities[a.allocation_id] ?? ""}
                onChange={(e) => {
                  setQuantities((old) => ({
                    ...old,
                    [a.allocation_id]: e.target.value,
                  }));
                  setModified(true);
                }}
              />
            </label>
          ))}
        {selectedCase && (
          <p>
            Selected report quantities and source remain fixed for every review
            decision.
          </p>
        )}
        {action === "resolve_corrected" && (
          <>
            <p>
              Select the actual recorded corrections linked to this case. Their
              quantities must exactly cover this report; free text cannot
              substitute for completed corrections.
            </p>
            {events
              .filter(
                (e) =>
                  e.version === 2 &&
                  e.discrepancy_id === caseId &&
                  e.action.startsWith("retract_"),
              )
              .map((e) => (
                <label key={e.id} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={correctionIds.includes(e.id)}
                    onChange={(v) => {
                      setCorrectionIds((old) =>
                        v.target.checked
                          ? [...old, e.id]
                          : old.filter((id) => id !== e.id),
                      );
                      setModified(true);
                    }}
                  />
                  Correction {e.sequence} · {e.reason}
                </label>
              ))}
          </>
        )}
        <p className="text-sm text-muted-foreground">
          Observations become part of the patient record and may be included in
          records shared with the client.
        </p>
        <label className="block">
          Physical review observation
          <Textarea
            value={observation}
            onChange={(e) => {
              setObservation(e.target.value);
              setModified(true);
            }}
          />
        </label>
        <p>
          This attributed observation is shareable in selected client medical
          records. Quantity corrections, financial adjustments and prescription
          allowance remain separate.
        </p>
        <Button onClick={() => void review()}>
          Review discrepancy evidence
        </Button>
      </fieldset>
      {preview && (
        <section
          aria-label="Reviewed discrepancy evidence"
          className="space-y-2 rounded border p-3"
        >
          <p>{preview.context.intent.action.replace(/_/g, " ")}</p>
          <p>{preview.context.intent.observation}</p>
          {preview.context.intent.allocations.map((a) => (
            <p key={a.allocation_id}>
              {current.allocations.find(
                (b) => b.allocation_id === a.allocation_id,
              )?.lot_number ?? a.allocation_id}
              : {a.quantity}
            </p>
          ))}
          {!preview.allowed && (
            <div role="alert">
              {preview.blockers.map((b) => (
                <p key={b}>
                  {blockerLabels[b] ?? `Additional review required: ${b}`}
                </p>
              ))}
            </div>
          )}
          {!fresh && (
            <p role="status">
              Physical evidence changed; discard this review and review the
              retained draft again.
            </p>
          )}
          {operation.state.phase === "review" && (
            <>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={disabled}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I reviewed the exact source, quantities and current physical
                evidence.
              </label>
              {action === "resolve_confirmed_original" && (
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={confirmedOriginal}
                    disabled={disabled}
                    onChange={(e) => setConfirmedOriginal(e.target.checked)}
                  />
                  As the reviewing DVM, I confirm the original quantities,
                  custody and stock records are accurate.
                </label>
              )}
            </>
          )}
        </section>
      )}
      <fieldset disabled={disabled}>
        <PrescriptionOperationControls
          state={operation.state}
          error={operation.error}
          notice={operation.notice}
          commitLabel="Save reviewed discrepancy decision"
          reviewConfirmed={
            ack &&
            fresh &&
            (action !== "resolve_confirmed_original" || confirmedOriginal)
          }
          onCommit={operation.commit}
          onRecover={operation.recoverOriginal}
          onDiscard={() => {
            operation.discard();
            setPreview(null);
            setAck(false);
            setConfirmedOriginal(false);
          }}
        />
      </fieldset>
      {modified && !operation.dirty && (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            setModified(false);
            setObservation("");
            setQuantities({});
            setCaseId("");
            setSourceId("");
            setPreview(null);
          }}
        >
          Discard discrepancy draft
        </Button>
      )}
    </section>
  );
}
