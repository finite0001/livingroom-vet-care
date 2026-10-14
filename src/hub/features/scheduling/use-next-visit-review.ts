import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  prepareNextVisitReview,
  executeNextVisitReview,
  readNextVisitReview,
  cancelNextVisitReview,
} from "./next-visit-review-api";
import {
  rememberReview,
  forgetReview,
  validateReviewRequest,
  type ReviewMetadata,
  type ReviewRequest,
} from "./next-visit-review-model";
import { reviewedActionError } from "./use-reviewed-action";
export const reviewChangeEvent = "lrv:next-visit-review-change";
function changed() {
  window.dispatchEvent(new Event(reviewChangeEvent));
}
export type ReviewReceipt = NonNullable<
  Awaited<ReturnType<typeof executeNextVisitReview>>
>;
export function useNextVisitReview(
  actorId: string,
  operation: ReviewMetadata["operation"],
  onSaved: (receipt: ReviewReceipt) => void,
) {
  const identity = useRef({ actor: actorId, operation, generation: 0 });
  const frozen = useRef<{
      meta: ReviewMetadata;
      request: ReviewRequest;
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
  function finish(meta: ReviewMetadata, result: ReviewReceipt) {
    forgetReview(localStorage, meta);
    frozen.current = null;
    uncertain.current = false;
    setPending(false);
    changed();
    onSaved(result);
    return result;
  }
  async function run(
    request?: ReviewRequest,
    recover = false,
  ): Promise<ReviewReceipt | null> {
    if (lock.current) return null;
    const generation = identity.current.generation;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await authorize();
      if (request) {
        const checked = validateReviewRequest(operation, request);
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
          rememberReview(localStorage, meta);
          frozen.current = { meta, request: structuredClone(checked) };
          setPending(true);
          changed();
        }
      }
      if (!frozen.current) return null;
      const { meta, request: checked } = frozen.current;
      if (recover) {
        const saved = await readNextVisitReview(meta);
        if (saved?.receipt) {
          await authorize();
          if (generation !== identity.current.generation) return null;
          return finish(meta, saved.receipt);
        }
        setError(
          saved?.state === "expired" || saved?.state === "cancelled"
            ? "This review is no longer executable. Check and release it before reviewing new work."
            : "No saved outcome is confirmed yet. Keep the review and retry unchanged.",
        );
        return null;
      }
      await prepareNextVisitReview(meta, checked);
      const result = await executeNextVisitReview(meta);
      await authorize();
      if (generation !== identity.current.generation) return null;
      return finish(meta, result);
    } catch (cause) {
      if (generation !== identity.current.generation) return null;
      const sqlCode =
        cause && typeof cause === "object" && "code" in cause
          ? String(cause.code)
          : "";
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
          const saved = await cancelNextVisitReview(meta);
          await authorize();
          if (generation !== identity.current.generation) return null;
          if (saved) return finish(meta, saved);
          forgetReview(localStorage, meta);
          frozen.current = null;
          setPending(false);
          changed();
        } catch {
          uncertain.current = true;
        }
      } else if (frozen.current) uncertain.current = true;
      setPending(Boolean(frozen.current));
      setError(reviewedActionError(cause));
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
      const saved = await cancelNextVisitReview(meta);
      await authorize();
      if (generation !== identity.current.generation) return;
      if (saved) finish(meta, saved);
      else {
        forgetReview(localStorage, meta);
        frozen.current = null;
        uncertain.current = false;
        setPending(false);
        changed();
      }
    } catch (cause) {
      if (generation === identity.current.generation)
        setError(reviewedActionError(cause));
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
    save: (request: ReviewRequest) => run(request),
    retry: () => run(),
    checkSaved: () => run(undefined, true),
    release,
  };
}
