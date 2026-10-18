import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ClinicalPcmRecorder } from "../../src/hub/features/clinical/dictation/audio/recorder.ts";
import { AUDIO_RATE, inspectAudioWav } from "../../supabase/functions/_shared/clinical-audio-model.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
async function fixture(t: TestContext, frames = AUDIO_RATE) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const track = { enabled: true, stops: 0, stop() { this.stops++; }, addEventListener() {} };
  const gain = { gain: { value: 1 }, disconnects: 0, connect() {}, disconnect() { this.disconnects++; } };
  const messages: string[] = [];
  let acknowledge = true;
  let frameUpdates = 0;
  let limits = 0;
  class Context {
    sampleRate = AUDIO_RATE;
    state = "running";
    destination = {};
    audioWorklet = { async addModule() {} };
    resumeCalls = 0;
    suspendCalls = 0;
    closeCalls = 0;
    resumeResult = () => Promise.resolve();
    closeResult = () => Promise.resolve();
    createGain() { return gain; }
    createMediaStreamSource() { return { connect() {} }; }
    resume() { this.resumeCalls++; return this.resumeResult(); }
    async suspend() { this.suspendCalls++; }
    close() { this.closeCalls++; return this.closeResult(); }
  }
  class Node {
    disconnects = 0;
    closes = 0;
    onprocessorerror: (() => void) | null = null;
    port = {
      onmessage: null as ((event: { data: { type: string; samples?: Int16Array; total?: number; reason?: string } }) => void) | null,
      postMessage: (message: string) => {
        messages.push(message);
        if (message === "stop" && acknowledge)
          queueMicrotask(() => this.port.onmessage?.({ data: { type: "complete", reason: "stop" } }));
      },
      close: () => { this.closes++; },
    };
    connect() {}
    disconnect() { this.disconnects++; }
  }
  const context = new Context();
  const node = new Node();
  for (const [key, value] of Object.entries({
    navigator: { mediaDevices: { async getUserMedia() { return { getTracks: () => [track] }; } } },
    AudioContext: function () { return context; },
    AudioWorkletNode: function () { return node; },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const recorder = new ClinicalPcmRecorder({ onFrames: () => frameUpdates++, onError() {}, onLimit: () => limits++ });
  t.after(async () => {
    context.closeResult = () => Promise.resolve();
    await recorder.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await recorder.start();
  const samples = Int16Array.from({ length: frames }, (_, i) => i % 2 ? -2048 : 2048);
  node.port.onmessage?.({ data: { type: "chunk", samples, total: frames } });
  const assertClean = () => {
    assert.equal(track.enabled, false);
    assert.equal(track.stops, 1);
    assert.equal(node.disconnects, 1);
    assert.equal(gain.disconnects, 1);
    assert.equal(node.closes, 1);
    assert.equal(node.port.onmessage, null);
    assert.equal(node.onprocessorerror, null);
    assert.equal(context.closeCalls, 1);
  };
  return { recorder, context, node, track, messages, samples, assertClean,
    noAck: () => { acknowledge = false; }, frames: () => frameUpdates, limits: () => limits };
}
const failure = /Recording did not finalize\. No audio was uploaded\./;

test("actual recorder normal Stop preserves PCM bytes and releases capture once", async (t) => {
  const f = await fixture(t);
  const bytes = await f.recorder.stop();
  assert.deepEqual(inspectAudioWav(bytes), { frames: AUDIO_RATE, byte_size: 32044, seconds: 1 });
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < f.samples.length; i++) assert.equal(view.getInt16(44 + i * 2, true), f.samples[i]);
  assert.deepEqual(f.messages, ["stop"]);
  f.assertClean();
  await f.recorder.dispose();
  f.assertClean();
  await assert.rejects(f.recorder.stop(), /could not be finalized/);
});

test("explicit pause/resume and paused Stop retain the existing controls", async (t) => {
  const f = await fixture(t);
  await f.recorder.pause();
  assert.equal(f.track.enabled, false);
  assert.equal(f.context.suspendCalls, 1);
  await f.recorder.resume();
  assert.equal(f.track.enabled, true);
  await f.recorder.pause();
  await f.recorder.stop();
  assert.deepEqual(f.messages, ["pause", "resume", "pause", "stop"]);
  f.assertClean();
});

test("already completed limit Stop needs no resume or extra worklet message", async (t) => {
  const f = await fixture(t);
  f.node.port.onmessage?.({ data: { type: "complete", reason: "limit" } });
  f.context.resumeResult = () => { throw new Error("must not resume"); };
  await f.recorder.stop();
  assert.equal(f.context.resumeCalls, 1);
  assert.equal(f.limits(), 1);
  assert.deepEqual(f.messages, []);
  f.assertClean();
});

test("resume rejection fails Stop and releases capture", async (t) => {
  const f = await fixture(t);
  f.context.resumeResult = () => Promise.reject(new Error("resume rejected"));
  await assert.rejects(f.recorder.stop(), /resume rejected/);
  assert.deepEqual(f.messages, []);
  f.assertClean();
});

for (const late of ["resolve", "reject"] as const) {
  test(`pending resume is bounded; late ${late} cannot restart capture or reject unobserved`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = await fixture(t);
    const resume = deferred();
    f.context.resumeResult = () => resume.promise;
    const oldHandler = f.node.port.onmessage!;
    const stop = assert.rejects(f.recorder.stop(), failure);
    await flush();
    t.mock.timers.tick(1500);
    await stop;
    f.assertClean();
    if (late === "resolve") resume.resolve();
    else resume.reject(new Error("late resume rejection"));
    oldHandler({ data: { type: "complete", reason: "stop" } });
    oldHandler({ data: { type: "chunk", samples: f.samples, total: AUDIO_RATE * 2 } });
    await flush();
    assert.deepEqual(f.messages, []);
    assert.equal(f.frames(), 1);
    f.assertClean();
  });
}

test("missing worklet acknowledgement is bounded and late acknowledgement is ignored", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t);
  f.noAck();
  const oldHandler = f.node.port.onmessage!;
  const stop = assert.rejects(f.recorder.stop(), failure);
  await flush();
  assert.deepEqual(f.messages, ["stop"]);
  t.mock.timers.tick(1500);
  await stop;
  oldHandler({ data: { type: "complete", reason: "stop" } });
  f.assertClean();
});

