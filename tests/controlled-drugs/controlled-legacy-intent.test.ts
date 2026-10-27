import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { snapshotControlledLegacyIntent } from "../../src/hub/features/controlled-drugs/entry/legacy-intent.ts";
import { admitLegacyResult } from "../../src/hub/features/controlled-drugs/entry/legacy-result.ts";
import { invokeCapturedControlledWriter } from "../../src/hub/features/controlled-drugs/entry/controlled-api.ts";
import { installControlledStockWriteHandler, invokeControlledStockWriter, ControlledStockWriteError } from "../../src/hub/features/controlled-drugs/entry/gateway.ts";
import { decodeExactJson, ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
const id = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const decode = (s: string) => decodeExactJson(new TextEncoder().encode(s));
test("all ten original signatures require every named argument, with no invented SQL defaults", () => {
  const inputs = {
    receive_inventory: { p_id:id,p_lot_id:other,p_product_id:id,p_lot_number:"Raw",p_expires_on:"2026-10-27",p_location:"A",p_quantity:1.125,p_reason:"test" },
    adjust_inventory: { p_id:id,p_lot_id:other,p_quantity:-1,p_reason:"test" },
    record_patient_treatment: { p_id:id,p_request:{} },
    record_anesthesia_drug_administration: { p_id:id,p_record_id:other,p_pet_id:id,p_request:{} },
    record_native_dispense: { p_id:id,p_request:{} },record_native_pickup:{ p_id:id,p_request:{} },
    record_native_dispense_return: { p_id:id,p_request:{} },record_native_dispense_return_v2:{ p_id:id,p_request:{} },
    record_native_return_discrepancy: { p_id:id,p_request:{} },append_native_dispense_correction:{ p_id:id,p_request:{} },
  } as const;
  for (const writer of Object.keys(inputs) as (keyof typeof inputs)[]) {
    const args = inputs[writer], result = snapshotControlledLegacyIntent(writer,args);
    assert.equal(result.operationId,id);assert.deepEqual(JSON.parse(result.requestBody),args);
    assert.throws(()=>snapshotControlledLegacyIntent(writer,{...args,extra:1}));
    for (const key of Object.keys(args)) { const missing:Record<string,unknown>={...args};delete missing[key];assert.throws(()=>snapshotControlledLegacyIntent(writer,missing)); }
  }
});
test("snapshot preserves caller-native spelling and numbers once, without invoking hooks", () => {
  const args = {p_id:id,p_request:{Refill:{id:other.toUpperCase()},text:"Å / untouched",quantity:"1.000230",version:2}};
  const result=snapshotControlledLegacyIntent("record_native_dispense",args);args.p_request.text="changed";
  assert.equal(JSON.parse(result.requestBody).p_request.text,"Å / untouched");
  assert.equal(JSON.parse(result.requestBody).p_request.quantity,"1.000230");
  assert.equal((result.legacyArguments as Record<string,Record<string,ExactJsonNumber>>).p_request.version.token,"2");
  assert.ok(Object.isFrozen(result));
  let invoked=0;
  for (const invalid of [Object.defineProperty({},"get",{enumerable:true,get(){invoked++;return 1;}}),{toJSON(){invoked++;return {}; }},Object.create({ inherited:true }),new Date(),Object.assign(new Array(3),{0:1,2:2}),{n:NaN},{n:Infinity},{n:undefined},{n:1n},{s:"\ud800"}])
    assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",{p_id:id,p_request:invalid}));
  assert.equal(invoked,0);
  const cycle:Record<string,unknown>={};cycle.self=cycle;assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",{p_id:id,p_request:cycle}));
});
test("only explicitly bounded numeric schema fields convert; decimals and unknown fields never do", () => {
  const schema=z.object({version:z.literal(1),index:z.number().int().min(0).max(1000),quantity:z.string(),nested:z.array(z.object({revision:z.number().int().min(1).max(2147483647)}).strict())}).strict();
  assert.deepEqual(admitLegacyResult(schema,decode('{"version":1,"index":2,"quantity":"1.000230","nested":[{"revision":3}]}')),{version:1,index:2,quantity:"1.000230",nested:[{revision:3}]});
  for (const raw of ['{"version":1,"index":1001,"quantity":"1","nested":[]}','{"version":1,"index":2.5,"quantity":"1","nested":[]}','{"version":1,"index":9007199254740993,"quantity":"1","nested":[]}','{"version":1,"index":2,"quantity":1.000230,"nested":[]}','{"version":1,"index":2,"quantity":"1","nested":[],"extra":1}']) assert.throws(()=>admitLegacyResult(schema,decode(raw)));
  assert.throws(()=>admitLegacyResult(z.number(),decode('1')));
});
test("missing/other-actor identity cannot reach an injected writer; stale pre-await identity remains stale", async () => {
  const identity={actorId:id,sessionId:other,generation:1};let calls=0;
  const invoke:typeof invokeControlledStockWriter=async (_writer,_args,actual,admit)=>{calls++;assert.deepEqual(actual,identity);return admit!({});};
  for (const actual of [undefined,null,{...identity,actorId:other}]) await assert.rejects(()=>invokeCapturedControlledWriter("record_native_pickup",{p_id:id,p_request:{}},id,actual,x=>x,invoke),ControlledStockWriteError);
  assert.equal(calls,0);
  await invokeCapturedControlledWriter("record_native_pickup",{},id,identity,x=>x,invoke);assert.equal(calls,1);
  let current={...identity};const remove=installControlledStockWriteHandler({async invoke(_writer,_args,captured,admit){if(captured.actorId!==current.actorId||captured.sessionId!==current.sessionId||captured.generation!==current.generation)throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);return admit({});}});
  try {
    const captured=identity;await Promise.resolve();current={...identity,generation:2};
    await assert.rejects(()=>invokeControlledStockWriter("record_native_pickup",{},captured),ControlledStockWriteError);
    current={...identity,sessionId:id};await assert.rejects(()=>invokeControlledStockWriter("record_native_pickup",{},captured),ControlledStockWriteError);
  } finally {remove();}
});

