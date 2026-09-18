import { useEffect, useRef, useState } from "react";

interface IdentifiedOperation {
  id: string;
}
interface RecordedResolution<Receipt> {
  status: "recorded";
  receipt: Receipt;
}
interface ClosedResolution {
  status: "closed_unrecorded";
  closure: unknown;
}
interface Options<Operation extends IdentifiedOperation, Receipt> {
  identity: string;
  actorId: string;
  parseOperation: (value: unknown) => Operation;
  execute: (operation: Operation) => Promise<Receipt>;
  recover: (operation: Operation) => Promise<Receipt | null>;
  close: (
    operation: Operation,
  ) => Promise<RecordedResolution<Receipt> | ClosedResolution>;
  onResolved: (receipt: Receipt | null) => void;
}

/** A null recovery never releases a possibly delayed publication mutation. */
export function useEstimatePublicationOperation<
  Operation extends IdentifiedOperation,
  Receipt,
>(options: Options<Operation, Receipt>) {
  const key = `lrv:estimate-publication:mutation:v1:${options.identity}`;
  function readSaved(): Operation | null {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const saved = JSON.parse(raw);
    if (
      !saved ||
      typeof saved !== "object" ||
      Array.isArray(saved) ||
      Object.keys(saved).sort().join(",") !==
        "actorId,identity,operation,version" ||
      saved.version !== 1 ||
      saved.actorId !== options.actorId ||
      saved.identity !== options.identity
    )
      throw new Error(
        "The saved publication request could not be verified. Keep this browser session for recovery.",
      );
    return options.parseOperation(saved.operation);
  }
  const [initial] = useState(() => {
    try {
      return { pending: readSaved(), blocked: false, error: "" };
    } catch {
      return {
        pending: null,
        blocked: true,
        error:
          "The saved publication request could not be verified. Keep this session and resolve its recovery record before starting another operation.",
      };
    }
  });
  const [pending, setPending] = useState<Operation | null>(initial.pending);
  const pendingRef = useRef(pending);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(initial.blocked);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState(
    initial.pending
      ? "An earlier publication request needs recovery. Its exact reviewed values remain saved."
      : "",
  );
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function update(value: Operation | null) {
    pendingRef.current = value;
    setPending(value);
  }
  function persist(operation: Operation) {
    const existing = readSaved();
    if (existing && JSON.stringify(existing) !== JSON.stringify(operation))
      throw new Error("Resolve the earlier saved request first.");
    sessionStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        actorId: options.actorId,
        identity: options.identity,
        operation,
      }),
    );
    if (JSON.stringify(readSaved()) !== JSON.stringify(operation))
      throw new Error("Recovery storage could not retain this request.");
  }
  function clear(operation: Operation) {
    const saved = readSaved();
    if (saved && JSON.stringify(saved) !== JSON.stringify(operation))
      throw new Error("A different recovery request is saved.");
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null)
      throw new Error("Recovery storage could not be cleared.");
  }
  function finish(operation: Operation, receipt: Receipt | null) {
    clear(operation);
    update(null);
    setNotice(
      receipt
        ? "The exact publication operation is confirmed in history."
        : "The original request is permanently closed without recording an operation. You can review current evidence again.",
    );
    try {
      options.onResolved(receipt);
    } catch {
      setError(
        "The operation is resolved, but this view could not refresh. Reload its history before preparing another review.",
      );
    }
  }
  async function run(mode: "execute" | "recover" | "close", fresh?: Operation) {
    if (!alive.current || lock.current || blocked) return;
    let operation: Operation;
    try {
      if (fresh && pendingRef.current)
        throw new Error("Recover or close the earlier request first.");
      const input = fresh ?? pendingRef.current;
      if (!input) return;
      operation = options.parseOperation(JSON.parse(JSON.stringify(input)));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Recovery storage is unavailable; no request was sent.",
      );
      return;
    }
    try {
      persist(operation);
    } catch {
      setError(
        "Recovery storage is unavailable; no new request was sent. Preserve this session before retrying.",
      );
      setBlocked(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    update(operation);
    setError("");
    setNotice("");
    try {
      if (mode === "close") {
        const result = await options.close(operation);
        if (!alive.current) return;
        finish(operation, result.status === "recorded" ? result.receipt : null);
      } else {
        const receipt = await (mode === "execute"
          ? options.execute(operation)
          : options.recover(operation));
        if (!alive.current) return;
        if (receipt === null)
          setNotice(
            "No receipt is visible yet. Recover again, retry this identical request, or resolve it with a permanent server closure.",
          );
        else finish(operation, receipt);
      }
    } catch {
      if (alive.current)
        setError(
          "This request remains unresolved. Recover or resolve the original saved request before changing its values or starting another operation.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    pending,
    busy,
    blocked,
    error,
    notice,
    locked: blocked || busy || pending !== null,
    execute: (operation: Operation) => run("execute", operation),
    retry: () => run("execute"),
    recover: () => run("recover"),
    resolve: () => run("close"),
  };
}
