/** Synthetic HTTP/UI fixture only. No SQL, genuine Auth or physical assertion. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../../src/index.css";
import reference from "./record-review-stock-movement-reference.json?raw";
import { entryFixtureFromBytes } from "./controlled-entry-fixture";
import { ControlledStockEntryProvider } from "../../src/hub/features/controlled-drugs/entry/ControlledStockEntryProvider";
import { ReviewStaffSessionContext } from "../../src/hub/features/controlled-drugs/record-review/staff-session-context";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import { invokeControlledStockWriter, ControlledStockWriteError } from "../../src/hub/features/controlled-drugs/entry/gateway";
import { decodeExactJson, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json";
import { entryObject } from "../../src/hub/features/controlled-drugs/entry/codec";
import { hashReviewEvent, hashReviewPreparationContext } from "../../src/hub/features/controlled-drugs/record-review/component-hashes";
const f=entryFixtureFromBytes(new TextEncoder().encode(reference));
let identity:Readonly<ReviewIdentity>=Object.freeze(f.identity);const listeners=new Set<()=>void>();
const sessions:ReviewStaffSessionSource={getSnapshot:()=>identity,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},isCurrent:who=>sameReviewIdentity(identity,who),async current(){return{...identity,accessToken:"synthetic.actual.token"};}};
window.addEventListener("fixture-new-session",()=>{identity=Object.freeze({...identity,sessionId:"00000000-0000-4000-8000-000000000009",generation:identity.generation+1});for(const notify of listeners)notify();});
let calls:string[]=[],saved=false,abandoned=false,prepared=false,lost=false,context=f.context;
const options=new URLSearchParams(location.search);
const config={projectRef:"a".repeat(20),url:`https://${"a".repeat(20)}.supabase.co`,publishableKey:"sb_publishable_synthetic"};
const respond=(value:unknown)=>new Response(f.encode(value),{headers:{"Content-Type":"application/json"}});
async function reply(){
 if(abandoned&&!saved)return f.reply("abandoned");
 if(!prepared)return f.reply("not_found");
 const event={...f.event,basis:context.basis.kind,note:context.basis.note,observed_at:context.basis.observed_at,context_hash:await hashReviewPreparationContext({...f.preparationSource,context})};event.record_hash=await hashReviewEvent(event);
 const receipt={...entryObject(f.reply("saved").data.receipt),event};
 return{...f.reply(saved?"saved":"prepared"),data:{...f.reply(saved?"saved":"prepared").data,preparation:{...f.prepared,context,frozen:options.has("witness")?{...f.prepared.frozen,permission:{...entryObject(f.prepared.frozen.permission),witness:"c2_required"}}:f.prepared.frozen,expires_at:"2099-01-01T00:00:00Z",state:saved?"saved":"prepared",receipt:saved?receipt:null},receipt:saved?receipt:null}};
}
const fetcher:typeof fetch=async(url,init)=>{
 const path=String(url).split("/").pop()!;calls=[...calls,path];document.getElementById("calls")!.textContent=calls.join("\n");
 if(path==="probe_controlled_stock_intent_v1")return respond(options.has("witness")?{...f.probeRaw,options:{...f.probeRaw.options,permission:{...entryObject(f.probeRaw.options.permission),witness:"c2_required"}}}:f.probeRaw);
 if(path==="read_managed_stock_witness_status_v1")return respond({schema_version:1,state:"required",data:{parent_action_id:f.pointer.operation_id,product_id:f.pointer.product_id,event_kind:f.pointer.event_kind,witness:null,blocked_reason:null}});
 if(path==="prepare_managed_stock_intent_v1"){const request=entryObject(entryObject(decodeExactJson(new TextEncoder().encode(String(init?.body)))).p_request);context=request.context as unknown as typeof context;prepared=true;}
 if(path==="execute_managed_stock_intent_v1"){saved=true;if(options.has("lost")&&!lost){lost=true;throw new Error("Synthetic saved response lost");}}
 if(path==="close_managed_stock_intent_v1")abandoned=true;
 if(!["prepare_managed_stock_intent_v1","read_managed_stock_intent_v1","execute_managed_stock_intent_v1","close_managed_stock_intent_v1"].includes(path))throw new Error("Unexpected canonical direct write");
 return respond(await reply());
};
function Fixture(){
 const [result,setResult]=useState(""),[waiting,setWaiting]=useState(false);const [release,setRelease]=useState<(()=>void)|null>(null);
 async function submit(expected:Readonly<ReviewIdentity>){
  setWaiting(true);try{await invokeControlledStockWriter("adjust_inventory",JSON.parse(f.snapshot.requestBody),expected,(raw:ExactJson)=>{if(options.has("callback"))throw new ControlledStockWriteError("CONTROLLED_ENTRY_CANCELLED",true);return raw;});setResult("Recorded original action");}catch(error){setResult(error instanceof Error?error.message:"Unconfirmed");}finally{setWaiting(false);}
 }
 return <ReviewStaffSessionContext.Provider value={sessions}><ControlledStockEntryProvider connection={config} fetcher={fetcher}><main className="mx-auto max-w-3xl space-y-4 p-4"><h1>Synthetic controlled-stock entry</h1><p>No physical observations or genuine Auth.</p><button type="button" disabled={waiting} onClick={()=>void submit(sessions.getSnapshot()!)}>Record original adjustment</button><button type="button" disabled={waiting} onClick={()=>{const expected=sessions.getSnapshot()!;setRelease(()=>()=>void submit(expected));}}>Stage an old-session action</button>{release&&<button type="button" onClick={()=>{release();setRelease(null);}}>Continue staged action</button>}<p role="status" id="result">{result}</p><pre id="calls" className="whitespace-pre-wrap break-all"/>
 </main></ControlledStockEntryProvider></ReviewStaffSessionContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><Fixture/></BrowserRouter>);