test("external disposal cancels pending Stop and blocks late resume", async (t) => {
  const f = await fixture(t);
  const resume = deferred();
  f.context.resumeResult = () => resume.promise;
  const stop = assert.rejects(f.recorder.stop(), failure);
  await flush();
  await f.recorder.dispose();
  await stop;
  resume.resolve();
  await flush();
  assert.deepEqual(f.messages, []);
  f.assertClean();
});

test("the one finalization deadline includes context close settlement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t);
  const close = deferred();
  f.context.closeResult = () => close.promise;
  let settled = false;
  const stop = assert.rejects(f.recorder.stop(), failure).then(() => { settled = true; });
  await flush();
  f.assertClean();
  t.mock.timers.tick(1499);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await stop;
  close.reject(new Error("late context close rejection"));
  await flush();
  f.assertClean();
});

test("cleanup close rejection stays observed without discarding a complete valid WAV", async (t) => {
  const f = await fixture(t);
  f.context.closeResult = () => Promise.reject(new Error("close rejected"));
  assert.equal(inspectAudioWav(await f.recorder.stop()).frames, AUDIO_RATE);
  f.assertClean();
});

test("concurrent Stop cannot replace the first acknowledgement or own its cleanup", async (t) => {
  const f = await fixture(t);
  const resume = deferred();
  f.context.resumeResult = () => resume.promise;
  const stop = f.recorder.stop();
  await assert.rejects(f.recorder.stop(), /could not be finalized/);
  assert.equal(f.track.stops, 0);
  resume.resolve();
  await stop;
  f.assertClean();
});

test("minimum duration rejection still disposes capture", async (t) => {
  const f = await fixture(t, AUDIO_RATE - 1);
  await assert.rejects(f.recorder.stop(), /between one second and ten minutes/);
  f.assertClean();
});

test("dispose before the Stop microtask does not attempt a new context resume", async (t) => {
  const f = await fixture(t);
  const stop = assert.rejects(f.recorder.stop(), failure);
  await f.recorder.dispose();
  await stop;
  assert.equal(f.context.resumeCalls, 1);
  assert.deepEqual(f.messages, []);
  f.assertClean();
});

test("resume and close share the original deadline rather than restarting it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t);
  const resume = deferred();
  const close = deferred();
  f.context.resumeResult = () => resume.promise;
  f.context.closeResult = () => close.promise;
  const stop = assert.rejects(f.recorder.stop(), failure);
  await flush();
  t.mock.timers.tick(1490);
  resume.resolve();
  await flush();
  f.assertClean();
  t.mock.timers.tick(10);
  await stop;
  close.resolve();
  await flush();
  f.assertClean();
});

for (const late of ["resolve", "reject"] as const) {
  test(`external disposal during close cancels Stop before late close ${late}`, async (t) => {
    const f = await fixture(t);
    const close = deferred();
    f.context.closeResult = () => close.promise;
    let outcome = "pending";
    const stop = f.recorder.stop().then(
      () => { outcome = "returned WAV"; },
      (error) => { assert.match(error.message, failure); outcome = "rejected"; },
    );
    await flush();
    assert.equal(outcome, "pending");
    assert.equal(f.context.closeCalls, 1);
    f.assertClean();
    await f.recorder.dispose();
    await flush();
    assert.equal(outcome, "rejected");
    if (late === "resolve") close.resolve();
    else close.reject(new Error("late close failure after cancellation"));
    await stop;
    await flush();
    assert.equal(outcome, "rejected");
    f.assertClean();
  });
}

test("a delayed normal close completes Stop with the valid WAV", async (t) => {
  const f = await fixture(t);
  const close = deferred();
  f.context.closeResult = () => close.promise;
  let settled = false;
  const stop = f.recorder.stop().then((bytes) => { settled = true; return bytes; });
  await flush();
  assert.equal(settled, false);
  f.assertClean();
  close.resolve();
  assert.equal(inspectAudioWav(await stop).frames, AUDIO_RATE);
  f.assertClean();
});
