import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { controlledDraftApi } from "./draft-api.ts";
import {
  draftCanonical, parseDraftRequest, verifyDraftReceipt,
  type DraftOperation, type DraftReceipt, type DraftRequest, type DraftReview,
} from "./draft-model.ts";
import {
  forgetDraftPointer, draftRequestHash, readDraftPointer, rememberDraftPointer,
  type DraftPointer,
} from "./review-pointer.ts";
export const controlledDraftChanged = "lrv:controlled-draft-change";
export function draftError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "23505") return "That medication draft or review already exists. Check its current configuration and saved work";
  if (code === "PT409") return "The medication or draft review changed. Check the original review before making a new one";
  if (code === "42501") return "Your current staff permissions or session changed. Sign in with the original reviewer to check saved work";
  return cause instanceof Error ? cause.message : "No saved change is confirmed. Check the original review before trying again";
}
export function useDraftReview(actor: string, operation: DraftOperation, onSaved: (receipt: DraftReceipt) => void, onClosed?: () => void) {
  const { refreshProfile } = useAuth();
  const scope = useRef({ actor, operation, generation: 0 });
  const pointer = useRef<DraftPointer | null>(null), frozen = useRef<DraftRequest | null>(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [recovered, setRecovered] = useState<DraftRequest | null>(null);
  if (scope.current.actor !== actor || scope.current.operation !== operation) {
    scope.current = { actor, operation, generation: scope.current.generation + 1 };
    pointer.current = null; frozen.current = null; lock.current = false;
    setBusy(false); setPending(false); setError(""); setRecovered(null);
  }
  useEffect(() => {
    try {
      pointer.current = actor ? readDraftPointer(localStorage, actor, operation) : null;
      setPending(Boolean(pointer.current));
    } catch (cause) { setPending(true); setError(draftError(cause)); }
    return () => { scope.current.generation++; };
  }, [actor, operation]);
  const same = (generation: number) => generation === scope.current.generation && scope.current.actor === actor && scope.current.operation === operation;
  async function validateReview(original: DraftPointer, review: DraftReview): Promise<DraftRequest | null> {
    if (review.id !== original.id || review.actor_id !== original.actor_id || (review.operation !== null && review.operation !== original.operation))
      throw new Error("Original controlled draft review draft differs; keep recovery details");
    if (review.operation === null) return null;
    const request = parseDraftRequest(original.operation, review.request);
    if (await draftRequestHash(request) !== original.request_hash) throw new Error("Original request fingerprint differs; keep recovery details");
    return request;
  }
  function finish(original: DraftPointer, request: DraftRequest, receipt: DraftReceipt) {
    const verified = verifyDraftReceipt(original, request, receipt);
    forgetDraftPointer(localStorage, original);
    pointer.current = null; frozen.current = null; setPending(false); setRecovered(null);
    window.dispatchEvent(new Event(controlledDraftChanged)); onSaved(verified); return verified;
  }
  async function run(mode: "save" | "recover" | "retry" | "close", input?: DraftRequest): Promise<DraftReceipt | null> {
    if (lock.current || !actor) return null;
    const generation = scope.current.generation; lock.current = true; setBusy(true); setError("");
    try {
      if (mode === "save") {
        if (pending || pointer.current) throw new Error("Check the original controlled draft review before starting another");
        const request = parseDraftRequest(operation, input), hash = await draftRequestHash(request);
        if (!same(generation)) return null;
        const original = { id: crypto.randomUUID(), actor_id: actor, operation, request_hash: hash };
        rememberDraftPointer(localStorage, original); pointer.current = original; frozen.current = request; setPending(true);
        const prepared = await controlledDraftApi.prepare(original, request);
        const checked = await validateReview(original, prepared);
        if (!same(generation)) return null;
        if (!checked) throw new Error("This original review is closed; check it before new work");
        if (prepared.receipt) return finish(original, checked, prepared.receipt);
        const receipt = await controlledDraftApi.execute(original);
        if (!same(generation)) return null;
        return finish(original, checked, receipt);
      }
      const original = pointer.current ?? readDraftPointer(localStorage, actor, operation);
      if (!original) throw new Error("No original recovery details are available");
      pointer.current = original;
      const review = await controlledDraftApi.recover(original);
      const request = review ? await validateReview(original, review) : null;
      if (!same(generation)) return null;
      if (review?.receipt && request) return finish(original, request, review.receipt);
      if (mode === "close") {
        const closed = await controlledDraftApi.cancel(original);
        if (!same(generation)) return null;
        if (closed.receipt) {
          const saved = await controlledDraftApi.recover(original);
          if (!saved?.receipt) throw new Error("Saved work needs its original review evidence");
          const checked = await validateReview(original, saved);
          if (!same(generation)) return null;
          if (!checked || draftCanonical(saved.receipt) !== draftCanonical(closed.receipt)) throw new Error("Saved outcome and original review differ");
          return finish(original, checked, saved.receipt);
        }
        forgetDraftPointer(localStorage, original); pointer.current = null; frozen.current = null;
        setPending(false); setRecovered(null); setError("Original unsaved review closed. Review current details before a new save"); onClosed?.(); return null;
      }
      if (request) { frozen.current = request; setRecovered(request); }
      if (mode === "retry") {
        const checked = request ?? frozen.current;
        if (!checked || await draftRequestHash(checked) !== original.request_hash) throw new Error("Original preparation is unavailable; close it safely before new work");
        if (!same(generation)) return null;
        if (!review) await controlledDraftApi.prepare(original, checked);
        if (!same(generation)) return null;
        const receipt = await controlledDraftApi.execute(original);
        if (!same(generation)) return null;
        return finish(original, checked, receipt);
      }
      setError(review?.state === "expired" || review?.state === "cancelled" ? "This review is expired or closed. Close its recovery details before new work" : "No saved change is confirmed. Keep the original request and retry unchanged or close it safely");
      return null;
    } catch (cause) {
      if (!same(generation)) return null;
      if (cause && typeof cause === "object" && "code" in cause && String(cause.code) === "42501") {
        try { await refreshProfile(); } catch { /* Keep original recovery details. */ }
        if (!same(generation)) return null;
      }
      setPending(Boolean(pointer.current) || pending); setError(draftError(cause)); return null;
    } finally { if (same(generation)) { lock.current = false; setBusy(false); } }
  }
  return { busy, pending, error, recovered, save: (request: DraftRequest) => run("save", request), recover: () => run("recover"), retry: () => run("retry"), closeReview: () => run("close") };
}
