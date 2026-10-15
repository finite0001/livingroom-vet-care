import test from "node:test";
import assert from "node:assert/strict";
import { CameraLease, cameraConstraints, cameraError } from "../../src/hub/features/inventory/barcode-scanner/camera-lease.ts";
import { decoderFrameSchema, decoderReplySchema } from "../../src/hub/features/inventory/barcode-scanner/decoder-contract.ts";
function stream() { let stopped = 0; return { getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }], stops: () => stopped }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("closing a pending camera prompt stops every late track without acquiring it", async () => {
  const lease = new CameraLease<ReturnType<typeof stream>>(), pending = deferred<ReturnType<typeof stream>>(), late = stream();
  const result = lease.acquire(() => pending.promise); lease.stop(); pending.resolve(late);
  assert.equal(await result, null); assert.equal(late.stops(), 2); assert.equal(lease.owns(late), false);
});
test("a superseding camera owns the preview even when an earlier permission resolves last", async () => {
  const lease = new CameraLease<ReturnType<typeof stream>>(), old = deferred<ReturnType<typeof stream>>(), first = stream(), second = stream();
  const obsolete = lease.acquire(() => old.promise); assert.equal(await lease.acquire(async () => second), second);
  old.resolve(first); assert.equal(await obsolete, null); assert.equal(first.stops(), 2); assert.equal(second.stops(), 0); assert.equal(lease.owns(second), true);
  lease.stop(); lease.stop(); assert.equal(second.stops(), 2);
});
test("current permission failures propagate while an obsolete rejection cannot replace a newer result", async () => {
  const lease = new CameraLease<ReturnType<typeof stream>>(), old = deferred<ReturnType<typeof stream>>(), active = stream();
  const obsolete = lease.acquire(() => old.promise); await lease.acquire(async () => active); old.reject(new Error("Late denial"));
  assert.equal(await obsolete, null); assert.equal(lease.owns(active), true);
  await assert.rejects(lease.acquire(async () => { throw new DOMException("Denied", "NotAllowedError"); }), { name: "NotAllowedError" });
  assert.equal(active.stops(), 2); assert.equal(lease.owns(active), false);
});
test("camera requests exclude audio and default to an adaptable preferred rear camera", () => {
  assert.deepEqual(cameraConstraints(), { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  assert.deepEqual(cameraConstraints("chosen").video, { deviceId: { exact: "chosen" }, width: { ideal: 1280 }, height: { ideal: 720 } });
  assert.match(cameraError(new DOMException("Private detail", "NotAllowedError")), /permission/);
  assert.equal(cameraError(new Error("Private detail")).includes("Private detail"), false);
});
test("worker frames and replies reject malformed, expanded or excessive input without losing original bytes", () => {
  const frame = { sequence: 1, width: 2, height: 1, data: new Uint8ClampedArray(8) };
  assert.equal(decoderFrameSchema.safeParse(frame).success, true);
  for (const bad of [{ ...frame, width: 1281 }, { ...frame, height: 961 }, { ...frame, data: new Uint8ClampedArray(7) }, { ...frame, sequence: 0 }, { ...frame, patient: "unexpected" }]) assert.equal(decoderFrameSchema.safeParse(bad).success, false);
  const symbol = { text: "000123", bytes: [48, 48, 48, 49, 50, 51], format: "Code128", symbologyIdentifier: "]C0" };
  const result = decoderReplySchema.parse({ outcome: "decoded", sequence: 1, symbols: [symbol] });
  assert.deepEqual(result.outcome === "decoded" && result.symbols[0], symbol);
  assert.equal(decoderReplySchema.safeParse({ outcome: "decoded", sequence: 1, symbols: Array(5).fill(symbol) }).success, false);
  assert.equal(decoderReplySchema.safeParse({ outcome: "decoded", sequence: 1, symbols: [{ ...symbol, bytes: [256] }] }).success, false);
});
