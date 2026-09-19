import { useEffect, useRef, useState } from "react";
import type { FinanceCloseResult, FinanceReceipt } from "./dispense-finance-api";
import {
  clearFinanceIntent,
  financeOperationFailed,
  loadFinanceIntent,
  persistFinanceIntent,
  restoredFinanceState,
  type DispenseFinanceTarget,
} from "./dispense-finance-state";
import {
  commitPrescriptionOperation,
  discardPrescriptionReview,
  emptyPrescriptionOperation,
  prescriptionOperationConfirmed,
  prescriptionOperationLocked,
  prescriptionRecoveryAbsent,
  prescriptionRecoveryFailed,
  recoverPrescriptionOperation,
  reviewPrescriptionOperation,
  type PrescriptionOperation,
  type PrescriptionOperationState,
} from "./prescription-state";
interface Options {
  actor: string;
  target: DispenseFinanceTarget;
  parseOperation: (value: unknown) => Readonly<PrescriptionOperation>;
  execute: (op: Readonly<PrescriptionOperation>) => Promise<FinanceReceipt>;
  recover: (op: Readonly<PrescriptionOperation>) => Promise<FinanceReceipt | null>;
  close: (op: Readonly<PrescriptionOperation>) => Promise<FinanceCloseResult>;
  onConfirmed: (receipt: FinanceReceipt) => void;
  onClosed: () => void;
}
/** Parent mounts a new keyed workspace for actor/target changes; late replies never clear stored intent. */
export function useDispenseFinanceOperation({
  actor,
  target,
  parseOperation,
  execute,
  recover,
  close,
  onConfirmed,
  onClosed,
}: Options) {
  const identity = `${actor}:${target.authorization_id}:${target.pet_id}:${target.dispense_id}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [initial] = useState(() => {
    try {
      return {
        state: restoredFinanceState(
          actor,
          target,
          loadFinanceIntent(sessionStorage, actor, target, parseOperation),
        ),
        blocked: false,
        error: "",
      };
    } catch (e) {
      return {
        state: emptyPrescriptionOperation(actor, target.pet_id),
        blocked: true,
        error:
          e instanceof Error
            ? e.message
            : "Saved financial intent could not be verified.",
      };
    }
  });
  const [state, setState] = useState(initial.state),
    [error, setError] = useState(initial.error),
    [notice, setNotice] = useState(
      initial.state.phase === "uncertain"
        ? "An earlier financial request needs recovery. Its exact reviewed values are retained."
        : "",
    ),
    [storageBlocked, setStorageBlocked] = useState(initial.blocked);
  const current = useRef(state),
    alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const valid = () => alive.current && identityRef.current === identity;
  function update(next: PrescriptionOperationState) {
    current.current = next;
    setState(next);
  }
  function review(op: Readonly<PrescriptionOperation>) {
    if (!valid() || lock.current || storageBlocked) return;
    try {
      parseOperation(op);
      if (loadFinanceIntent(sessionStorage, actor, target, parseOperation))
        throw new Error("Recover the earlier financial request first.");
      update(reviewPrescriptionOperation(current.current, op));
      setError("");
      setNotice("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Financial review could not be prepared.",
      );
    }
  }
  function discard() {
    if (!valid() || lock.current || storageBlocked) return;
    update(discardPrescriptionReview(current.current));
    setError("");
    setNotice("");
  }
  function confirm(pending: PrescriptionOperationState, receipt: FinanceReceipt) {
    const op = pending.operation!;
    try {
      clearFinanceIntent(sessionStorage, actor, target, op, parseOperation);
    } catch {
      setStorageBlocked(true);
      setError(
        "The operation is saved, but its browser recovery record could not be cleared. Do not create a replacement request.",
      );
    }
    update(
      prescriptionOperationConfirmed(pending, {
        actor,
        patientId: target.pet_id,
        operationId: op.id,
      }),
    );
    setNotice("The exact financial operation was confirmed in the ledger.");
    try {
      onConfirmed(receipt);
    } catch {
      setError(
        "The operation is saved, but related views could not refresh. Reopen its history; do not submit a replacement.",
      );
    }
  }
  async function commit() {
    if (!valid() || lock.current || storageBlocked) return;
    const pending = commitPrescriptionOperation(current.current);
    if (pending.phase !== "committing" || !pending.operation) return;
    const op = pending.operation;
    try {
      persistFinanceIntent(sessionStorage, actor, target, op, parseOperation);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Recovery storage is unavailable; no financial request was sent.",
      );
      return;
    }
    lock.current = true;
    update(pending);
    setError("");
    setNotice("");
    try {
      const receipt = await execute(op);
      if (valid()) confirm(pending, receipt);
    } catch (failure) {
      if (!valid()) return;
      const next = financeOperationFailed(
        pending,
        { actor, patientId: target.pet_id, operationId: op.id },
        failure,
      );
      if (next.phase === "editing") {
        try {
          clearFinanceIntent(sessionStorage, actor, target, op, parseOperation);
        } catch {
          setStorageBlocked(true);
        }
      }
      update(next);
      setError(
        next.phase === "editing"
          ? "The server rejected this operation. Review current evidence again; your draft is retained."
          : "The financial result is uncertain. Recover this original request before retrying; its values remain locked.",
      );
    } finally {
      lock.current = false;
    }
  }
  async function recoverOriginal() {
    if (!valid() || lock.current || storageBlocked) return;
    const pending = recoverPrescriptionOperation(current.current);
    if (pending.phase !== "recovering" || !pending.operation) return;
    lock.current = true;
    update(pending);
    setError("");
    try {
      const receipt = await recover(pending.operation);
      if (!valid()) return;
      if (receipt === null) {
        update(
          prescriptionRecoveryAbsent(pending, {
            actor,
            patientId: target.pet_id,
            operationId: pending.operation.id,
          }),
        );
        setNotice(
          "No receipt found yet. Recover again or retry this identical request; the earlier transaction may still complete.",
        );
      } else confirm(pending, receipt);
    } catch {
      if (valid()) {
        update(
          prescriptionRecoveryFailed(pending, {
            actor,
            patientId: target.pet_id,
            operationId: pending.operation!.id,
          }),
        );
        setError(
          "Recovery could not be verified. The original request remains saved; do not replace it.",
        );
      }
    } finally {
      lock.current = false;
    }
  }
  async function closeOriginal() {
    if (!valid() || lock.current || storageBlocked) return;
    const pending = recoverPrescriptionOperation(current.current);
    if (pending.phase !== "recovering" || !pending.operation) return;
    lock.current = true;
    update(pending);
    setError("");
    setNotice("");
    try {
      const resolution = await close(pending.operation);
      if (!valid()) return;
      if (resolution.status === "recorded") {
        confirm(pending, resolution.receipt);
      } else {
        // Only the validated durable server closure makes abandoning this UUID safe.
        // If storage cleanup fails, retain the original recovery state for retry.
        clearFinanceIntent(sessionStorage, actor, target, pending.operation, parseOperation);
        update(emptyPrescriptionOperation(actor, target.pet_id));
        setNotice("The original request was closed without recording a financial operation. Review current evidence before starting again.");
        onClosed();
      }
    } catch {
      if (valid()) {
        update(prescriptionRecoveryFailed(pending, {
          actor, patientId: target.pet_id, operationId: pending.operation.id,
        }));
        setError("The resolution could not be verified or its browser record could not be cleared. Resolve this same request again before starting another.");
      }
    } finally {
      lock.current = false;
    }
  }
  return {
    state,
    error,
    notice,
    storageBlocked,
    review,
    discard,
    commit,
    recoverOriginal,
    closeOriginal,
    locked: storageBlocked || prescriptionOperationLocked(state),
    dirty:
      storageBlocked ||
      state.phase === "review" ||
      prescriptionOperationLocked(state),
  };
}
