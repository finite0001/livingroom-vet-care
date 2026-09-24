import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { useUnsavedChanges } from "../clinical/use-unsaved-changes";
import {
  createNativeReturnPolicyApi,
  returnPolicyRequestSchema,
  type ReturnPolicy,
} from "./fulfillment-returns-api";
import type { PrescriptionRpc } from "./prescription-api";
import { usePrescriptionOperation } from "./usePrescriptionOperation";
import { PrescriptionOperationControls } from "./PrescriptionOperationControls";
export function NativeReturnPolicySettings() {
  const { user, hasRole } = useAuth();
  return user ? (
    <PolicyWorkspace
      key={user.id}
      actor={user.id}
      canConfigure={hasRole("ADMIN") && hasRole("DVM")}
    />
  ) : null;
}
interface PolicyWorkspaceProps {
  actor: string;
  canConfigure: boolean;
}
function PolicyWorkspace({ actor, canConfigure }: PolicyWorkspaceProps) {
  const cache = useQueryClient(),
    api = useMemo(
      () =>
        createNativeReturnPolicyApi(
          supabase as unknown as PrescriptionRpc,
          actor,
        ),
      [actor],
    );
  const alive = useRef(true);
  const [policy, setPolicy] = useState<ReturnPolicy | null>(null),
    [enabled, setEnabled] = useState(false),
    [reference, setReference] = useState(""),
    [modified, setModified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ack, setAck] = useState(false);
  const operation = usePrescriptionOperation({
    actor,
    patientId: "practice:return-policy",
    execute: api.execute,
    recover: api.recover,
    onConfirmed: (r) => {
      setPolicy(r.result);
      setEnabled(r.result.enabled);
      setReference("");
      setModified(false);
      setAck(false);
      void cache.invalidateQueries({ queryKey: ["native-return-policy"] });
    },
  });
  const guard = useUnsavedChanges(modified || operation.dirty);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const p = await api.read();
      if (alive.current) {
        setPolicy(p);
        if (!modified) setEnabled(p.enabled);
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Policy could not be loaded.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    }; /* actor-keyed workspace owns read */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  function review() {
    setError("");
    setAck(false);
    try {
      if (!policy) throw new Error("Load current policy first.");
      const request = returnPolicyRequestSchema.parse({
        expected_version: policy.version,
        enabled,
        review_reference: reference.trim(),
        attest_review: true,
      });
      operation.review({
        id: crypto.randomUUID(),
        kind: "configure_return_policy",
        payload: request,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Review reference is required.",
      );
    }
  }
  return (
    <section
      className="space-y-3 rounded border p-4"
      aria-label="Native return policy"
    >
      <h2 className="font-semibold">Return to available stock policy</h2>
      <p>
        This native pathway is disabled until explicitly reviewed. It does not
        authorize reuse of all returned medication or replace Dr. Edler’s
        clinical review. General audited inventory adjustment remains a separate
        workflow.
      </p>
      {policy && (
        <p>
          {policy.enabled ? "Enabled with restrictive checks" : "Disabled"} ·
          revision {policy.version}
          {policy.review_reference && ` · ${policy.review_reference}`}{" "}
          {policy.actor_name &&
            ` · reviewed by ${policy.actor_name} at ${policy.reviewed_at}`}
        </p>
      )}
      {!canConfigure && (
        <p>
          Changing this policy requires both active administrator and DVM roles.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={busy || operation.dirty}
        onClick={() => void load()}
      >
        Refresh return policy
      </Button>
      <fieldset
        disabled={!canConfigure || busy || !policy || operation.dirty}
        className="space-y-3"
      >
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setModified(true);
            }}
          />
          Enable guarded native restocking
        </label>
        <label className="block">
          Policy review reference
          <Textarea
            value={reference}
            onChange={(e) => {
              setReference(e.target.value);
              setModified(true);
            }}
          />
        </label>
        <p>
          Every restock still requires an active DVM, clinic-retained custody,
          sealed intact packaging, controlled storage, no original pickup, an
          active matching-unit product and unexpired lots.
        </p>
        <Button onClick={review}>Review return policy decision</Button>
      </fieldset>
      {operation.state.phase === "review" && (
        <div className="space-y-2">
          <p>
            Proposed policy:{" "}
            {enabled ? "enable guarded restocking" : "disable restocking"}.
            Review: {reference.trim()}
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed the practice policy, its restrictive native software
            checks and the recorded review reference. This is an explicit
            practice decision.
          </label>
        </div>
      )}
      <PrescriptionOperationControls
        state={operation.state}
        error={operation.error}
        notice={operation.notice}
        commitLabel="Save reviewed return policy"
        reviewConfirmed={ack && canConfigure}
        onCommit={operation.commit}
        onRecover={operation.recoverOriginal}
        onDiscard={() => {
          operation.discard();
          setAck(false);
        }}
      />
      {guard}
    </section>
  );
}
