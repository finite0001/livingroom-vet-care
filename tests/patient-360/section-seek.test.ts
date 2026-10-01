import { test } from "node:test";
import assert from "node:assert/strict";
import { seekSection } from "../../src/hub/features/patient-360/section-seek.ts";

/** Manual frame scheduler: `tick()` runs one animation frame. */
function frames() {
  let queue = new Map<number, () => void>();
  let nextId = 1;
  return {
    schedule: (step: () => void) => {
      const id = nextId++;
      queue.set(id, step);
      return id;
    },
    cancel: (id: number) => void queue.delete(id),
    tick() {
      const current = queue;
      queue = new Map();
      for (const step of current.values()) step();
    },
    get pending() {
      return queue.size;
    },
  };
}

test("waits across frames until the section renders, then reveals it once", () => {
  const clock = frames();
  let rendered = false;
  const revealed: string[] = [];
  seekSection({
    find: () => (rendered ? "soap" : null),
    reveal: (target) => revealed.push(target),
    offset: () => 0,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  for (let i = 0; i < 20; i += 1) clock.tick();
  assert.deepEqual(revealed, []);
  rendered = true;
  clock.tick();
  assert.deepEqual(revealed, ["soap"]);
  for (let i = 0; i < 200; i += 1) clock.tick();
  assert.deepEqual(revealed, ["soap"], "a stable target is not re-scrolled");
  assert.equal(clock.pending, 0, "settle window ends");
});

test("gives up after the bounded number of frames", () => {
  const clock = frames();
  let lookups = 0;
  seekSection({
    find: () => {
      lookups += 1;
      return null;
    },
    reveal: () => assert.fail("nothing to reveal"),
    offset: () => 0,
    schedule: clock.schedule,
    cancel: clock.cancel,
    maxTries: 10,
  });
  for (let i = 0; i < 50; i += 1) clock.tick();
  assert.equal(lookups, 11);
  assert.equal(clock.pending, 0);
});

test("re-aligns when content above the section shifts it during settling", () => {
  const clock = frames();
  let top = 0;
  let reveals = 0;
  seekSection({
    find: () => "labs",
    reveal: () => {
      reveals += 1;
      top = 0;
    },
    offset: () => top,
    schedule: clock.schedule,
    cancel: clock.cancel,
    settleFrames: 5,
  });
  assert.equal(reveals, 1);
  top = 300; // a section above finished loading
  clock.tick();
  assert.equal(reveals, 2);
  top = 2; // within tolerance
  clock.tick();
  assert.equal(reveals, 2);
});

test("stopping cancels the pending frame", () => {
  const clock = frames();
  const stop = seekSection({
    find: () => null,
    reveal: () => assert.fail("stopped"),
    offset: () => 0,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  assert.equal(clock.pending, 1);
  stop();
  assert.equal(clock.pending, 0);
});
