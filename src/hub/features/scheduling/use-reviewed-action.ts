import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  bookingAction,
  bookingArgs,
  catalogAction,
  catalogArgs,
  type BookingAction,
  type CatalogAction,
} from "./catalog-api";
import type { BookingReceipt, CatalogEntry } from "./catalog-model";
interface FrozenAction<A> {
  id: string;
  fingerprint: string;
  action: A;
}
function code(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}
export function reviewedActionError(error: unknown) {
  if (code(error) === "PT409")
    return "The appointment or selected publication changed. Your draft is retained; reload and review the latest version.";
  if (code(error) === "23P01")
    return "The clinician or shared resource is already booked, including travel buffers. Choose another time or resource.";
  if (code(error) === "42501")
    return "Your current account cannot make this change. Your draft is retained.";
  if (code(error) === "23505")
    return "This conflicts with saved work or an existing resource alias. Reload and review it.";
  if (["23514", "23502", "23503"].includes(code(error)))
    return "Review the species, location, staffing, times and review note before saving.";
  return "Could not confirm the save. Retry the unchanged review or check its saved action.";
}
function useReviewedAction<A, R>(
  actorId: string,
  validate: (actor: string, id: string, action: A) => unknown,
  execute: (
    actor: string,
    id: string,
    action: A,
    recover: boolean,
  ) => Promise<R | null>,
) {
  const [busy, setBusy] = useState(false),
    [unconfirmed, setUnconfirmed] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    frozen = useRef<FrozenAction<A> | null>(null);
  async function run(action?: A, recover = false): Promise<R | null> {
    if (lock.current || (recover && !frozen.current)) return null;
    try {
      if (action) {
        validate(actorId, "00000000-0000-4000-8000-000000000001", action);
        const fingerprint = JSON.stringify(action);
        if (frozen.current && frozen.current.fingerprint !== fingerprint) {
          setError(
            "Keep the unconfirmed review unchanged until its saved action is checked.",
          );
          return null;
        }
        frozen.current ??= {
          id: crypto.randomUUID(),
          fingerprint,
          action: structuredClone(action),
        };
      }
      if (!frozen.current) return null;
      lock.current = true;
      setBusy(true);
      setError("");
      const { data, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (data.session?.user.id !== actorId) throw { code: "42501" };
      const result = await execute(
        actorId,
        frozen.current.id,
        frozen.current.action,
        recover,
      );
      if (!result) {
        setError(
          "No saved action is confirmed yet. Keep this draft and retry the same review.",
        );
        return null;
      }
      frozen.current = null;
      setUnconfirmed(false);
      return result;
    } catch (cause) {
      // A failed recovery cannot prove that the original write failed.
      const rejected =
        !recover && !unconfirmed &&
        [
          "PT409",
          "23P01",
          "42501",
          "23505",
          "23514",
          "23502",
          "23503",
        ].includes(code(cause));
      if (rejected) frozen.current = null;
      setUnconfirmed(Boolean(frozen.current));
      setError(reviewedActionError(cause));
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    unconfirmed,
    error,
    setError,
    save: (action: A) => run(action),
    retry: () => run(),
    checkSaved: () => run(undefined, true),
  };
}
export function useCatalogAction(actorId: string) {
  return useReviewedAction<CatalogAction, CatalogEntry>(
    actorId,
    catalogArgs,
    catalogAction,
  );
}
export function useBookingAction(actorId: string) {
  return useReviewedAction<BookingAction, BookingReceipt>(
    actorId,
    bookingArgs,
    bookingAction,
  );
}
