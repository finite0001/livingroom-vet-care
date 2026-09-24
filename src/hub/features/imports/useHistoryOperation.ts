import { useEffect, useRef, useState } from "react";
import {
  historyIntentKey,
  readHistoryIntent,
  saveHistoryIntent,
  clearHistoryIntent,
} from "./history-intent";
import type { HistoryOperation } from "./history-intent";
interface Options {
  actor: string;
  petId: string;
  kind: HistoryOperation;
}
/** Components own server validation and explicit approval; this hook only retains identity/lifetime. */
export function useHistoryOperation({ actor, petId, kind }: Options) {
  const key = historyIntentKey(actor, petId, kind);
  const [id, setId] = useState(() => readHistoryIntent(key));
  const idRef = useRef(id);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const retain = (value: string) => {
    saveHistoryIntent(key, value);
    idRef.current = value;
    setId(value);
  };
  const finish = () => {
    clearHistoryIntent(key);
    idRef.current = null;
    setId(null);
  };
  const run = async (work: () => Promise<void>) => {
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
  };
  return { id, idRef, busy, error, setError, alive, retain, finish, run };
}
