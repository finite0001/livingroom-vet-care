import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hub/contexts/auth-context";
import { inventoryIdentityApi } from "./package-api.ts";
import {
  identityCanonical, parseIdentityRequest, verifyIdentityReceipt,
  type IdentityOperation, type IdentityReceipt, type IdentityRequest, type IdentityReview,
} from "./package-model.ts";
import {
  forgetIdentityPointer, identityRequestHash, readIdentityPointer, rememberIdentityPointer,
  type IdentityPointer,
} from "./review-pointer.ts";
export const inventoryIdentityChanged = "lrv:inventory-identity-change";
export function identityError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "23505") return "That identifier or review is already assigned. Check saved work and the current mapping before changing it";
  if (code === "PT409") return "The product, supplier scope or review changed. Check the original review before making a new one";
  if (code === "42501") return "Your current staff permissions or session changed. Sign in with the original reviewer to check saved work";
  return cause instanceof Error ? cause.message : "No saved change is confirmed. Check the original review before trying again";
}
export function useIdentityReview(actor: string, operation: IdentityOperation, onSaved: (receipt: IdentityReceipt) => void, onClosed?: () => void) {
  const { refreshProfile } = useAuth();
  const scope = useRef({ actor, operation, generation: 0 });
  const pointer = useRef<IdentityPointer | null>(null), frozen = useRef<IdentityRequest | null>(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [recovered, setRecovered] = useState<IdentityRequest | null>(null);
  if (scope.current.actor !== actor || scope.current.operation !== operation) {
    scope.current = { actor, operation, generation: scope.current.generation + 1 };
    pointer.current = null; frozen.current = null; lock.current = false;
    setBusy(false); setPending(false); setError(""); setRecovered(null);
  }
  useEffect(() => {
    try {
      pointer.current = actor ? readIdentityPointer(localStorage, actor, operation) : null;
      setPending(Boolean(pointer.current));
    } catch (cause) { setPending(true); setError(identityError(cause)); }
    return () => { scope.current.generation++; };
  }, [actor, operation]);
  const same = (generation: number) => generation === scope.current.generation && scope.current.actor === actor && scope.current.operation === operation;
  async function validateReview(original: IdentityPointer, review: IdentityReview): Promise<IdentityRequest | null> {
    if (review.id !== original.id || review.actor_id !== original.actor_id || (review.operation !== null && review.operation !== original.operation))
      throw new Error("Original inventory review identity differs; keep recovery details");
    if (review.operation === null) return null;
    const request = parseIdentityRequest(original.operation, review.request);
    if (await identityRequestHash(request) !== original.request_hash) throw new Error("Original request fingerprint differs; keep recovery details");
    return request;
  }
  function finish(original: IdentityPointer, request: IdentityRequest, receipt: IdentityReceipt) {
    const verified = verifyIdentityReceipt(original, request, receipt);
    forgetIdentityPointer(localStorage, original);
    pointer.current = null; frozen.current = null; setPending(false); setRecovered(null);
    window.dispatchEvent(new Event(inventoryIdentityChanged)); onSaved(verified); return verified;
  }
  async function run(mode: "save" | "recover" | "retry" | "close", input?: IdentityRequest): Promise<IdentityReceipt | null> {
    if (lock.current || !actor) return null;
    const generation = scope.current.generation; lock.current = true; setBusy(true); setError("");
    try {
      if (mode === "save") {
        if (pending || pointer.current) throw new Error("Check the original inventory review before starting another");
        const request = parseIdentityRequest(operation, input), hash = await identityRequestHash(request);
        if (!same(generation)) return null;
        const original = { id: crypto.randomUUID(), actor_id: actor, operation, request_hash: hash };
        rememberIdentityPointer(localStorage, original); pointer.current = original; frozen.current = request; setPending(true);
        const prepared = await inventoryIdentityApi.prepare(original, request);
        const checked = await validateReview(original, prepared);
        if (!same(generation)) return null;
        if (!checked) throw new Error("This original review is closed; check it before new work");
        if (prepared.receipt) return finish(original, checked, prepared.receipt);
        const receipt = await inventoryIdentityApi.execute(original);
        if (!same(generation)) return null;
        return finish(original, checked, receipt);
      }
      const original = pointer.current ?? readIdentityPointer(localStorage, actor, operation);
      if (!original) throw new Error("No original recovery details are available");
      pointer.current = original;
      const review = await inventoryIdentityApi.recover(original);
      const request = review ? await validateReview(original, review) : null;
      if (!same(generation)) return null;
      if (review?.receipt && request) return finish(original, request, review.receipt);
      if (mode === "close") {
        const closed = await inventoryIdentityApi.cancel(original);
        if (!same(generation)) return null;
        if (closed.receipt) {
          const saved = await inventoryIdentityApi.recover(original);
          if (!saved?.receipt) throw new Error("Saved work needs its original review evidence");
          const checked = await validateReview(original, saved);
          if (!same(generation)) return null;
          if (!checked || identityCanonical(saved.receipt) !== identityCanonical(closed.receipt)) throw new Error("Saved outcome and original review differ");
          return finish(original, checked, saved.receipt);
        }
        forgetIdentityPointer(localStorage, original); pointer.current = null; frozen.current = null;
        setPending(false); setRecovered(null); setError("Original unsaved review closed. Review current details before a new save"); onClosed?.(); return null;
      }
      if (request) { frozen.current = request; setRecovered(request); }
      if (mode === "retry") {
        const checked = request ?? frozen.current;
        if (!checked || await identityRequestHash(checked) !== original.request_hash) throw new Error("Original preparation is unavailable; close it safely before new work");
        if (!same(generation)) return null;
        if (!review) await inventoryIdentityApi.prepare(original, checked);
        if (!same(generation)) return null;
        const receipt = await inventoryIdentityApi.execute(original);
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
      setPending(Boolean(pointer.current) || pending); setError(identityError(cause)); return null;
    } finally { if (same(generation)) { lock.current = false; setBusy(false); } }
  }
  return { busy, pending, error, recovered, save: (request: IdentityRequest) => run("save", request), recover: () => run("recover"), retry: () => run("retry"), closeReview: () => run("close") };
}
