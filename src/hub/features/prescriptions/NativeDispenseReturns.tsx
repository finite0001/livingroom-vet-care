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
  createNativeReturnsApi,
  returnIntentSchema,
  returnMilli,
  type ReturnIntent,
  type ReturnEvent,
  type ReturnPreview,
  type ReturnRead,
  type ReturnIntakeBalance,
} from "./fulfillment-returns-api";
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
  lot_expired: "One or more selected lots are expired on the practice date.",
};
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
        createNativeReturnsApi(
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
    [events, setEvents] = useState<ReturnEvent[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [observed, setObserved] = useState(-1),
    [policyStale, setPolicyStale] = useState(false);
  const [action, setAction] = useState<ReturnIntent["action"]>("intake"),
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
      setIntake(null);
      setPreview(null);
      setAck(false);
      setRestockAck(false);
      onConfirmed();
      void load();
    },
  });
  const dirty = modified || operation.dirty;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
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
      if (current && !correctionEqual(current.head, r.head)) setObserved(-1);
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
      const intent = returnIntentSchema.parse({
        target,
        action,
        intake_id: action === "intake" ? null : intakeId,
        allocations,
        custody: action === "intake" ? custody : null,
        package_condition: action === "intake" ? condition : null,
        storage_history: action === "intake" ? storage : null,
        reason: reason.trim(),
        note: note.trim(),
      });
      const p = await api.preview(intent);
      if (!alive.current) return;
      if (p.context.authorization_hash !== dispense.authorization_hash || p.context.dispensed_at !== dispense.dispensed_at || p.context.allocations.length !== dispense.allocations.length || p.context.allocations.some(a => !dispense.allocations.some(original => original.lot_id === a.lot_id && original.quantity === a.dispensed_quantity))) throw new Error("Return review differs from the selected original dispense allocations.");
      if (p.context.stock_review && p.blockers.includes("unit_changed") !== (p.context.stock_review.product.unit !== dispense.unit)) throw new Error("Current product unit evidence is inconsistent; refresh before restocking.");
      setPreview(p);
      setPolicyStale(false);
      setObserved(evidenceRevision);
      if (p.context.intake) setIntake(p.context.intake);
      if (p.allowed)
        operation.review({
          id: crypto.randomUUID(),
          kind: "record_return",
          payload: {
            intent,
            expected_context_hash: p.context_hash,
            expected_head: p.context.head,
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
  const locked = disabled || busy || operation.dirty;
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
      <h5 className="font-medium">Original allocation balances</h5>
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
          </select>
        </label>
        {action !== "intake" && (
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
          const available =
            action === "intake"
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
          <h5>Reviewed {preview.context.intent.action}</h5>
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
              <p>Restock is not permitted for this reviewed record:</p>
              <ul>
                {preview.blockers.map((b) => (
                  <li key={b}>{blockerLabels[b]}</li>
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
            ack && (action !== "restock" || restockAck) && !policyStale
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
            {e.action} · {e.actor.name} · {e.created_at}
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
          disabled={locked}
          onClick={() => void load(true)}
        >
          Load earlier return events
        </Button>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy || operation.locked}
        onClick={onClose}
      >
        Close return panel{dirty ? " and discard draft" : ""}
      </Button>
    </section>
  );
}
