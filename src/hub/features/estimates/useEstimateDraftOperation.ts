import { useEffect, useRef, useState } from "react";
import type {
  createEstimateDraftApi,
  EstimateOperation,
  EstimateReceipt,
  EstimateRequest,
} from "./estimate-api";
interface Options {
  actor: string;
  clientId: string;
  api: ReturnType<typeof createEstimateDraftApi>;
  onSaved: (receipt: EstimateReceipt) => void;
  onRejected: () => void;
  onClosed: () => void;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = Object.keys(a),
    y = Object.keys(b);
  return (
    x.length === y.length &&
    x.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        equal(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
/** One durable pending save per actor/household; never discard an ambiguous original. */
export function useEstimateDraftOperation({
  actor,
  clientId,
  api,
  onSaved,
  onRejected,
  onClosed,
}: Options) {
  const key = `native-estimate-draft:v1:${actor}:${clientId}`;
  function stored(): EstimateOperation | null {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const v = JSON.parse(raw);
    if (
      !v ||
      Object.keys(v).sort().join(",") !== "actor,clientId,operation,version" ||
      v.version !== 1 ||
      v.actor !== actor ||
      v.clientId !== clientId
    )
      throw new Error(
        "Saved estimate request could not be verified. Reconcile its history before another save.",
      );
    return api.parseOperation(v.operation);
  }
  const [initial] = useState(() => {
    try {
      return { operation: stored(), error: "", blocked: false };
    } catch {
      return {
        operation: null,
        error:
          "Saved estimate request could not be verified. Do not create a replacement save.",
        blocked: true,
      };
    }
  });
  const [pending, setPending] = useState<EstimateOperation | null>(
      initial.operation,
    ),
    [busy, setBusy] = useState(false),
    [retryable, setRetryable] = useState(false),
    [blocked, setBlocked] = useState(initial.blocked),
    [error, setError] = useState(initial.error),
    [notice, setNotice] = useState(
      initial.operation
        ? "Recover or close the earlier estimate save before making another."
        : "",
    );
  const current = useRef(pending),
    lock = useRef(false),
    alive = useRef(true),
    identity = useRef(key);
  identity.current = key;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const valid = () => alive.current && identity.current === key;
  function update(op: EstimateOperation | null) {
    current.current = op;
    setPending(op);
  }
  function persist(op: EstimateOperation) {
    const prior = stored();
    if (prior && !equal(prior, op))
      throw new Error("A different estimate save still needs recovery.");
    sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, actor, clientId, operation: op }),
    );
    if (!equal(stored(), op))
      throw new Error(
        "Could not retain the original estimate request; no save was sent.",
      );
  }
  function clear(op: EstimateOperation) {
    const prior = stored();
    if (prior && !equal(prior, op))
      throw new Error("The saved request changed. Reconcile its history.");
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null)
      throw new Error("Could not clear the saved request.");
    update(null);
    setRetryable(false);
  }
  function confirm(op: EstimateOperation, receipt: EstimateReceipt) {
    try {
      clear(op);
    } catch {
      setBlocked(true);
      setError(
        "The draft was saved but its browser recovery record could not be cleared. Do not create another save.",
      );
    }
    onSaved(receipt);
    setNotice("The exact estimate draft revision was saved.");
  }
  async function save(request: EstimateRequest) {
    if (lock.current || blocked || current.current) return;
    let op: EstimateOperation;
    try {
      op = api.parseOperation({
        id: crypto.randomUUID(),
        kind: "save_estimate_draft",
        payload: request,
      });
      persist(op);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save could not be prepared.");
      return;
    }
    await send(op, false);
  }
  async function send(op: EstimateOperation, wasUncertain: boolean) {
    lock.current = true;
    setBusy(true);
    update(op);
    setError("");
    setNotice("");
    try {
      const r = await api.save(op);
      if (valid()) confirm(op, r);
    } catch (e) {
      if (!valid()) return;
      const code =
        e && typeof e === "object" && "code" in e ? String(e.code) : "";
      if (
        !wasUncertain &&
        ["23514", "40001", "42501", "23505"].includes(code)
      ) {
        try {
          clear(op);
          onRejected();
          setError(
            "The server rejected this save. Your draft is retained. Load and compare the current revision and catalog before reviewing again.",
          );
        } catch {
          setBlocked(true);
          setError(
            "Could not clear the rejected request. Reconcile its history before another save.",
          );
        }
      } else {
        setRetryable(false);
        setError(
          "The save result is uncertain. Recover or close this original request; do not create a replacement.",
        );
      }
    } finally {
      lock.current = false;
      if (valid()) setBusy(false);
    }
  }
  async function retry() {
    const op = current.current;
    if (!op || !retryable || lock.current || blocked) return;
    await send(op, true);
  }
  async function recover() {
    const op = current.current;
    if (!op || lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api.recover(op);
      if (!valid()) return;
      if (r) confirm(op, r);
      else {
        setRetryable(true);
        setNotice(
          "No saved receipt found yet. Retry the identical request or resolve and close it before starting again.",
        );
      }
    } catch {
      if (valid())
        setError(
          "Recovery could not be verified. The original request remains locked.",
        );
    } finally {
      lock.current = false;
      if (valid()) setBusy(false);
    }
  }
  async function close() {
    const op = current.current;
    if (!op || lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api.close(op);
      if (!valid()) return;
      if (r.status === "recorded") confirm(op, r.receipt);
      else {
        clear(op);
        onClosed();
        setNotice(
          "The original request was closed without saving a draft revision. Review current evidence before starting again.",
        );
      }
    } catch {
      if (valid())
        setError(
          "Closure could not be verified. Recover or close the same original request again.",
        );
    } finally {
      lock.current = false;
      if (valid()) setBusy(false);
    }
  }
  return {
    pending,
    busy,
    retryable,
    blocked,
    error,
    notice,
    save,
    retry,
    recover,
    close,
    locked: busy || blocked || pending !== null,
  };
}
