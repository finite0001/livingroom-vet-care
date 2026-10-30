import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import { sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig } from "../record-review/raw-rpc.ts";
import { createEntryClient } from "./client.ts";
import { ControlledStockWriteError, installControlledStockWriteHandler } from "./gateway.ts";
import { browserEntryLock, createEntryService, type EntryService } from "./service.ts";
import type { EntryContext, EntryProbe, EntryReply } from "./schema.ts";
import { EntryPlanForm } from "./EntryPlanForm";
import { EntryReview } from "./EntryReview";
import type { RecorderWitnessStatus } from "../witness/schema.ts";
interface ControlledStockEntryProviderProps { readonly children:ReactNode;readonly connection?:ReviewRpcConfig;readonly fetcher?:typeof fetch }
interface PlanPrompt { readonly kind:"plan";readonly id:number;readonly identity:Readonly<ReviewIdentity>;readonly probe:EntryProbe;readonly done:(context:EntryContext|null)=>void }
interface InspectPrompt { readonly kind:"inspect";readonly id:number;readonly identity:Readonly<ReviewIdentity>;readonly reply:EntryReply;readonly checkWitness?:()=>Promise<RecorderWitnessStatus>;readonly done:(choice:"execute"|"close"|"leave")=>void }
type Prompt=PlanPrompt|InspectPrompt;
interface Presentation { readonly identity:Readonly<ReviewIdentity>;readonly text:string;readonly reply?:EntryReply }
/** One application-level host survives route changes. Only the pointer's IDs
 * persist; the original action, planning draft and frozen preparation stay in
 * memory and are masked immediately when the authenticated identity changes. */
