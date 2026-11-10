import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { errorMessage } from "./stock-policy";
interface Request {
  name: string;
  args: Record<string, unknown>;
}
const pending = new Map<string, Request>();
/** Retain the exact request after transport errors, including across component remounts. */
export function useContextMutation(
  resource: string,
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const { session } = useAuth();
  const key = `${session?.user.id}:${resource}`;
  const cache = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const queryKey = resource.startsWith("restock:")
    ? ["inventory", "restock", session?.user.id]
    : ["treatment-appointment", session?.user.id];
  const [uncertain, setUncertain] = useState(pending.has(key));
  async function run(request: Request) {
    if (!session || lock.current) return false;
    const original = pending.get(key) ?? request;
    if (original.args.p_actor_id !== session.user.id) {
      setError("Sign in again before saving.");
      return false;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    pending.set(key, original);
    try {
      await call(original.name, original.args);
      pending.delete(key);
      setUncertain(false);
      await cache.invalidateQueries({ queryKey });
      setSaved(true);
      return true;
    } catch (failure) {
      const code =
        typeof failure === "object" && failure !== null && "code" in failure
          ? String(failure.code)
          : "";
      const definitive = /^(22|23|40|42|PT)/.test(code);
      if (definitive) pending.delete(key);
      setUncertain(!definitive);
      if (code === "40001") void cache.invalidateQueries({ queryKey });
      setError(
        errorMessage(failure) +
          (definitive
            ? ""
            : " Outcome unconfirmed. Retry the same request before making another change."),
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    run,
    retry: () => {
      const request = pending.get(key);
      return request ? run(request) : Promise.resolve(false);
    },
    busy,
    uncertain,
    error,
    saved,
  };
}
