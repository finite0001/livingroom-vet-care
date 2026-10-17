import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelCallPolicy, readCallPolicy, recoverCallPolicy, saveCallPolicy } from "./api";
import { callFeedback, callPolicyRequestSchema, pendingCallPolicySchema, type CallPolicy, type CallPolicyRequest, type PendingCallPolicy } from "./model";
interface CallSourcePolicyProps {
  actor: string; policy: CallPolicy; blocked: boolean;
  onChanged: (policy: CallPolicy) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}
export function CallSourcePolicy({ actor, policy, blocked, onChanged, onDirtyChange, onBusyChange }: CallSourcePolicyProps) {
  const prefix = useId(), key = `lrv:call-policy:${actor}`, lock = useRef(false);
  const request = useRef<CallPolicyRequest | null>(null);
  const [base, setBase] = useState(policy), [consent, setConsent] = useState(policy.consent_text), [retention, setRetention] = useState(policy.retention_text), [status, setStatus] = useState(policy.status), [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState("");
  const [stored] = useState(() => {
    try { const raw = sessionStorage.getItem(key); const value = raw ? pendingCallPolicySchema.parse(JSON.parse(raw)) : null; if (value && value.actor_id !== actor) throw Error(); return { value, invalid: false }; }
    catch { return { value: null, invalid: true }; }
  });
  const [pending, setPending] = useState<PendingCallPolicy | null>(stored.value);
  const [invalidStorage, setInvalidStorage] = useState(stored.invalid);
  const dirty = consent !== base.consent_text || retention !== base.retention_text || status !== base.status || attested;
  const local = useRef({ dirty, pending }); local.current = { dirty, pending };
  useEffect(() => { if (!local.current.dirty && !local.current.pending) { setBase(policy); setConsent(policy.consent_text); setRetention(policy.retention_text); setStatus(policy.status); } }, [policy]);
  useEffect(() => { onDirtyChange(dirty || !!pending || busy || invalidStorage); return () => onDirtyChange(false); }, [dirty, pending, busy, invalidStorage, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  function persist(value: PendingCallPolicy | null) { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); setPending(value); }
  function finish(value: CallPolicy) { persist(null); request.current = null; setBase(value); setConsent(value.consent_text); setRetention(value.retention_text); setStatus(value.status); setAttested(false); onChanged(value); }
  async function run(mode: "save" | "recover" | "cancel") {
    if (lock.current || invalidStorage || (mode === "save" && blocked)) return;
    let action = pending;
    if (mode === "save" && !action) {
      const parsed = callPolicyRequestSchema.safeParse({ expected_version: base.version, status, consent_text: consent, retention_text: retention, attest_reviewed: attested });
      if (!parsed.success) { setNotice("Complete the policy wording and required approval attestation before saving."); return; }
      request.current = parsed.data; action = { actor_id: actor, action_id: crypto.randomUUID(), expected_version: base.version };
    }
    if (!action) return;
    lock.current = true; setBusy(true); setError(null); setNotice("");
    try {
      persist(action);
      const recovered = await recoverCallPolicy(action, request.current);
      if (recovered) { finish(recovered); setNotice("Original call policy action recovered."); }
      else if (mode === "cancel") {
        const cancelled = await cancelCallPolicy(action);
        if (cancelled.cancelled) { finish(await readCallPolicy(actor)); setNotice("Unconfirmed call policy action canceled before editing."); }
        else { const saved = await recoverCallPolicy(action, request.current); if (saved) finish(saved); else throw Error(); }
      } else if (mode === "save" && request.current) { finish(await saveCallPolicy(action, request.current)); setNotice("Independent call-source policy saved. Backend capture activation is a separate step."); }
      else setNotice("No committed policy receipt found. Cancel this action durably before editing.");
    } catch (failure) { setError(failure); }
    finally { lock.current = false; setBusy(false); }
  }
  async function discardInvalidLocalData() {
    if (lock.current || !window.confirm("Discard invalid local call-policy recovery data? This does not cancel a remote policy action. Review the current policy before editing.")) return;
    lock.current = true; setBusy(true); setError(null);
    try { sessionStorage.removeItem(key); finish(await readCallPolicy(actor)); setInvalidStorage(false); setNotice("Invalid local policy recovery data discarded. No remote action was canceled. Review the current policy before editing."); }
    catch (failure) { setError(failure); }
    finally { lock.current = false; setBusy(false); }
  }
  const disabled = blocked || busy || !!pending || invalidStorage;
  return <details aria-label="Call source policy" className="min-w-0 rounded-lg border border-border p-3">
    <summary className="min-h-11 cursor-pointer font-medium">Independent call-source policy · {policy.status} · v{policy.version}</summary>
    <div className="min-w-0 space-y-3 pt-3">
      <p className="text-sm text-muted-foreground">Call evidence needs its own consent, permitted-use and retention approval. Clinician dictation approval does not authorize household calls. Saving this policy does not activate the backend capture gate or AI processing.</p>
      <p className="break-words text-xs text-muted-foreground">Reviewer {policy.reviewed_by ?? "Not approved"} · {policy.reviewed_at ?? "No review time"}</p>
      {error && <p role="alert" className="text-sm text-destructive">{callFeedback(error)}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {invalidStorage && <p role="alert" className="text-sm text-destructive">Stored call-policy recovery identifiers could not be validated. Editing remains blocked until this local state is resolved.</p>}
      {invalidStorage && <Button variant="outline" disabled={busy} onClick={() => void discardInvalidLocalData()}>Discard invalid local call policy recovery data</Button>}
      {pending && <section aria-label="Unconfirmed call policy action" className="space-y-2">
        <p className="text-sm">Resolve the original policy action before editing its wording.</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void run("recover")}>Recover original call policy action</Button>{request.current && <Button disabled={busy || blocked} onClick={() => void run("save")}>Retry exact call policy action</Button>}<Button variant="outline" disabled={busy} onClick={() => void run("cancel")}>Cancel unconfirmed call policy action</Button></div>
      </section>}
      <fieldset disabled={disabled} className="min-w-0 space-y-3"><legend className="font-medium">Review call-source policy</legend>
        <Label htmlFor={`${prefix}-consent`}>Call consent and permitted use</Label><Textarea id={`${prefix}-consent`} rows={4} maxLength={4000} value={consent} onChange={(event) => setConsent(event.target.value)} />
        <Label htmlFor={`${prefix}-retention`}>Call transcript retention</Label><Textarea id={`${prefix}-retention`} rows={3} maxLength={2000} value={retention} onChange={(event) => setRetention(event.target.value)} />
        <Label htmlFor={`${prefix}-status`}>Call policy status</Label><select id={`${prefix}-status`} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value as "draft" | "approved")}><option value="draft">Draft for Susan’s review</option><option value="approved">Approved after practice review</option></select>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />I reviewed call consent, retention and the distinction between private full-call evidence and reviewed chart sections.</label>
        <div className="flex flex-wrap gap-2"><Button disabled={!dirty} onClick={() => void run("save")}>Save call-source policy</Button><Button variant="outline" disabled={!dirty} onClick={() => { setConsent(base.consent_text); setRetention(base.retention_text); setStatus(base.status); setAttested(false); }}>Discard unsaved call policy edits</Button></div>
      </fieldset>
    </div>
  </details>;
}
