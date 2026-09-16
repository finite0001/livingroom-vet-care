import { useEffect, useRef, useState } from "react";
import { commitPrescriptionOperation, discardPrescriptionReview, emptyPrescriptionOperation, prescriptionOperationConfirmed, prescriptionOperationFailed, prescriptionOperationLocked, prescriptionRecoveryAbsent, prescriptionRecoveryFailed, recoverPrescriptionOperation, reviewPrescriptionOperation } from "./prescription-state";
import type { PrescriptionOperation, PrescriptionOperationState } from "./prescription-state";
interface Options<Receipt> {
  actor: string;
  patientId: string;
  execute: (operation: Readonly<PrescriptionOperation>) => Promise<Receipt>;
  recover: (operation: Readonly<PrescriptionOperation>) => Promise<Receipt | null>;
  onConfirmed: (receipt: Receipt) => void;
}
/** execute/recover must validate exact server receipt identity before returning. */
export function usePrescriptionOperation<Receipt>({ actor, patientId, execute, recover, onConfirmed }: Options<Receipt>) {
  const [state, setState] = useState(() => emptyPrescriptionOperation(actor, patientId));
  const current = useRef(state), lock = useRef(false), alive = useRef(true);
  const identity = `${actor}:${patientId}`, activeIdentity = useRef(identity);
  const identityGeneration = useRef(0);
  if (activeIdentity.current !== identity) { activeIdentity.current = identity; identityGeneration.current += 1; }
  const generation = identityGeneration.current;
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  function update(next: PrescriptionOperationState) { current.current = next; setState(next); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { current.current = emptyPrescriptionOperation(actor, patientId); setState(current.current); setError(""); setNotice(""); }, [actor, patientId]);
  const valid = () => alive.current && activeIdentity.current === identity && identityGeneration.current === generation;
  function confirmedView(receipt: Receipt) {
    try { onConfirmed(receipt); }
    catch { setError("The operation is saved, but this view could not refresh. Reopen its saved history; do not submit a new operation."); }
  }
  function review(operation: PrescriptionOperation) {
    if (lock.current || current.current.actor !== actor || current.current.patientId !== patientId) return;
    update(reviewPrescriptionOperation(current.current, operation)); setError(""); setNotice("");
  }
  function discard() {
    if (lock.current) return;
    const next = discardPrescriptionReview(current.current);
    if (next === current.current) return;
    update(next); setError(""); setNotice("");
  }
  async function commit() {
    if (lock.current || current.current.actor !== actor || current.current.patientId !== patientId) return;
    const pending = commitPrescriptionOperation(current.current);
    if (pending.phase !== "committing" || !pending.operation) return;
    const reply = { actor, patientId, operationId: pending.operation.id };
    lock.current = true; update(pending); setError(""); setNotice("");
    try {
      const receipt = await execute(pending.operation);
      if (!valid()) return;
      update(prescriptionOperationConfirmed(pending, reply));
      setNotice("The saved operation was confirmed."); confirmedView(receipt);
    } catch (failure) {
      if (!valid()) return;
      const next = prescriptionOperationFailed(pending, reply, failure); update(next);
      setError(next.phase === "editing" ? "The server rejected this operation. Refresh its current evidence and review again; your draft is retained." : "The operation result is uncertain. Recover the original request before retrying. Its reviewed values are locked.");
    } finally { lock.current = false; }
  }
  async function recoverOriginal() {
    if (lock.current || current.current.actor !== actor || current.current.patientId !== patientId) return;
    const pending = recoverPrescriptionOperation(current.current);
    if (pending.phase !== "recovering" || !pending.operation) return;
    const reply = { actor, patientId, operationId: pending.operation.id };
    lock.current = true; update(pending); setError(""); setNotice("");
    try {
      const receipt = await recover(pending.operation);
      if (!valid()) return;
      if (receipt === null) {
        update(prescriptionRecoveryAbsent(pending, reply));
        setNotice("No saved receipt was found yet. Check again or retry this identical request. The original transaction may still be running.");
      } else {
        update(prescriptionOperationConfirmed(pending, reply));
        setNotice("The original saved operation was recovered."); confirmedView(receipt);
      }
    } catch {
      if (valid()) { update(prescriptionRecoveryFailed(pending, reply)); setError("Recovery could not be confirmed. Keep the original request and check again."); }
    } finally { lock.current = false; }
  }
  return { state, error, notice, review, discard, commit, recoverOriginal, locked: prescriptionOperationLocked(state), dirty: state.phase === "review" || prescriptionOperationLocked(state) };
}
