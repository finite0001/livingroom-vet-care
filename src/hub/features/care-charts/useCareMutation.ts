import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { care, type CareArgs, type CareMutation } from "./api";
import { errorMessage, isDefinitiveRejection } from "../inventory/stock-policy";
interface Pending {
  name: CareMutation;
  args: CareArgs;
  actor: string;
}
const pending = new Map<string, Pending>();
export function useCareMutation(scope: string) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const key = `${user?.id}:${scope}`;
  const op = useRef(pending.get(key));
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(Boolean(op.current));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    if (!busy && !uncertain) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, uncertain]);
  async function run(name: CareMutation, args: CareArgs) {
    if (lock.current) return false;
    if (!user || (op.current && op.current.actor !== user.id)) {
      setError("Sign in as the staff member who started this request.");
      return false;
    }
    op.current ??= { name, args: structuredClone(args), actor: user.id };
    pending.set(key, op.current);
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { error } = await care.rpc(op.current.name, op.current.args);
      if (error) throw error;
      op.current = undefined;
      pending.delete(key);
      setUncertain(false);
      setSuccess("Saved.");
      void cache.invalidateQueries({ queryKey: ["care-charts"] });
      return true;
    } catch (failure) {
      const definite = isDefinitiveRejection(failure);
      if (definite) {
        op.current = undefined;
        pending.delete(key);
      }
      setUncertain(!definite);
      setError(
        errorMessage(failure) +
          (!definite
            ? " Outcome unconfirmed. Retry retains the exact operation; do not create it again elsewhere."
            : ""),
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    return op.current ? run(op.current.name, op.current.args) : false;
  }
  return {
    run,
    retry,
    busy,
    uncertain,
    error,
    success,
    locked: busy || uncertain,
  };
}
