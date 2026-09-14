import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { readAttachmentChart, loadAttachmentChartOriginal } from "./attachment-file-api";
import type { AttachmentReviewCursor } from "./attachment-review-state";
interface Props { petId: string; disabled: boolean; }
export function PatientApiAttachments({petId,disabled}:Props){
 const {session}=useAuth();
 return <PatientApiAttachmentSession key={`${session?.user.id??'signed-out'}:${petId}`} petId={petId} disabled={disabled}/>;
}
function PatientApiAttachmentSession({petId,disabled}:Props){
 const {session}=useAuth(),actor=session?.user.id;
 const [cursor,setCursor]=useState<AttachmentReviewCursor|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[original,setOriginal]=useState<{id:string;url:string;filename:string}|null>(null);
 const url=useRef<string|null>(null),generation=useRef(0),lock=useRef(false),alive=useRef(true);
 const history=useQuery({queryKey:['patient-api-attachments',actor,petId,cursor],queryFn:()=>readAttachmentChart(petId,cursor),enabled:!!actor,retry:false});
 useEffect(()=>{alive.current=true;const clear=()=>{generation.current++;if(url.current)URL.revokeObjectURL(url.current);url.current=null;if(alive.current)setOriginal(null);};const auth=supabase.auth.onAuthStateChange((event,next)=>{if(event==='SIGNED_OUT'||!next||next.user.id!==actor)clear();});window.addEventListener('pagehide',clear);return()=>{alive.current=false;clear();auth.data.subscription.unsubscribe();window.removeEventListener('pagehide',clear);};},[actor,petId]);
 async function inspect(id:string,captureHash:string){if(lock.current||disabled)return;lock.current=true;setBusy(true);setNotice('');setOriginal(null);if(url.current)URL.revokeObjectURL(url.current);url.current=null;const current=++generation.current;try{const result=await loadAttachmentChartOriginal(petId,id,captureHash);if(!alive.current||current!==generation.current)return;url.current=URL.createObjectURL(result.blob);setOriginal({id,url:url.current,filename:result.filename});setNotice('Original bytes verified against the saved capture. This download does not authorize a release.');}catch{if(alive.current&&current===generation.current)setNotice('The reviewed original could not be verified. No download is available.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 function clear(){generation.current++;if(url.current)URL.revokeObjectURL(url.current);url.current=null;setOriginal(null);setNotice('');}
 return <Card role="region" aria-label="Reviewed API attachments"><CardHeader><CardTitle className="text-lg">Reviewed API attachments</CardTitle></CardHeader><CardContent className="space-y-3">
  <p className="text-sm text-muted-foreground">Staff-reviewed ezyVet source files. Original and corrected approvals retain their provenance; this history does not establish migration completeness or release eligibility.</p>
  {notice&&<p role="status" className="text-sm">{notice}</p>}
  {history.isFetching&&<p role="status">Loading reviewed attachments…</p>}
  {history.isError&&<p role="alert">Reviewed attachment history could not be verified.</p>}
  {!history.isFetching&&!history.isError&&history.data&&<>
   {!history.data.records.length&&<p className="text-sm">No reviewed API attachments on this page.</p>}
   <ul className="space-y-4">{history.data.records.map(({record:r,is_latest,source_current})=><li key={r.id} className="space-y-2 rounded-md border p-3">
    <h3 className="font-medium">{r.title} · Version {r.version}</h3><p className="text-sm">{is_latest?'Latest saved approval':'Superseded approval'} · {new Date(r.created_at).toLocaleString()}</p>
    <p className="text-sm">{source_current?'Source observation still matches.':'Source changed or is unavailable. Review required.'}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{r.review_reason}</p><p className="text-xs text-muted-foreground">ezyVet API attachment {r.attachment_external_id} · {r.source_context.parent.parent_type} {r.source_context.parent.parent_external_id}</p>
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy||disabled} onClick={()=>void inspect(r.id,r.capture_hash)}>Verify original for version {r.version}</Button>{original?.id===r.id&&<a className={buttonVariants({variant:'secondary'})} href={original.url} download={original.filename} rel="noopener noreferrer">Download reviewed original</a>}</div>
   </li>)}</ul>
  </>}
  <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy||disabled||history.isFetching} onClick={()=>{clear();void history.refetch();}}>Recheck reviewed attachments</Button><Button variant="secondary" disabled={busy||disabled||history.isFetching||!cursor} onClick={()=>{clear();setCursor(null);}}>Newest reviewed attachments</Button><Button variant="secondary" disabled={busy||disabled||history.isFetching||history.isError||!history.data?.next_cursor} onClick={()=>{clear();setCursor(history.data!.next_cursor);}}>Older reviewed attachments</Button></div>
 </CardContent></Card>;
}
