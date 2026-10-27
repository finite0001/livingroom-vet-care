import assert from "node:assert/strict";
import {countObservationChoices}from"../../src/hub/features/controlled-drugs/count/count-entry.ts";
import test from "node:test";
import {readFileSync}from"node:fs";
import { createEntryClient, type EntryClient } from "../../src/hub/features/controlled-drugs/entry/client.ts";
import { createEntryService, type EntryLock, type EntryStorage } from "../../src/hub/features/controlled-drugs/entry/service.ts";
import { ControlledStockWriteError, installControlledStockWriteHandler, invokeControlledStockWriter } from "../../src/hub/features/controlled-drugs/entry/gateway.ts";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session.ts";
import { serializeEntryJson, sameEntryJson, entryObject } from "../../src/hub/features/controlled-drugs/entry/codec.ts";
import { parseEntryProbe, parseEntryReply } from "../../src/hub/features/controlled-drugs/entry/schema.ts";
import { buildEntryContext, emptyEntryPlan, existingEntryContainer } from "../../src/hub/features/controlled-drugs/entry/plan.ts";
import { entryFixtureFromBytes, decode } from "./controlled-entry-fixture.ts";
const entryFixture=()=>entryFixtureFromBytes(readFileSync(new URL("./record-review-stock-movement-reference.json",import.meta.url)));
const config={projectRef:"a".repeat(20),url:`https://${"a".repeat(20)}.supabase.co`,publishableKey:"sb_publishable_synthetic"};
function memory(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
const lock:EntryLock={async exclusive(_key,work){return work();}};
function sessions(initial:ReviewIdentity){let identity:ReviewIdentity|null=initial;const source:ReviewStaffSessionSource={getSnapshot:()=>identity,subscribe:()=>()=>{},isCurrent:other=>sameReviewIdentity(identity,other),async current(){return identity?{...identity,accessToken:"synthetic.actual.token"}:null;}};return{source,set(value:ReviewIdentity|null){identity=value;}};}
test("actual gateway→coordinator→raw HTTP client prepares, reviews then executes once; callback precedes ID cleanup",async()=>{
 const f=entryFixture(),auth=sessions(f.identity),storage=memory(),calls:string[]=[],bodies:string[]=[];let inspected=false,prepared=false;
 const client=createEntryClient(config,auth.source,async(url,init)=>{const path=String(url).split("/").pop()!;calls.push(path);bodies.push(String(init?.body));if(path==="prepare_managed_stock_intent_v1")prepared=true;assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer synthetic.actual.token");return new Response(f.encode(path==="probe_controlled_stock_intent_v1"?f.probeRaw:f.reply(path==="execute_managed_stock_intent_v1"?"saved":prepared?"prepared":"not_found")),{headers:{"Content-Type":"application/json"}});});
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){return f.context;},async inspect(reply){inspected=true;assert.equal(reply.state,"prepared");assert.ok(service.pending(f.identity.actorId));return"execute";}});
 const stop=installControlledStockWriteHandler(service);
 try{const result=await invokeControlledStockWriter("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,raw=>{assert.ok(inspected);assert.ok(service.pending(f.identity.actorId));return raw;});assert.equal(entryObject(result).id,f.pointer.operation_id);assert.equal(service.pending(f.identity.actorId),null);}
 finally{stop();}
 assert.deepEqual(calls,["probe_controlled_stock_intent_v1","read_managed_stock_intent_v1","prepare_managed_stock_intent_v1","execute_managed_stock_intent_v1"]);
 assert.ok(!calls.includes("adjust_inventory"));assert.ok(bodies[2].includes('"quantity_delta":"-1"'));assert.ok(![...storage.values.values()].some(value=>value.includes("Synthetic")));
});
test("lost managed response retains only pointer IDs; same original intent recovers without prepare or resend",async()=>{
 const f=entryFixture(),auth=sessions(f.identity),storage=memory(),calls:string[]=[];let lost=true,prepared=false;
 const client=createEntryClient(config,auth.source,async(url)=>{const path=String(url).split("/").pop()!;calls.push(path);if(path==="prepare_managed_stock_intent_v1")prepared=true;if(path==="execute_managed_stock_intent_v1"&&lost){lost=false;throw new Error("lost response");}return new Response(f.encode(path==="probe_controlled_stock_intent_v1"?f.probeRaw:f.reply(!prepared?"not_found":path==="read_managed_stock_intent_v1"?"saved":"prepared")),{headers:{"Content-Type":"application/json"}});});
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){return f.context;},async inspect(){return"execute";}});
 await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x));assert.ok(service.pending(f.identity.actorId));
 const values=[...storage.values.values()];assert.equal(values.length,1);assert.equal(Object.keys(JSON.parse(values[0])).length,6);assert.ok(!values[0].includes("reason"));
 const result=await service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x);assert.equal(entryObject(result).id,f.pointer.operation_id);assert.equal(service.pending(f.identity.actorId),null);
 assert.equal(calls.filter(path=>path==="prepare_managed_stock_intent_v1").length,1);assert.equal(calls.filter(path=>path==="execute_managed_stock_intent_v1").length,1);
});
test("saved result callback failure and failed cleanup each retain recovery, with no fresh prepare",async()=>{
 for(const cleanupFails of[false,true]){
 const f=entryFixture(),auth=sessions(f.identity),base=memory();const storage:EntryStorage=cleanupFails?{...base,removeItem(){throw new Error("storage failed");}}:base;
 const client={async probe(){return f.probe;},async read(){return parseEntryReply(decode(f.encode(f.reply("not_found"))),f.pointer);},async prepare(){return parseEntryReply(decode(f.encode(f.reply("prepared"))),f.pointer);},async execute(){return parseEntryReply(decode(f.encode(f.reply("saved"))),f.pointer);}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){return f.context;},async inspect(){return"execute";}});
 await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>{if(!cleanupFails)throw new Error("presentation");return x;}),e=>e instanceof ControlledStockWriteError&&!e.definitive);assert.ok(service.pending(f.identity.actorId));}
});
test("new session for same actor during planning cannot prepare or deliver an old action",async()=>{
 const f=entryFixture(),auth=sessions(f.identity);let prepared=0;
 const client={async probe(){return f.probe;},async read(){return parseEntryReply(decode(f.encode(f.reply("not_found"))),f.pointer);},async prepare(){prepared++;throw new Error("must not call");}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,memory(),lock,{async plan(){auth.set({...f.identity,sessionId:"00000000-0000-4000-8000-000000000009",generation:2});return f.context;},async inspect(){return"execute";}});
 await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x));assert.equal(prepared,0);assert.equal(service.pending(f.identity.actorId),null);
});
test("different current intent never receives a pending operation's saved result",async()=>{
 const f=entryFixture(),auth=sessions(f.identity),storage=memory();let prepared=0;
 const client={async read(){return parseEntryReply(decode(f.encode(f.reply("saved"))),f.pointer);},async prepare(){prepared++;throw new Error("must not call");}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){return f.context;},async inspect(){return"execute";}});
 storage.setItem("lrv:controlled-stock-entry:v1:"+f.identity.actorId,JSON.stringify(f.pointer));let admitted=0;
 await assert.rejects(service.invoke("adjust_inventory",{...JSON.parse(f.snapshot.requestBody),p_reason:"Different intent"},f.identity,x=>{admitted++;return x;}));assert.equal(admitted,0);assert.equal(prepared,0);assert.ok(service.pending(f.identity.actorId));
});
test("explicit close uses saved priority or verified abandonment; leave never silently closes",async()=>{
 for(const state of["saved","abandoned"]as const){const f=entryFixture(),auth=sessions(f.identity),storage=memory(),client={async close(){return parseEntryReply(decode(f.encode(f.reply(state))),f.pointer);}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){return null;},async inspect(){return"leave";}});storage.setItem("lrv:controlled-stock-entry:v1:"+f.identity.actorId,JSON.stringify(f.pointer));const reply=await service.recover("close",f.identity);assert.equal(reply.state,state);assert.equal(service.pending(f.identity.actorId)===null,state==="abandoned");}
});
test("unmanaged branch sends original raw arguments only after explicit source probe, without a C0 pointer",async()=>{
 const f=entryFixture(),auth=sessions(f.identity),storage=memory(),calls:string[]=[];
 const client=createEntryClient(config,auth.source,async(url,init)=>{const path=String(url).split("/").pop()!;calls.push(path);if(path==="adjust_inventory")assert.equal(init?.body,f.snapshot.requestBody);return new Response(f.encode(path==="probe_controlled_stock_intent_v1"?{...f.probeRaw,mode:"unmanaged",options:null}:f.event.canonical_result),{headers:{"Content-Type":"application/json"}});});
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){throw new Error("not managed");},async inspect(){throw new Error("not managed");}});await service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x);assert.deepEqual(calls,["probe_controlled_stock_intent_v1","adjust_inventory"]);assert.equal(storage.values.size,0);
});
test("no service, lock, blocked source, or cancelled plan never falls through to a canonical writer",async()=>{
 const f=entryFixture(),auth=sessions(f.identity);let canonical=0;
 const client={async probe(){return f.probe;},async read(){return parseEntryReply(decode(f.encode(f.reply("not_found"))),f.pointer);},async legacy(){canonical++;throw new Error("must not call");}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,memory(),lock,{async plan(){return null;},async inspect(){return"leave";}});await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x),e=>e instanceof ControlledStockWriteError&&e.code==="CONTROLLED_ENTRY_CANCELLED"&&e.definitive);assert.equal(canonical,0);
});
test("closed source reply grammar refuses moved result, unknown keys, wrong boolean/numeric tokens and unknown witness rules",()=>{
 const f=entryFixture();for(const value of[{...f.probeRaw,extra:true},{...f.probeRaw,intent:{...f.intent,legacy_arguments:{...JSON.parse(f.snapshot.requestBody),p_quantity:-2}}},{...f.probeRaw,options:{...f.probeRaw.options,permission:{...entryObject(f.probeRaw.options.permission),witness:"unknown_rule"}}}])assert.throws(()=>parseEntryProbe(decode(f.encode(value)),f.identity.actorId,f.snapshot));
 const c2={...f.probeRaw,options:{...f.probeRaw.options,permission:{...entryObject(f.probeRaw.options.permission),witness:"c2_required"}}};assert.equal(parseEntryProbe(decode(f.encode(c2)),f.identity.actorId,f.snapshot).options!.permission.witness,"c2_required");
 for(const value of[{...f.reply("saved"),data:{...f.reply("saved").data,canonical_result:{id:f.pointer.operation_id}}},{...f.reply("prepared"),unexpected:true}])assert.throws(()=>parseEntryReply(decode(f.encode(value)),f.pointer));
 assert.equal(sameEntryJson(decode('{"q":1.0}'),decode('{"q":1}')),false);
});
test("allocation builder requires explicit complete same-direction source slots and actual time, without default allocations",()=>{
 const f=entryFixture(),o=f.probe.options!;const blank=emptyEntryPlan();assert.throws(()=>buildEntryContext(f.probe,blank));
 // The test uses the recorded observation spelling as fixed engineering input,
 // never wall-clock/default physical observation.
 const local="2026-10-24T08:21:52";
 const d={...blank,note:"Synthetic allocation plan",observedAt:local,observedOffset:countObservationChoices(local)[0].offset,containers:[{...existingEntryContainer(o,o.containers[0].id),afterMode:"preserve" as const,lines:[{effectIndex:"0",quantity:"-1"}]}]};
 const good=buildEntryContext(f.probe,d);assert.equal(good.containers[0].lines[0].quantity_delta,"-1");assert.equal(good.containers[0].expected_version?.token,"0");
 for(const quantity of["1","-0.5","-21","-1e0","0"]){assert.throws(()=>buildEntryContext(f.probe,{...d,containers:[{...d.containers[0],lines:[{effectIndex:"0",quantity}]}]}));}
 assert.throws(()=>buildEntryContext(f.probe,{...d,containers:[{...d.containers[0],id:f.pointer.operation_id}]}));
});
test("request codec preserves exact numeric spelling and refuses duplicate JSON, accessors, malformed UTF8 and overbudget text",()=>{
 const raw=decode('{"n":12345678901234567890.123,"q":"1.500"}');assert.equal(serializeEntryJson(raw),'{"n":12345678901234567890.123,"q":"1.500"}');assert.throws(()=>decode('{"x":1,"x":2}'));
 let calls=0;const value={get x(){calls++;return 1;}};assert.throws(()=>serializeEntryJson(value));assert.equal(calls,0);assert.throws(()=>serializeEntryJson({text:"a".repeat(131073)}));assert.throws(()=>serializeEntryJson({text:"\ud800"}));
});
test("post-write result admission cannot spoof a definitive cancellation on the unmanaged branch",async()=>{
 const f=entryFixture(),auth=sessions(f.identity);let writes=0;
 const client={async probe(){return{...f.probe,mode:"unmanaged",options:null};},async legacy(){writes++;return f.event.canonical_result;}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,memory(),lock,{async plan(){return null;},async inspect(){return"leave";}});
 await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,()=>{throw new ControlledStockWriteError("CONTROLLED_ENTRY_CANCELLED",true);}),e=>e instanceof ControlledStockWriteError&&!e.definitive&&e.code==="CONTROLLED_ENTRY_PENDING");assert.equal(writes,1);
});
test("owned recovery accepts a genuinely new execution session without equating it to preparation session",async()=>{
 const f=entryFixture(),auth=sessions({...f.identity,sessionId:"00000000-0000-4000-8000-000000000009",generation:2}),storage=memory();let executions=0;
 const client=createEntryClient(config,auth.source,async(url)=>{const path=String(url).split("/").pop();if(path==="execute_managed_stock_intent_v1")executions++;return new Response(f.encode(f.reply(path==="execute_managed_stock_intent_v1"?"saved":"prepared")),{headers:{"Content-Type":"application/json"}});});
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){throw new Error("never prepare");},async inspect(){return"leave";}});storage.setItem("lrv:controlled-stock-entry:v1:"+f.identity.actorId,JSON.stringify(f.pointer));
 const result=await service.executePending(auth.source.getSnapshot()!);assert.equal(result.state,"saved");assert.equal(executions,1);assert.equal(storage.values.size,1);
});
test("per-actor cross-tab lock refusal cannot send or replace the original pointer",async()=>{
 const f=entryFixture(),auth=sessions(f.identity);let writes=0;
 const client={async probe(){writes++;return f.probe;}} as unknown as EntryClient;
 const service=createEntryService(client,auth.source,memory(),{async exclusive(){throw new Error("held by another tab");}},{async plan(){return f.context;},async inspect(){return"execute";}});
 await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x));assert.equal(writes,0);assert.equal(service.pending(f.identity.actorId),null);
});
test("source bigint receipt heads permit the int32 preparation boundary's next head, while stale preparation states refuse",()=>{
 const f=entryFixture(),value=f.reply("saved"),p=entryObject(value.data.preparation),ctx=entryObject(p.context),frozen=entryObject(p.frozen),frame=entryObject((frozen.containers as readonly unknown[])[0]),receipt=entryObject(value.data.receipt);
 const expected=decode("2147483647"),next=decode("2147483648");
 const replacement={...receipt,containers:[{...entryObject((receipt.containers as readonly unknown[])[0]),version:next}]};
 const prepared={...p,context:{...ctx,containers:[{...entryObject((ctx.containers as readonly unknown[])[0]),expected_version:expected}]},frozen:{...frozen,containers:[{...frame,head:{...entryObject(frame.head),version:expected}}]},receipt:replacement};
 assert.equal(parseEntryReply(decode(f.encode({...value,data:{...value.data,preparation:prepared,receipt:replacement}})),f.pointer).state,"saved");
 assert.throws(()=>parseEntryReply(decode(f.encode({...f.reply("prepared"),data:{...f.reply("prepared").data,preparation:{...f.prepared,state:"expired"}}})),f.pointer));
});
test("global saved checks retain IDs; explicit admitted completion followed by original caller retry is read-only",async()=>{
 const f=entryFixture(),auth=sessions(f.identity),storage=memory(),calls:string[]=[];let prepared=false,saved=false;
 const client=createEntryClient(config,auth.source,async(url)=>{const path=String(url).split("/").pop()!;calls.push(path);if(path==="prepare_managed_stock_intent_v1")prepared=true;if(path==="execute_managed_stock_intent_v1"){saved=true;throw new Error("Saved response lost");}return new Response(f.encode(path==="probe_controlled_stock_intent_v1"?f.probeRaw:f.reply(saved?"saved":prepared?"prepared":"not_found")),{headers:{"Content-Type":"application/json"}});});
 const service=createEntryService(client,auth.source,storage,lock,{async plan(){return f.context;},async inspect(){return"execute";}});
 await assert.rejects(service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>x));assert.ok(service.pending(f.identity.actorId));
 assert.equal((await service.recover("read",f.identity)).state,"saved");assert.ok(service.pending(f.identity.actorId));
 assert.equal((await service.recover("close",f.identity)).state,"saved");assert.ok(service.pending(f.identity.actorId));
 await service.completePending(f.identity);assert.equal(service.pending(f.identity.actorId),null);
 let admitted=0;const result=await service.invoke("adjust_inventory",JSON.parse(f.snapshot.requestBody),f.identity,x=>{assert.ok(service.pending(f.identity.actorId));admitted++;return x;});assert.equal(entryObject(result).id,f.pointer.operation_id);assert.equal(admitted,1);
 assert.equal(calls.filter(x=>x==="prepare_managed_stock_intent_v1").length,1);assert.equal(calls.filter(x=>x==="execute_managed_stock_intent_v1").length,1);assert.equal(calls.at(-1),"read_managed_stock_intent_v1");
});
