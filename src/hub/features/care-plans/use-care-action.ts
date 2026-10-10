import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readCareAction, saveCareAction, validateAction, type CareAction } from "./api";

export function careActionError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "PT409") return "The saved record or selected source changed. Your draft is retained; reload and review the latest record.";
  if (code === "42501") return "Your current account cannot make this change. Keep your draft and review your access.";
  if (code === "23505") return "This conflicts with saved work. Reload and review the existing record.";
  if (code === "23514") return "Review the selected source, calendar dates and rationale before saving.";
  return "Could not confirm the save. Keep this review unchanged and retry it, or check its saved action.";
}
export function useCareAction(actorId: string) {
  const [busy, setBusy] = useState(false), [unconfirmed, setUnconfirmed] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const frozen = useRef<{ id: string; fingerprint: string; action: CareAction } | null>(null);
  async function actor() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== actorId) throw { code: "42501" };
  }
  function clear() {
    if (lock.current) return;
    frozen.current = null;setUnconfirmed(false);setError("");
  }
  async function save(submitted: CareAction) {
    if (lock.current) return null;
    const action = validateAction(submitted), fingerprint = JSON.stringify(action);
    if (frozen.current && frozen.current.fingerprint !== fingerprint) {
      setError("The previous save is unconfirmed. Retry that unchanged review or check its saved action first.");return null;
    }
    frozen.current ??= { id: crypto.randomUUID(), fingerprint, action };
    lock.current = true;setBusy(true);setError("");
    try {
      await actor();
      const receipt = await saveCareAction(frozen.current.id, frozen.current.action);
      frozen.current = null;setUnconfirmed(false);return receipt;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const rejected = ["PT409", "42501", "23505", "23514", "23502", "23503"].includes(code);
      if (rejected) frozen.current = null;
      setUnconfirmed(!rejected);setError(careActionError(error));return null;
    } finally { lock.current = false;setBusy(false); }
  }
  async function checkSaved() {
    if (lock.current || !frozen.current) return null;
    lock.current = true;setBusy(true);setError("");
    try {
      await actor();
      const receipt = await readCareAction(frozen.current.id, frozen.current.action);
      if (!receipt) { setError("No saved action is confirmed yet. Keep this draft and retry the same review.");return null; }
      frozen.current = null;setUnconfirmed(false);return receipt;
    } catch { setError("Could not confirm the saved action. Your unchanged draft is retained.");return null; }
    finally { lock.current = false;setBusy(false); }
  }
  async function retry() {
    return frozen.current ? save(frozen.current.action) : null;
  }
  return { busy, unconfirmed, error, setError, clear, save, retry, checkSaved };
}
