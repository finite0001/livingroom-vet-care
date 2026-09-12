import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { errorMessage, isDefinitiveRejection } from "./stock-policy";
import {
  mutateInventory,
  type InventoryMutation,
  type InventoryMutationArgs,
} from "./api";
interface PendingRequest {
  actor: string;
  name: InventoryMutation;
  args: InventoryMutationArgs;
}
const pendingRequests = new Map<string, PendingRequest>();
export function useStockMutation(scope = "inventory") {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const storageKey = `${user?.id}:${scope}`;
  const operation = useRef<PendingRequest | null>(
    pendingRequests.get(storageKey) ?? null,
  );
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(Boolean(operation.current));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    if (!busy && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, uncertain]);
  async function run(
    name: InventoryMutation,
    args: InventoryMutationArgs,
  ): Promise<boolean> {
    if (lock.current) return false;
    if (!user || (operation.current && operation.current.actor !== user.id)) {
      setError("Sign in with the staff account that started this request.");
      return false;
    }
    operation.current ??= { actor: user.id, name, args: structuredClone(args) };
    pendingRequests.set(storageKey, operation.current);
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await mutateInventory(operation.current.name, operation.current.args);
      operation.current = null;
      pendingRequests.delete(storageKey);
      setUncertain(false);
      setSuccess("Saved.");
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["treatments"] });
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
      for (const prefix of ["household-invoices", "invoice", "invoice-details"])
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      return true;
    } catch (failure) {
      const definitive = isDefinitiveRejection(failure);
      if (definitive) {
        operation.current = null;
        pendingRequests.delete(storageKey);
      }
      setUncertain(!definitive);
      setError(
        errorMessage(failure) +
          (!definitive
            ? " Outcome unconfirmed. Retry uses the same operation; do not enter it again elsewhere."
            : ""),
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retry(): Promise<boolean> {
    if (!operation.current) return false;
    return run(operation.current.name, operation.current.args);
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
