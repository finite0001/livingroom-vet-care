import { Button } from "@/components/ui/button";
import type { PrescriptionOperationState } from "./prescription-state";
interface Props {
  state: PrescriptionOperationState;
  error: string;
  notice: string;
  commitLabel: string;
  reviewConfirmed: boolean;
  onCommit: () => Promise<void>;
  onRecover: () => Promise<void>;
  onDiscard: () => void;
}
export function PrescriptionOperationControls({ state, error, notice, commitLabel, reviewConfirmed, onCommit, onRecover, onDiscard }: Props) {
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-clinical-alert">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {state.operation && <p className="break-all text-xs text-muted-foreground">Operation reference: {state.operation.id}</p>}
    {state.phase === "review" && <div className="flex flex-wrap gap-2"><Button type="button" disabled={!reviewConfirmed} onClick={() => void onCommit()}>{commitLabel}</Button><Button type="button" variant="outline" onClick={onDiscard}>Return to editing</Button></div>}
    {["committing", "recovering"].includes(state.phase) && <p role="status">{state.phase === "committing" ? "Saving the exact reviewed operation…" : "Recovering the original operation…"}</p>}
    {["uncertain", "retryable"].includes(state.phase) && <>
      <p className="text-sm">Keep this request until its saved result is confirmed. Leaving does not cancel a transaction. An uncertain result is not permission to prepare a second operation.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void onRecover()}>Recover original operation</Button>{state.phase === "retryable" && <Button type="button" onClick={() => void onCommit()}>Retry identical operation</Button>}</div>
    </>}
  </div>;
}