test("a real broker's pre-await identity cannot silently follow a same-actor new login", async () => {
  const { createReviewStaffSessions } = await import("../../src/hub/features/controlled-drugs/record-review/staff-session.ts");
  const sessions=createReviewStaffSessions();
  const token=(session:string)=>"e30."+Buffer.from(JSON.stringify({sub:id,session_id:session,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600})).toString("base64url")+".sig";
  let mutations=0;
  const remove=installControlledStockWriteHandler({async invoke(_writer,_args,identity,admit){
    if(!sessions.source.isCurrent(identity))throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);
    mutations++;return admit({});
  }});
  try {
    const first=sessions.offer({user:{id},access_token:token(other)});assert.ok(first);sessions.allow(first,true);
    const captured=sessions.source.getSnapshot();assert.ok(captured);
    let finish!:()=>void;const uiRead=new Promise<void>(resolve=>{finish=resolve;});
    const submit=(async()=>{await uiRead;return invokeCapturedControlledWriter("record_native_pickup",{p_id:id,p_request:{}},id,captured,x=>x);})();
    const next=sessions.offer({user:{id},access_token:token(id)});assert.ok(next);sessions.allow(next,true);finish();
    await assert.rejects(()=>submit,ControlledStockWriteError);assert.equal(mutations,0);
    await invokeCapturedControlledWriter("record_native_pickup",{p_id:id,p_request:{}},id,sessions.source.getSnapshot(),x=>x);assert.equal(mutations,1);
  } finally {remove();sessions.clear();}
});

test("JSON byte accounting refuses oversized text and aggregates before serialization, accepting the exact boundary", () => {
  const make = (note: string) => ({p_id:id,p_request:{note}});
  const overhead = Buffer.byteLength(JSON.stringify(make(""))), room=131072-overhead;
  const ascii="a".repeat(room), emoji="😀".repeat(Math.floor(room/4))+"x".repeat(room%4);
  const escaped="\u0001".repeat(Math.floor(room/6))+"x".repeat(room%6);
  const unit = '"\\\b\t\n\f\r\u0085\u2028\u2029汉';
  const unitBytes = Buffer.byteLength(JSON.stringify(unit)) - 2;
  const mixed = unit.repeat(Math.floor(room/unitBytes)) + "x".repeat(room%unitBytes);
  for (const note of [ascii,emoji,escaped,mixed]) {
    const snapshot=snapshotControlledLegacyIntent("record_native_dispense",make(note));
    assert.equal(Buffer.byteLength(snapshot.requestBody),131072);assert.equal(JSON.parse(snapshot.requestBody).p_request.note,note);
    assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",make(note+"x")),/request bound/);
  }
  assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",make("\ud800"+"a".repeat(131072))),/request bound/);
  assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",{p_id:id,p_request:{a:"x".repeat(60000),b:"x".repeat(60000),c:"x".repeat(60000)}}),/request bound/);
  assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",make("\u0001".repeat(30000))),/request bound/);
  assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",{p_id:id,p_request:{["x".repeat(131073)]:0}}),/request bound/);
  // No complete descriptor map, encoding or JSON body can precede this refusal.
  let laterDescriptors=0, serializations=0;
  const request=new Proxy({note:"x".repeat(131073),later:"unchanged"},{getOwnPropertyDescriptor(target,key){if(key==="later")laterDescriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const original=JSON.stringify;
  JSON.stringify=((...args:Parameters<typeof JSON.stringify>)=>{serializations++;return original(...args);}) as typeof JSON.stringify;
  try {assert.throws(()=>snapshotControlledLegacyIntent("record_native_dispense",{p_id:id,p_request:request}),/request bound/);}
  finally {JSON.stringify=original;}
  assert.equal(laterDescriptors,0);assert.equal(serializations,0);
});
