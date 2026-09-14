import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { listAttachmentReviewHistory, recoverAttachmentDecision, submitAttachmentDecision, cancelAttachmentDecision } from "./attachment-file-api";
import { parseAttachmentDecision, type AttachmentDecision, type parseAttachmentDecisionOutcome } from "./attachment-decision-state";
import type { AttachmentFileIntent } from "./attachment-file-state";
interface Props { file: AttachmentFileIntent; captureHash: string; verifiedHash: string | null; disabled: boolean; onState: (locked: boolean, busy: boolean) => void; }
export function AttachmentDecisionForm({ file, captureHash, verifiedHash, disabled, onState }: Props) {
 const [title,setTitle]=useState(''),[reason,setReason]=useState(''),[attest,setAttest]=useState(false),[op,setOp]=useState<AttachmentDecision|null>(null),[outcome,setOutcome]=useState<ReturnType<typeof parseAttachmentDecisionOutcome>>(null);
 const [busy,setBusy]=useState(false),[invalid,setInvalid]=useState(false),[cancelOpen,setCancelOpen]=useState(false),[notice,setNotice]=useState('');
 const lock=useRef(false),alive=useRef(true),context=useRef({file,captureHash}),queryClient=useQueryClient();
 const key=`lrv-attachment-decision:${file.actor}:${file.pet}:${file.id}`;
 const [historyCursor,setHistoryCursor]=useState<{before_at:string;before_id:string}|null>(null);
 const history=useQuery({queryKey:['attachment-review-history',file.actor,file.pet,file.id,historyCursor],queryFn:()=>listAttachmentReviewHistory(file,historyCursor),retry:false});
 const dirty=!!title||!!reason||attest, unresolved=!!op&&!outcome;
 useEffect(()=>{alive.current=true;try{const raw=sessionStorage.getItem(key);if(raw){const saved=parseAttachmentDecision(JSON.parse(raw),context.current.file,context.current.captureHash);setOp(saved);setTitle(saved.title);setReason(saved.reason);setNotice('A submitted decision is retained. Recover its outcome before continuing.');}}catch{setInvalid(true);setNotice('The local decision reference could not be read. Recover saved approval history before another decision.');}return()=>{alive.current=false;onState(false,false);};},[key,onState]);
 useEffect(()=>{onState(busy||unresolved||(!outcome&&dirty),busy);},[busy,unresolved,dirty,outcome,onState]);
 useEffect(()=>{setAttest(false);},[verifiedHash]);
 async function restore(record: NonNullable<typeof history.data>["records"][number]){
  if(lock.current||disabled||unresolved||(dirty&&!outcome))return;lock.current=true;setBusy(true);
  try{const restored=parseAttachmentDecision({id:record.id,actor:record.actor_id,pet:record.pet_id,request:record.request_id,captureHash:record.capture_hash,previous:record.previous_record_id,title:record.title,reason:record.review_reason},file,captureHash);const saved=await recoverAttachmentDecision(restored,file);if(!saved||!alive.current)throw new Error();sessionStorage.setItem(key,JSON.stringify(restored));setOp(restored);setOutcome(saved);setTitle(restored.title);setReason(restored.reason);setInvalid(false);setNotice('Saved decision recovered from history. No new approval was sent.');}catch{if(alive.current)setNotice('That decision could not be verified. The existing reference was retained.');}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function act(mode:'submit'|'recover'|'cancel'){
  if(lock.current||(disabled&&mode!=='recover'))return;
  lock.current=true;setBusy(true);setNotice('');let current=op,persisted=!!op;
  try{
   if(!current){
    if(mode!=='submit'||invalid||!attest||verifiedHash!==captureHash||!history.data||history.isError)throw new Error('Review the verified original and complete the decision first.');
    const fresh=await listAttachmentReviewHistory(file,null);
    if(fresh.latest_record_id!==history.data.latest_record_id){void history.refetch();setAttest(false);throw new Error('A newer approval exists. Review the latest history and attest again.');}
    current=parseAttachmentDecision({id:crypto.randomUUID(),actor:file.actor,pet:file.pet,request:file.id,captureHash,previous:fresh.latest_record_id,title,reason},file,captureHash);
    sessionStorage.setItem(key,JSON.stringify(current));persisted=true;setOp(current);
   }
   let saved=await recoverAttachmentDecision(current,file);
   if(!alive.current)return;
   if(!saved&&mode!=='recover'){
    try{if(mode==='cancel')await cancelAttachmentDecision(current);else await submitAttachmentDecision(current);}catch{/* Recover the authoritative outcome even after a lost reply. */}
    saved=await recoverAttachmentDecision(current,file);if(!alive.current)return;
   }
   setOutcome(saved);
   setNotice(saved?.status==='approved'?`Approval version ${saved.version} is saved. Clinical source review is recorded; release remains separate.`:saved?.status==='canceled'?'This submitted decision is canceled. Its ID cannot approve later.':'No saved outcome is visible. Retain this exact decision and recheck, retry, or explicitly cancel it.');
   void queryClient.invalidateQueries({queryKey:['attachment-review-history',file.actor,file.pet,file.id]});
  }catch{if(alive.current)setNotice(persisted?'The decision is unconfirmed. Retain its reference and recover or cancel before starting another.':'The decision could not be prepared. Recheck history, verify the original and complete the title, reason and attestation.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function reset(){if(busy||disabled||unresolved)return;try{sessionStorage.removeItem(key);setOp(null);setOutcome(null);setTitle('');setReason('');setAttest(false);setNotice('Start a new explicit decision after reviewing the latest history.');}catch{setNotice('The local reference could not be cleared. Keep the saved outcome.');}}
 return <section aria-label="Staff attachment decision" className="space-y-3 border-t pt-3">
  <h4 className="text-sm font-medium">Staff attachment decision</h4>
  <p className="text-sm text-muted-foreground">Download and inspect the verified original, confirm its patient and source association, then record your decision. Corrections preserve earlier versions.</p>
  {history.data?.latest_record_id&&<p className="break-all text-xs">Latest approval reference: {history.data.latest_record_id}</p>}
  {notice&&<p role={unresolved?'alert':'status'} className="text-sm">{notice}</p>}
  <label className="block text-sm">Reviewed attachment title<Input value={title} maxLength={200} disabled={busy||disabled||!!op||invalid} onChange={e=>{setTitle(e.target.value);setAttest(false);}} /></label>
  <label className="block text-sm">Review or correction reason<Textarea value={reason} maxLength={2000} disabled={busy||disabled||!!op||invalid} onChange={e=>{setReason(e.target.value);setAttest(false);}} /></label>
  <label className="flex gap-2 text-sm"><input type="checkbox" checked={attest} disabled={busy||disabled||!!op||verifiedHash!==captureHash} onChange={e=>setAttest(e.target.checked)} />I inspected the verified original and confirm the patient, source association and review decision.</label>
  {op&&<p className="break-all text-xs text-muted-foreground">Decision reference: {op.id}</p>}
  <div className="flex flex-wrap gap-2">
   <Button variant="secondary" disabled={busy||disabled||invalid||!!outcome||(!op&&(!attest||!title.trim()||!reason.trim()||history.isFetching||history.isError))} onClick={()=>void act('submit')}>{op?'Retry original decision':'Save staff decision'}</Button>
   <Button variant="secondary" disabled={busy||!op} onClick={()=>void act('recover')}>Recover decision outcome</Button>
   <Button variant="secondary" disabled={busy||disabled||!op||!!outcome} onClick={()=>setCancelOpen(true)}>Cancel submitted decision</Button>
   <Button variant="secondary" disabled={busy||disabled||unresolved||invalid||(!dirty&&!outcome)} onClick={reset}>{outcome?'Start another decision':'Discard unsubmitted draft'}</Button>
  </div>
  {!unresolved&&<div className="flex flex-wrap gap-2">
   {history.data?.records.filter(r=>r.actor_id===file.actor&&r.request_id===file.id&&r.capture_hash===captureHash).map(r=><Button key={r.id} variant="secondary" disabled={busy||disabled||history.isFetching||history.isError||(dirty&&!outcome)} onClick={()=>void restore(r)}>Recover approval version {r.version}</Button>)}
   {historyCursor&&<Button variant="secondary" disabled={busy||disabled||history.isFetching} onClick={()=>setHistoryCursor(null)}>Newest saved decisions</Button>}
   {history.data?.next_cursor&&<Button variant="secondary" disabled={busy||disabled||history.isFetching||history.isError} onClick={()=>setHistoryCursor(history.data!.next_cursor)}>Older saved decisions</Button>}
  </div>}
  <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this submitted decision?</AlertDialogTitle><AlertDialogDescription>An existing approval will be preserved. Otherwise this decision ID will be permanently canceled so a delayed request cannot approve it. The captured original is retained.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep decision</AlertDialogCancel><Button variant="secondary" onClick={()=>{setCancelOpen(false);void act('cancel');}}>Confirm decision cancellation</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
