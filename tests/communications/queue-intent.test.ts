import test from "node:test";
import assert from "node:assert/strict";
import { QueueIntentStore, QueueRejectedError, type MessageIntent, type QueueReceipt } from "../../src/hub/features/communications/queue-intent.ts";
const payload: MessageIntent = { conversation_id: "conversation", channel: "EMAIL", to: "synthetic@example.com", subject: "Visit", body: "Synthetic message", attachment_ids: [] };
const receipt: QueueReceipt = { success: true, queued: true, outbox_id: "outbox", message_id: "message", state: "pending" };
test("lost queue response is recovered by persisted receipt without duplicate submission", async () => {
  const store = new QueueIntentStore(); let calls = 0;
  const result = await store.send("staff:composer", payload, { submit: async () => { calls++; throw new Error("lost"); }, lookup: async () => receipt });
  assert.equal(result, receipt); assert.equal(calls, 1); assert.equal(store.has("staff:composer"), false);
});
test("uncertain retry keeps the same UUID and blocks changed payload", async () => {
  const store = new QueueIntentStore(); const ids: string[] = [];
  const transport = { submit: async (input: MessageIntent & {request_id: string}) => { ids.push(input.request_id); throw new Error("offline"); }, lookup: async () => null };
  await assert.rejects(store.send("staff:composer", payload, transport));
  await assert.rejects(store.send("staff:composer", {...payload, body:"Changed"}, transport), /unresolved/);
  await assert.rejects(store.send("staff:composer", payload, transport));
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
});
test("confirmed rejection permits editing while a committed retry still wins over rejection", async () => {
  const store = new QueueIntentStore();
  const submit = async () => { throw new QueueRejectedError("disabled"); };
  await assert.rejects(store.send("staff:composer", payload, {submit,lookup:async()=>null}));
  assert.equal(store.has("staff:composer"),false);
  assert.equal(await store.send("staff:composer",payload,{submit,lookup:async()=>receipt}),receipt);
});
test("concurrent clicks share one request; a deliberate new message gets a new UUID", async () => {
  const store = new QueueIntentStore(); const ids: string[]=[];
  let finish: (value: QueueReceipt)=>void = ()=>{};
  const transport={submit:async(input:MessageIntent & {request_id:string})=>{ids.push(input.request_id);return new Promise<QueueReceipt>(resolve=>{finish=resolve;});},lookup:async()=>null};
  const first=store.send("staff:composer",payload,transport); const second=store.send("staff:composer",payload,transport);
  finish(receipt); await Promise.all([first,second]); assert.equal(ids.length,1);
  const third=store.send("staff:composer",payload,transport); finish(receipt); await third;
  assert.notEqual(ids[0],ids[1]);
});