export function ControlledStockEntryProvider({children,connection,fetcher}:ControlledStockEntryProviderProps){
 const sessions=useReviewStaffSessions(),identity=useSyncExternalStore(sessions.subscribe,sessions.getSnapshot,()=>null);
 const [prompt,setPrompt]=useState<Prompt|null>(null),[presentation,setPresentation]=useState<Presentation|null>(null),[busy,setBusy]=useState(false),[,refresh]=useState(0);
 const [witness,setWitness]=useState<{readonly identity:Readonly<ReviewIdentity>;readonly status:RecorderWitnessStatus}|null>(null),[witnessBusy,setWitnessBusy]=useState(false),[witnessError,setWitnessError]=useState<string|null>(null);
 const waiting=useRef<Prompt|null>(null),serial=useRef(0),alive=useRef(false),running=useRef(false);
 const dismiss=useCallback(()=>{
  const current=waiting.current;waiting.current=null;if(alive.current)setPrompt(null);
  if(current?.kind==="plan")current.done(null);else if(current)current.done("leave");
 },[]);
 const service=useMemo<EntryService|null>(()=>{
  try{
   const client=createEntryClient(connection??{projectRef:import.meta.env.VITE_SUPABASE_PROJECT_ID,url:import.meta.env.VITE_SUPABASE_URL,publishableKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},sessions,fetcher);
   return createEntryService(client,sessions,{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)},browserEntryLock(),{
    plan(probe,expected){return new Promise((resolve,reject)=>{
     if(!alive.current||waiting.current||!sessions.isCurrent(expected)){reject(new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true));return;}
     const next:PlanPrompt={kind:"plan",id:++serial.current,identity:expected,probe,done:resolve};waiting.current=next;setPrompt(next);
    });},
    inspect(reply,expected,checkWitness){return new Promise((resolve,reject)=>{
     if(!alive.current||waiting.current||!sessions.isCurrent(expected)){reject(new ControlledStockWriteError("CONTROLLED_ENTRY_PENDING",false));return;}
     const next:InspectPrompt={kind:"inspect",id:++serial.current,identity:expected,reply,checkWitness,done:resolve};waiting.current=next;setWitness(null);setWitnessError(null);setPrompt(next);
    });},
   });
  }catch{return null;}
 },[connection,fetcher,sessions]);
 useEffect(()=>{
  alive.current=true;
  const changed=()=>{if(waiting.current&&!sessions.isCurrent(waiting.current.identity))dismiss();if(alive.current)refresh(n=>n+1);};
  const stop=sessions.subscribe(changed);window.addEventListener("storage",changed);window.addEventListener("focus",changed);
  let uninstall:(()=>void)|undefined;
  if(service)uninstall=installControlledStockWriteHandler({async invoke(writer,args,expected,admit){
   // The API captured expected before any caller UI await. Never replace it with
   // a new global session here, including a new session for the same actor.
   if(!alive.current||running.current||!sessions.isCurrent(expected))throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);
   running.current=true;setBusy(true);setPresentation(null);
   try{return await service.invoke(writer,args,expected,admit);}
   catch(error){if(alive.current&&sessions.isCurrent(expected))setPresentation({identity:expected,text:error instanceof ControlledStockWriteError?error.message:"The entry result is unconfirmed. Check the original operation."});throw error;}
   finally{running.current=false;if(alive.current){setBusy(false);refresh(n=>n+1);}}
  }});
  return()=>{alive.current=false;uninstall?.();stop();window.removeEventListener("storage",changed);window.removeEventListener("focus",changed);dismiss();};
 },[dismiss,service,sessions]);
 useEffect(()=>{
  if(!prompt)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",unload);return()=>window.removeEventListener("beforeunload",unload);
 },[prompt]);
 const visible=prompt&&identity&&sameReviewIdentity(prompt.identity,identity)?prompt:null;
 const shown=presentation&&identity&&sameReviewIdentity(presentation.identity,identity)?presentation:null;
 const currentWitness=witness&&identity&&sameReviewIdentity(witness.identity,identity)?witness.status:null;
 let pending:ReturnType<EntryService["pending"]>=null,corrupt=false;
 if(identity&&service)try{pending=service.pending(identity.actorId);}catch{corrupt=true;}
 const resolvePlan=(context:EntryContext|null)=>{const current=waiting.current;if(current?.kind!=="plan"||current!==visible||!sessions.isCurrent(current.identity))return;waiting.current=null;setPrompt(null);current.done(context);};
 const resolveInspect=(choice:"execute"|"close"|"leave")=>{const current=waiting.current;if(current?.kind!=="inspect"||current!==visible||!sessions.isCurrent(current.identity))return;waiting.current=null;setPrompt(null);current.done(choice);};
 async function checkWitness(){
  if(!identity||!service||witnessBusy)return;
  const expected=identity,inspection=waiting.current,original=inspection?.kind==="inspect"?inspection.reply:shown?.reply;
  if(!original||original.state!=="prepared")return;const operationId=original.data.pointer.operation_id;
  setWitnessBusy(true);setWitnessError(null);setWitness(null);
  try{const status=inspection?.kind==="inspect"&&inspection.checkWitness?await inspection.checkWitness():await service.witnessStatusPending(expected);
   if(!alive.current||!sessions.isCurrent(expected)||status.data.parent_action_id!==operationId||inspection&&waiting.current!==inspection)return;
   setWitness({identity:expected,status});
  }catch{if(alive.current&&sessions.isCurrent(expected))setWitnessError("The independent witness could not be confirmed. The original entry remains unrecorded by this action.");}
  finally{if(alive.current)setWitnessBusy(false);}
 }
 async function recover(mode:"read"|"close"|"execute"|"complete"){
  if(!identity||!service||running.current||!sessions.isCurrent(identity))return;
  const expected=identity;running.current=true;setBusy(true);setPresentation(null);
  try{const reply=mode==="execute"?await service.executePending(expected):mode==="complete"?await service.completePending(expected):await service.recover(mode,expected);
   if(alive.current&&sessions.isCurrent(expected))setPresentation({identity:expected,reply,text:reply.state==="saved"?(mode==="complete"?"The original saved result is admitted. Its recovery IDs are cleared.":"The original controlled-stock entry is recorded. Review the original action and verify its complete result before completing recovery; its IDs remain."):reply.state==="abandoned"?"The original attempt is closed without a save.":"The original attempt is retained. Review it below before choosing an action."});
  }catch{if(alive.current&&sessions.isCurrent(expected))setPresentation(mode==="complete"&&shown?.reply?.state==="saved"?{identity:expected,reply:shown.reply,text:"The original entry is recorded, but its complete result could not be admitted. Recovery IDs remain."}:{identity:expected,text:"The original entry could not be confirmed. Its recovery IDs remain. Do not prepare a replacement."});}
  finally{running.current=false;if(alive.current){setBusy(false);refresh(n=>n+1);}}
 }
 return <>{children}
  {identity&&(pending||corrupt||shown||busy)&&<aside className="fixed bottom-16 left-3 right-3 z-40 max-h-[40dvh] overflow-auto rounded-xl border bg-background p-4 shadow-lg md:bottom-4 md:left-auto md:w-[30rem]" aria-label="Controlled-drug entry recovery" aria-live="polite">
   <h2 className="font-display text-lg">Controlled-drug entry</h2>
   {corrupt&&<p role="alert" className="text-sm text-destructive">The owned-operation record cannot be read. Preserve this browser’s data and ask an administrator for recovery help.</p>}
   {busy&&!visible&&<p role="status" className="text-sm">Checking the original action. Do not submit it again.</p>}
   {shown&&<p role="status" className="break-words text-sm">{shown.text}</p>}
   {pending&&<><p className="break-all text-xs text-muted-foreground">Owned operation {pending.operation_id}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={()=>void recover("read")}>Check original entry</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={()=>void recover("close")}>Close original attempt</Button></div></>}
   {shown?.reply&&pending&&<EntryReview key={`${shown.reply.data.pointer.operation_id}:${shown.reply.state}`} reply={shown.reply} busy={busy||witnessBusy} witnessStatus={currentWitness?.data.parent_action_id===shown.reply.data.pointer.operation_id?currentWitness:null} witnessError={witnessError} onCheckWitness={()=>void checkWitness()} onCompleteSaved={shown.reply.state==="saved"?()=>void recover("complete"):undefined} onChoose={choice=>{if(choice!=="leave")void recover(choice==="execute"?"execute":"close");else setPresentation(null);}}/>}
   {!pending&&shown&&<Button type="button" variant="ghost" className="mt-2 min-h-11" disabled={busy} onClick={()=>setPresentation(null)}>Dismiss message</Button>}
  </aside>}
  <Dialog open={visible!==null} onOpenChange={open=>{if(!open)dismiss();}}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{visible?.kind==="plan"?"Plan the controlled-stock entry":"Review the prepared entry"}</DialogTitle><DialogDescription>{visible?.kind==="plan"?"Use the actual source containers and physical facts. Your original action remains unchanged.":"Recording is a separate, deliberate action after reviewing the saved preparation."}</DialogDescription></DialogHeader>
   {visible?.kind==="plan"&&<EntryPlanForm key={visible.id} probe={visible.probe} onPrepare={resolvePlan} onCancel={()=>resolvePlan(null)}/>}
   {visible?.kind==="inspect"&&<EntryReview key={visible.id} reply={visible.reply} busy={witnessBusy} witnessStatus={currentWitness?.data.parent_action_id===visible.reply.data.pointer.operation_id?currentWitness:null} witnessError={witnessError} onCheckWitness={()=>void checkWitness()} onChoose={resolveInspect}/>}
  </DialogContent></Dialog>
 </>;
}
