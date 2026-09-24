import { useEffect, useRef, useState } from "react";
import {
  readVaccinationReviewIntent,
  saveVaccinationReviewIntent,
  vaccinationReviewKey,
} from "./vaccination-review-state";
import type { VaccinationReviewIntent } from "./vaccination-review-state";
/** The owning component is keyed by actor and patient, preventing late replies crossing charts. */
export function useVaccinationReviewOperation(actor: string, pet: string) {
  const key = vaccinationReviewKey(actor, pet);
  const [loaded] = useState(() => {
    try {
      return { intent: readVaccinationReviewIntent(key), error: "" };
    } catch {
      return {
        intent: null,
        error:
          "Saved review reference could not be read. Use saved request discovery before starting another review.",
      };
    }
  });
  const [intent, setIntent] = useState(loaded.intent),
    [error, setError] = useState(loaded.error),
    [busy, setBusy] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(!!loaded.error);
  const intentRef = useRef(intent),
    alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function retain(value: VaccinationReviewIntent) {
    if (value.actor !== actor || value.pet !== pet)
      throw new Error("Review identity differs");
    saveVaccinationReviewIntent(value);
    intentRef.current = value;
    setIntent(value);
    setStorageBlocked(false);
  }
  function finish() {
    try {
      sessionStorage.removeItem(key);
    } catch {
      setError("Saved reference could not be cleared. It remains recoverable.");
      return false;
    }
    intentRef.current = null;
    setIntent(null);
    return true;
  }
  async function run(work: () => Promise<void>) {
    if (lock.current || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Review not confirmed. Recover the original request.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    intent,
    intentRef,
    error,
    busy,
    alive,
    retain,
    finish,
    run,
    storageBlocked,
  };
}
