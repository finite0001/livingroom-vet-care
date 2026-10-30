import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { CountClient } from "./count-client.ts";
import type { CountOperationController } from "./count-operation-controller.ts";
import type { CountPolicyPublishRequest, CountPolicyPublishReceipt, CountPolicyReply } from "./count-admin-schema.ts";
import { CountPolicyForm } from "./CountPolicyForm";

interface CountPolicyWorkspaceProps {
  readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: CountClient; readonly operations: CountOperationController;
  readonly productId: string; readonly siteId: string;
}
export function CountPolicyWorkspace({ sessions, identity, client, operations, productId, siteId }: CountPolicyWorkspaceProps) {
  const [policy, setPolicy] = useState<CountPolicyReply | null>(null), [receipt, setReceipt] = useState<CountPolicyPublishReceipt | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [, revise] = useState(0);
  const alive = useRef(true), latch = useRef(false), attempted = useRef<string | null>(null);
  const draftDirty = useRef(false);
  useEffect(() => {
    alive.current = true;
    const change = () => { if (alive.current) revise(value => value + 1); };
    window.addEventListener("storage", change); window.addEventListener("focus", change);
    return () => { alive.current = false; window.removeEventListener("storage", change); window.removeEventListener("focus", change); };
  }, []);
  const active = () => alive.current && sessions.isCurrent(identity);
  let pending: ReturnType<CountOperationController["pending"]> = null, blocked = false;
  try { pending = operations.pending(identity.actorId); } catch { blocked = true; }
  async function run(work: () => Promise<void>, propagate = false) {
    if (latch.current || !active()) { if (propagate) throw new ControlledOperationNotSentError(); return; }
    latch.current = true; setBusy(true); setMessage("");
    try { await work(); }
    catch (error) {
      if (active()) setMessage(error instanceof ControlledOperationNotSentError ? "This publication was not sent. Wait for the other action, then publish deliberately." : "The result could not be confirmed. Recover any pending publication before continuing.");
      if (propagate) { if (error instanceof ControlledOperationNotSentError) throw error; throw new Error("Publication unconfirmed."); }
    } finally { latch.current = false; if (active()) { setBusy(false); revise(value => value + 1); } }
  }
  async function load() {
    const result = await client.policy({ schema_version: 1, actor_id: identity.actorId, product_id: productId, site_id: siteId }, identity);
    if (active()) { setPolicy(result); setReceipt(null); }
  }
  async function publish(request: CountPolicyPublishRequest) {
    attempted.current = request.operation_id;
    const result = await operations.publishPolicy(request, identity);
    if (active()) { setReceipt(result); setPolicy(null); setMessage(`Policy version ${result.result_ref.version} published.`); }
  }
  async function recover(mode: "read" | "close") {
    const result = await operations.recover(mode, identity);
    if (!active()) return;
    const sameScope = result.product_id === productId && result.site_id === siteId;
    if (result.state !== "pending" && (result.operation_id === attempted.current || (!draftDirty.current && sameScope && result.original_action === "policy_publish"))) {
      setPolicy(null); attempted.current = null;
    }
    if (sameScope && result.state === "saved" && result.receipt?.action === "policy_publish") setReceipt(result.receipt);
    setMessage(result.state === "pending" ? "No saved receipt yet. Check again, or close the attempt before starting over." : result.state === "saved" ? "The original action is recorded." : "The original attempt is closed without a save.");
  }
  return <section className="min-w-0 space-y-5" aria-label="Administrator count configuration">
    {message && <p role="status">{message}</p>}
    {blocked && <p role="alert" className="text-destructive">The saved-operation record cannot be read. Preserve this browser’s data and ask for recovery assistance.</p>}
    {pending && <section className="space-y-3 rounded-xl border p-4" aria-label="Pending configuration recovery"><h2 className="font-display text-lg">Check the previous action</h2>
      <p className="text-sm">Recover the original action before publishing settings. It may belong to another medication or site.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(() => recover("read"))}>Check original action</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void run(() => recover("close"))}>Close pending attempt</Button></div>
      <p className="text-xs text-muted-foreground">Closing preserves an existing save. Otherwise it prevents that attempt from saving later. Nothing is resubmitted.</p>
    </section>}
    {receipt && <div className="space-y-1 rounded-xl border p-4"><p className="font-medium">Published policy version {receipt.result_ref.version}</p><p className="break-all font-mono text-xs">Receipt: {receipt.receipt_digest}</p></div>}
    {!policy && <Button type="button" className="min-h-11" disabled={busy} onClick={() => void run(load)}>Read current settings</Button>}
    {policy && <CountPolicyForm key={policy.data.policy?.policy_id ?? "first-policy"} actorId={identity.actorId} productId={productId} siteId={siteId}
      policy={policy.data.policy} busy={busy} pending={!!pending || blocked} onDraftDirtyChange={value => { draftDirty.current = value; }} publish={request => run(() => publish(request), true)} />}
  </section>;
}
