import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  pendingPolicySchema,
  recapPolicyRequestSchema,
  recapPolicySchema,
} from "./model";
import { saveRecapPolicy, recoverRecapPolicy, cancelRecapPolicy } from "./api";
import { RecapFeedback } from "./RecapFeedback";
interface RecapPolicyProps {
  actor: string;
  policy: z.infer<typeof recapPolicySchema>;
  canManage: boolean;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}
export function RecapPolicy({
  actor,
  policy,
  canManage,
  blocked,
  onDirtyChange,
  onBusyChange,
}: RecapPolicyProps) {
  const prefix = useId(),
    cache = useQueryClient(),
    lock = useRef(false),
    request = useRef<z.infer<typeof recapPolicyRequestSchema> | null>(null),
    key = `lrv:recap-policy:${actor}`;
  const [base, setBase] = useState(policy),
    [consent, setConsent] = useState(policy.consent_text),
    [retention, setRetention] = useState(policy.retention_text),
    [status, setStatus] = useState<"draft" | "approved">(policy.status),
    [attested, setAttested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(""),
    [formError, setFormError] = useState("");
  const [invalidStorage] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw && pendingPolicySchema.parse(JSON.parse(raw)).actor_id !== actor)
        throw Error();
      return false;
    } catch {
      return true;
    }
  });
  const [pending, setPending] = useState<z.infer<
    typeof pendingPolicySchema
  > | null>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      const value = raw ? pendingPolicySchema.parse(JSON.parse(raw)) : null;
      return value?.actor_id === actor ? value : null;
    } catch {
      return null;
    }
  });
  const dirty =
    consent !== base.consent_text ||
    retention !== base.retention_text ||
    status !== base.status ||
    attested;
  const localState = useRef({ dirty, pending });
  localState.current = { dirty, pending };
  useEffect(() => {
    setAttested(false);
    if (!localState.current.dirty && !localState.current.pending) {
      setBase(policy);
      setConsent(policy.consent_text);
      setRetention(policy.retention_text);
      setStatus(policy.status);
    }
  }, [policy]);
  useEffect(() => {
    onDirtyChange(dirty || !!pending || busy || invalidStorage);
    return () => onDirtyChange(false);
  }, [dirty, pending, busy, invalidStorage, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  function persist(value: z.infer<typeof pendingPolicySchema> | null) {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  }
  async function finish(resultingPolicy: z.infer<typeof recapPolicySchema>) {
    persist(null);
    request.current = null;
    setAttested(false);
    setBase(resultingPolicy);
    setConsent(resultingPolicy.consent_text);
    setRetention(resultingPolicy.retention_text);
    setStatus(resultingPolicy.status);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["clinical-recap-policy", actor] }),
      cache.invalidateQueries({ queryKey: ["clinical-recap-history", actor] }),
    ]);
  }
  async function run(mode: "save" | "recover" | "cancel") {
    if (lock.current || invalidStorage) return;
    let action = pending;
    if (mode === "save" && !action) {
      const parsed = recapPolicyRequestSchema.safeParse({
        expected_version: base.version,
        status,
        consent_text: consent,
        retention_text: retention,
        attest_reviewed: attested,
      });
      if (!canManage || blocked || !parsed.success) {
        setFormError(
          "Review the policy wording and required approval attestation before saving.",
        );
        return;
      }
      request.current = parsed.data;
      action = {
        actor_id: actor,
        action_id: crypto.randomUUID(),
        expected_version: base.version,
      };
    }
    if (!action) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    setFormError("");
    try {
      persist(action);
      const existing = await recoverRecapPolicy(
        actor,
        action.action_id,
        action.expected_version,
        request.current,
      );
      if (existing) {
        await finish(existing.policy);
        setNotice(
          "Original policy action recovered. Its resulting version remains in the audit history.",
        );
      } else if (mode === "cancel") {
        const receipt = await cancelRecapPolicy(
          actor,
          action.action_id,
          action.expected_version,
          request.current,
        );
        await finish(receipt.receipt?.policy ?? policy);
        setNotice(
          receipt.cancelled
            ? "Unconfirmed policy action canceled before editing."
            : "The original policy action had already committed and was recovered.",
        );
      } else if (mode === "save" && request.current && canManage) {
        const receipt = await saveRecapPolicy(
          actor,
          action.action_id,
          request.current,
        );
        await finish(receipt.policy);
        setNotice(
          "Independent recap policy saved. This does not activate audio or note processing.",
        );
      } else
        setNotice(
          "No committed policy receipt found. Cancel this unconfirmed action durably before editing.",
        );
    } catch (failure) {
      setError(failure);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const disabled = blocked || !canManage || busy || !!pending || invalidStorage;
  return (
    <details
      aria-label="Recap processing policy"
      className="min-w-0 rounded-lg border border-border p-4"
    >
      <summary className="min-h-11 cursor-pointer font-semibold">
        Independent recap processing policy · {policy.status} · v
        {policy.version}
      </summary>
      <div className="mt-3 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">
          Recap processing has its own practice approval and backend activation
          gate. Note/audio approvals do not enable it. Actual staff and reviewer
          attribution remain recorded.
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">
          {policy.consent_text}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">
          Retention: {policy.retention_text}
        </p>
        <p className="break-words text-xs text-muted-foreground">
          Model {policy.generation_model} · reviewer{" "}
          {policy.reviewed_by ?? "Not approved"} ·{" "}
          {policy.reviewed_at ?? "No review time"}
        </p>
        <RecapFeedback error={error} />
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        {invalidStorage && (
          <p role="alert" className="text-sm text-destructive">
            The stored policy recovery identifiers could not be validated.
            Editing stays blocked until this pending state is resolved.
          </p>
        )}
        {pending && (
          <div className="space-y-2">
            <p className="text-sm">
              Resolve the original policy action before editing. Recovery and
              cancellation remain available to its owner after an ADMIN role
              change.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run("recover")}
              >
                Recover original recap policy action
              </Button>
              {request.current && canManage && (
                <Button disabled={busy} onClick={() => void run("save")}>
                  Retry exact recap policy action
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run("cancel")}
              >
                Cancel unconfirmed recap policy action
              </Button>
            </div>
          </div>
        )}
        {canManage && (
          <fieldset disabled={disabled} className="min-w-0 space-y-3">
            <legend className="font-medium">
              Review policy version {base.version}
            </legend>
            <Label htmlFor={`${prefix}-consent`}>
              Recap consent and permitted use
            </Label>
            <Textarea
              id={`${prefix}-consent`}
              rows={4}
              maxLength={4000}
              value={consent}
              onChange={(e) => {
                setConsent(e.target.value);
                setAttested(false);
              }}
            />
            <Label htmlFor={`${prefix}-retention`}>
              Recap retention disclosure
            </Label>
            <Textarea
              id={`${prefix}-retention`}
              rows={3}
              maxLength={2000}
              value={retention}
              onChange={(e) => {
                setRetention(e.target.value);
                setAttested(false);
              }}
            />
            <Label htmlFor={`${prefix}-status`}>Policy status</Label>
            <select
              id={`${prefix}-status`}
              className="min-h-11 w-full rounded-md border border-input bg-background p-2"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "draft" | "approved");
                setAttested(false);
              }}
            >
              <option value="draft">Draft — processing not approved</option>
              <option value="approved">Approved for recap processing</option>
            </select>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              I reviewed this exact recap policy with the practice approver.
            </label>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={!dirty || (status === "approved" && !attested)}
              onClick={() => void run("save")}
            >
              Save new recap policy version
            </Button>
            {policy.version !== base.version && (
              <p role="status" className="text-sm">
                The current policy changed while this form was edited. Local
                wording is retained; saving against the earlier version will
                require conflict resolution.
              </p>
            )}
          </fieldset>
        )}
      </div>
    </details>
  );
}
