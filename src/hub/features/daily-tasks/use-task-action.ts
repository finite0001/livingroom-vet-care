import { useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  prepareOperationalReview,
  executeOperationalReview,
  readOperationalReview,
  cancelOperationalReview,
} from "./task-api";
import {
  rememberOperationalReview,
  forgetOperationalReview,
  validateOperationalRequest,
  type OperationalMetadata,
  type OperationalRequest,
} from "./task-model";
import { operationalActionError } from "./task-ui";
import { verifyOperationalReceipt } from "./task-model";
export const operationalChangeEvent = "lrv:operational-review-change";
function changed() {
  window.dispatchEvent(new Event(operationalChangeEvent));
}
export type OperationalReceipt = NonNullable<
  Awaited<ReturnType<typeof executeOperationalReview>>
>;
export function useOperationalAction(
  actorId: string,
  operation: OperationalMetadata["operation"],
  onSaved: (receipt: OperationalReceipt) => void,
) {
  const { refreshProfile } = useAuth();
  const identity = useRef({ actor: actorId, operation, generation: 0 });
  const frozen = useRef<{
      meta: OperationalMetadata;
      request: OperationalRequest;
    } | null>(null),
    lock = useRef(false),
    uncertain = useRef(false);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  if (
    identity.current.actor !== actorId ||
    identity.current.operation !== operation
  ) {
    identity.current = {
      actor: actorId,
      operation,
      generation: identity.current.generation + 1,
    };
    frozen.current = null;
    uncertain.current = false;
    lock.current = false;
    setPending(false);
    setError("");
    setBusy(false);
  }
  async function authorize() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== actorId) throw { code: "42501" };
  }
  function finish(meta: OperationalMetadata, result: OperationalReceipt) {
    if (frozen.current)
      result = verifyOperationalReceipt(meta, frozen.current.request, result);
    forgetOperationalReview(localStorage, meta);
    frozen.current = null;
    uncertain.current = false;
    setPending(false);
    changed();
    onSaved(result);
    return result;
  }
  async function run(
    request?: OperationalRequest,
    recover = false,
  ): Promise<OperationalReceipt | null> {
    if (lock.current) return null;
    const generation = identity.current.generation;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await authorize();
      if (request) {
        const checked = validateOperationalRequest(operation, request);
        if (
          frozen.current &&
          JSON.stringify(frozen.current.request) !== JSON.stringify(checked)
        )
          throw new Error("Keep the unconfirmed review unchanged.");
        if (!frozen.current) {
          const meta = {
            id: crypto.randomUUID(),
            actor_id: actorId,
            operation,
          };
          rememberOperationalReview(localStorage, meta);
          frozen.current = { meta, request: structuredClone(checked) };
          setPending(true);
          changed();
        }
      }
      if (!frozen.current) return null;
      const { meta, request: checked } = frozen.current;
      if (recover) {
        const saved = await readOperationalReview(meta);
        if (saved?.receipt) {
          await authorize();
          if (generation !== identity.current.generation) return null;
          return finish(meta, saved.receipt);
        }
        setError(
          saved?.state === "expired" || saved?.state === "cancelled"
            ? "This review expired or was cancelled. Check and release it before reviewing new work."
            : "No saved work is confirmed yet. Keep the review and retry unchanged.",
        );
        return null;
      }
      await prepareOperationalReview(meta, checked);
      const result = await executeOperationalReview(meta);
      await authorize();
      if (generation !== identity.current.generation) return null;
      return finish(meta, result);
    } catch (cause) {
      if (generation !== identity.current.generation) return null;
      const sqlCode =
        cause && typeof cause === "object" && "code" in cause
          ? String(cause.code)
          : "";
      if (sqlCode === "42501") {
        try {
          await refreshProfile();
        } catch {
          /* Preserve recovery even if account refresh is unavailable. */
        }
        if (generation !== identity.current.generation) return null;
      }
      const deterministic =
        !recover &&
        !uncertain.current &&
        [
          "PT409",
          "23P01",
          "42501",
          "23505",
          "23514",
          "23502",
          "23503",
        ].includes(sqlCode);
      if (deterministic && frozen.current) {
        try {
          const meta = frozen.current.meta;
          const saved = await cancelOperationalReview(meta);
          await authorize();
          if (generation !== identity.current.generation) return null;
          if (saved) return finish(meta, saved);
          forgetOperationalReview(localStorage, meta);
          frozen.current = null;
          setPending(false);
          changed();
        } catch {
          uncertain.current = true;
        }
      } else if (frozen.current) uncertain.current = true;
      setPending(Boolean(frozen.current));
      setError(operationalActionError(cause));
      return null;
    } finally {
      if (generation === identity.current.generation) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function release() {
    if (lock.current || !frozen.current) return;
    const generation = identity.current.generation;
    lock.current = true;
    setBusy(true);
    try {
      await authorize();
      const meta = frozen.current.meta;
      const saved = await cancelOperationalReview(meta);
      await authorize();
      if (generation !== identity.current.generation) return;
      if (saved) finish(meta, saved);
      else {
        forgetOperationalReview(localStorage, meta);
        frozen.current = null;
        uncertain.current = false;
        setPending(false);
        changed();
      }
    } catch (cause) {
      if (generation === identity.current.generation)
        setError(operationalActionError(cause));
    } finally {
      if (generation === identity.current.generation) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return {
    busy,
    pending,
    error,
    setError,
    save: (request: OperationalRequest) => run(request),
    retry: () => run(),
    checkSaved: () => run(undefined, true),
    release,
  };
}
