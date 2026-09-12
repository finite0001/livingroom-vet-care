import test from "node:test";
import assert from "node:assert/strict";
import {
  QueueIntentStore,
  QueueRejectedError,
  type MessageIntent,
  type QueueReceipt,
  type PreparedRequest,
  type QueueTransport,
} from "../../src/hub/features/communications/queue-intent.ts";
const payload: MessageIntent = {
  conversation_id: "conversation",
  channel: "EMAIL",
  to: "synthetic@example.com",
  subject: "Visit",
  body: "Synthetic message",
  attachment_ids: [],
};
const receipt: QueueReceipt = {
  success: true,
  queued: true,
  outbox_id: "outbox",
  message_id: "message",
  state: "pending",
};
function fixture() {
  const ids = new Map<string, string>();
  const saved = new Map<string, PreparedRequest>();
  let submits = 0;
  const pointers = {
    get: (k: string) => ids.get(k) ?? null,
    set: (k: string, v: string) => {
      ids.set(k, v);
    },
    remove: (k: string) => {
      ids.delete(k);
    },
  };
  const transport: QueueTransport = {
    prepare: async (input) => {
      const { request_id, ...body } = input;
      const old = saved.get(request_id);
      if (old) {
        if (
          old.status === "abandoned" ||
          JSON.stringify(old.payload) !== JSON.stringify(body)
        )
          throw new Error("immutable");
        return structuredClone(old);
      }
      const snapshot: PreparedRequest = {
        request_id,
        payload: body,
        status: "prepared",
        receipt: null,
      };
      saved.set(request_id, snapshot);
      return structuredClone(snapshot);
    },
    recover: async (id) =>
      structuredClone(
        id
          ? (saved.get(id) ?? null)
          : ([...saved.values()].find((s) => s.status === "prepared") ?? null),
      ),
    resolve: async (id, abandon) => {
      const s = saved.get(id) ?? {
        request_id: id,
        payload: null,
        status: "prepared",
        receipt: null,
      };
      if (!s.receipt && !abandon) throw new Error("not queued");
      s.status = s.receipt ? "acknowledged" : "abandoned";
      saved.set(id, s);
      return structuredClone(s);
    },
    submit: async (input) => {
      submits++;
      const s = saved.get(input.request_id);
      assert.ok(s, "must prepare before enqueue");
      s.receipt = receipt;
      return receipt;
    },
  };
  return { ids, saved, pointers, transport, submits: () => submits };
}
test("lost queue response recovers server receipt using the prepared UUID", async () => {
  const f = fixture();
  const original = f.transport.submit;
  f.transport.submit = async (i) => {
    await original(i);
    throw new Error("lost");
  };
  const store = new QueueIntentStore(f.pointers);
  assert.deepEqual(
    await store.send("actor:composer", payload, f.transport),
    receipt,
  );
  assert.equal(f.submits(), 1);
  assert.equal(f.ids.size, 0);
  assert.equal([...f.saved.values()][0].status, "acknowledged");
});
test("reload restores exact intent with only opaque UUID stored in the browser", async () => {
  const f = fixture();
  f.transport.submit = async () => {
    throw new Error("offline");
  };
  await assert.rejects(
    new QueueIntentStore(f.pointers).send(
      "actor:composer",
      payload,
      f.transport,
    ),
  );
  assert.match(f.ids.get("actor:composer")!, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify([...f.ids]).includes(payload.body));
  const reloaded = new QueueIntentStore(f.pointers);
  const recovered = await reloaded.recover("actor:composer", f.transport);
  assert.deepEqual(recovered?.payload, payload);
  await assert.rejects(
    reloaded.send(
      "actor:composer",
      { ...payload, body: "Changed" },
      f.transport,
    ),
    /unresolved/,
  );
});
test("ambiguous preparation never dispatches and unknown reload requires confirmed discard", async () => {
  const f = fixture();
  f.transport.prepare = async () => {
    throw new Error("lost prepare");
  };
  const store = new QueueIntentStore(f.pointers);
  await assert.rejects(store.send("actor:composer", payload, f.transport));
  assert.equal(f.submits(), 0);
  const id = f.ids.get("actor:composer")!;
  const reloaded = new QueueIntentStore(f.pointers);
  await assert.rejects(
    reloaded.recover("actor:composer", f.transport),
    /not yet confirmed/,
  );
  await assert.rejects(
    reloaded.send("actor:composer", payload, f.transport),
    /unresolved/,
  );
  await reloaded.resolve("actor:composer", true, f.transport);
  assert.equal(f.saved.get(id)?.status, "abandoned");
  assert.equal(f.ids.size, 0);
});
test("prepare committed but response lost recovers before using same request for enqueue", async () => {
  const f = fixture();
  const prepare = f.transport.prepare;
  let id = "";
  f.transport.prepare = async (i) => {
    id = i.request_id;
    await prepare(i);
    throw new Error("lost");
  };
  assert.deepEqual(
    await new QueueIntentStore(f.pointers).send(
      "actor:composer",
      payload,
      f.transport,
    ),
    receipt,
  );
  assert.equal(f.saved.get(id)?.receipt, receipt);
});
test("confirmed queue rejection retains immutable prepared draft until explicit discard", async () => {
  const f = fixture();
  f.transport.submit = async () => {
    throw new QueueRejectedError("consent missing");
  };
  const store = new QueueIntentStore(f.pointers);
  await assert.rejects(store.send("actor:composer", payload, f.transport));
  assert.equal(store.has("actor:composer"), true);
  await store.resolve("actor:composer", true, f.transport);
  assert.equal(store.has("actor:composer"), false);
});
test("concurrent clicks share one prepared request and changed concurrent content is rejected", async () => {
  const f = fixture();
  let finish: (value: PreparedRequest | null) => void = () => {};
  f.transport.recover = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const store = new QueueIntentStore(f.pointers);
  const first = store.send("actor:composer", payload, f.transport);
  const second = store.send("actor:composer", payload, f.transport);
  await assert.rejects(
    store.send("actor:composer", { ...payload, body: "changed" }, f.transport),
    /unresolved/,
  );
  finish(null);
  await Promise.all([first, second]);
  assert.equal(f.submits(), 1);
});
test("sign-out clears in-memory content and prevents in-flight preparation from submitting", async () => {
  const f = fixture();
  let finish: (value: PreparedRequest | null) => void = () => {};
  f.transport.recover = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const store = new QueueIntentStore(f.pointers);
  const sending = store.send("actor:composer", payload, f.transport);
  store.clear();
  finish(null);
  await assert.rejects(sending, /Account changed/);
  assert.equal(f.submits(), 0);
  assert.equal(f.pointers.get("different-actor:composer"), null);
});
test("lost acknowledgement keeps recoverable queue receipt and never resends it after reload", async () => {
  const f = fixture();
  const resolve = f.transport.resolve;
  f.transport.resolve = async () => {
    throw new Error("ack offline");
  };
  const store = new QueueIntentStore(f.pointers);
  await store.send("actor:composer", payload, f.transport);
  assert.equal(f.ids.size, 1);
  const reloaded = new QueueIntentStore(f.pointers);
  assert.deepEqual(
    (await reloaded.recover("actor:composer", f.transport))?.receipt,
    receipt,
  );
  f.transport.resolve = resolve;
  await reloaded.send("actor:composer", payload, f.transport);
  assert.equal(f.submits(), 1);
  assert.equal(f.ids.size, 0);
});
