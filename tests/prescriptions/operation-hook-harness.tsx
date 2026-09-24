/* eslint-disable react-refresh/only-export-components -- Isolated browser harness exports lifecycle controls, not a production refresh boundary. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { usePrescriptionOperation } from "../../src/hub/features/prescriptions/usePrescriptionOperation";
interface Pending { actor: string; patientId: string; resolve: (value: string) => void; reject: (reason: unknown) => void }
export const evidence = { calls: [] as Pending[], confirmed: [] as string[], renders: [] as { actor: string; patientId: string; stateActor: string; statePatient: string; operation: string | null; error: string; notice: string }[] };
function Harness() {
  const [actor, setActor] = useState("actor-a"), [patientId, setPatient] = useState("patient-a");
  const operation = usePrescriptionOperation({ actor, patientId,
    execute: () => new Promise<string>((resolve, reject) => evidence.calls.push({ actor, patientId, resolve, reject })),
    recover: () => new Promise<string>((resolve, reject) => evidence.calls.push({ actor, patientId, resolve, reject })),
    onConfirmed: receipt => { evidence.confirmed.push(receipt); },
  });
  evidence.renders.push({ actor, patientId, stateActor: operation.state.actor, statePatient: operation.state.patientId, operation: operation.state.operation?.id ?? null, error: operation.error, notice: operation.notice });
  return <main><button onClick={() => setActor(value => value === "actor-a" ? "actor-b" : "actor-a")}>Switch actor</button><button onClick={() => setPatient(value => value === "patient-a" ? "patient-b" : "patient-a")}>Switch patient</button>
    <button onClick={() => operation.review({ id: `${actor}:${patientId}:request`, kind: "test", payload: { patient: patientId } })}>Review</button>
    <button onClick={() => void operation.commit()}>Commit</button><button onClick={() => void operation.recoverOriginal()}>Recover</button>
    <p data-testid="phase">{operation.state.phase}</p><p data-testid="error">{operation.error}</p><p data-testid="notice">{operation.notice}</p><p data-testid="identity">{actor}:{patientId}</p></main>;
}
export function mount() { createRoot(document.getElementById("root")!).render(<Harness />); }
