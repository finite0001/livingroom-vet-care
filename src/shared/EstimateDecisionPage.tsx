import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createEstimateDecisionPublicApi, type EstimateDecisionAccess, type EstimatePublicReview } from './estimate-decision-public-api';
import { readPendingEstimateDecision } from './estimate-decision-state';
import { estimateClientDecisionOperationSchema, sameEstimateDecisionEvidence, type EstimateClientDecisionOperation } from '../../supabase/functions/_shared/estimate-decision-contract';

interface Props { access:EstimateDecisionAccess }
interface DocumentView { url:string; filename:string }
interface Attestations { document:boolean; authority:boolean; choice:boolean }
const unchecked:Attestations={document:false,authority:false,choice:false};
const unavailable='Estimate information or the outcome of your request could not be verified. Access may have expired or changed. Reopen the original link, or contact the practice with your request reference. Do not submit another decision until the original is resolved.';
function money(value:string){const n=BigInt(value);return `$${(n/100n).toLocaleString('en-US')}.${String(n%100n).padStart(2,'0')}`;}
export default function EstimateDecisionPage({access}:Props){
  const [review,setReview]=useState<EstimatePublicReview|null>(null),[view,setView]=useState<DocumentView|null>(null);
  const [pending,setPending]=useState<EstimateClientDecisionOperation|null>(null),[decision,setDecision]=useState<EstimatePublicReview['decision']>(null);
  const [busy,setBusy]=useState(false),[closed,setClosed]=useState(!access.available()),[blocked,setBlocked]=useState(false),[opened,setOpened]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [name,setName]=useState(''),[relationship,setRelationship]=useState<'owner'|'authorized_agent'>('owner'),[comment,setComment]=useState('');
  const [choice,setChoice]=useState<'accept'|'decline'|null>(null),[attest,setAttest]=useState<Attestations>(unchecked);
  const api=useRef<ReturnType<typeof createEstimateDecisionPublicApi>|null>(null),locked=useRef(false),retired=useRef(false),blobUrl=useRef<string|null>(null);
  const alive=()=>!retired.current&&access.available();
  function clearDocument(){if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);blobUrl.current=null;setView(null);setReview(null);setAttest(unchecked);}
  useLayoutEffect(()=>{
    const clear=()=>{
      retired.current=true;api.current?.retire();access.retire();
      if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);blobUrl.current=null;
      setView(null);setReview(null);setDecision(null);setPending(null);setName('');setComment('');setChoice(null);setAttest(unchecked);setError('');setNotice('');setClosed(true);setBusy(false);
    };
    window.addEventListener('pagehide',clear);window.addEventListener('hashchange',clear);
    return()=>{window.removeEventListener('pagehide',clear);window.removeEventListener('hashchange',clear);retired.current=true;api.current?.retire();access.retire();if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);blobUrl.current=null;};
  },[access]);
  function getApi(){
    if(!api.current)api.current=createEstimateDecisionPublicApi(access,{baseUrl:import.meta.env.VITE_SUPABASE_URL,publishableKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,storage:window.sessionStorage});
    return api.current;
  }
  async function open(){
    if(locked.current||!alive())return;locked.current=true;setBusy(true);setError('');setNotice('');setOpened(true);clearDocument();setDecision(null);
    try{
      let saved:EstimateClientDecisionOperation|null;
      try{saved=readPendingEstimateDecision(window.sessionStorage,access.grantId);}catch{setBlocked(true);throw new Error('Saved request cannot be read');}
      setPending(saved);
      if(saved){setName(saved.request.signer_name);setRelationship(saved.request.signer_relationship);setComment(saved.request.comment??'');setChoice(saved.request.choice);}
      const result=await getApi().read();if(!alive())return;
      const url=URL.createObjectURL(result.document);blobUrl.current=url;setView({url,filename:result.review.artifact.filename});setReview(result.review);setDecision(result.review.decision);
    }catch{if(alive())setError(unavailable);}finally{locked.current=false;if(alive())setBusy(false);}
  }
  async function submit(mode:'record'|'recover'|'close',original?:EstimateClientDecisionOperation){
    if(locked.current||!alive()||blocked)return;locked.current=true;setBusy(true);setError('');setNotice('');
    let operation=original;
    try{
      if(!operation){
        if(pending||!review||!view||!choice||!attest.document||!attest.authority||!attest.choice)throw new Error('Review required');
        operation=estimateClientDecisionOperationSchema.parse({version:1,id:crypto.randomUUID(),grant_id:access.grantId,publication_id:review.binding.publication_id,request:{binding:review.binding,grant_id:access.grantId,expected_publication_head:review.publication_head,choice,signer_name:name.trim(),signer_relationship:relationship,comment:comment.trim()||null,acknowledgment_version:1,attest_document_review:true,attest_authority:true,attest_choice:true}});
      }
      // Set the original before awaiting transport. The adapter retains it before any network mutation.
      setPending(operation);
      const result=await getApi()[mode](operation);if(!alive())return;
      if(result.status==='unrecorded'){setNotice('No recorded outcome was found yet. The original request remains unresolved; recover it again or close that exact request before starting another.');return;}
      setPending(null);setAttest(unchecked);
      if(result.status==='recorded'){setDecision(result.receipt.result);setNotice('Your exact decision is recorded.');}
      else{clearDocument();setDecision(null);setNotice('The original request was closed without recording a decision. Open the estimate again before starting another request.');}
    }catch{
      if(alive()){
        // A persistence or validation failure may precede a write, but never infer noncommit from a network error.
        if(operation)setPending(operation);
        setError(operation?unavailable:'Enter your name and review all acknowledgments before confirming.');
      }
    }finally{locked.current=false;if(alive())setBusy(false);}
  }
  function close(){retired.current=true;api.current?.retire();access.retire();clearDocument();setPending(null);setDecision(null);setName('');setComment('');setChoice(null);setError('');setNotice('');setClosed(true);}
  const canDecide=!!review&&!!view&&review.publication_status==='open'&&!decision&&!pending&&!blocked;
  const canRetry=!!pending&&!!review&&!!view&&sameEstimateDecisionEvidence(pending.request.binding,review.binding)&&sameEstimateDecisionEvidence(pending.request.expected_publication_head,review.publication_head);
  const validName=name.trim().length>0&&Array.from(name.trim()).length<=200;
  return <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8 md:py-12">
    <div className="mx-auto max-w-3xl space-y-6 break-words">
      <header className="border-b border-border pb-5"><p className="text-sm text-muted-foreground">The Living Room Vet</p><h1 className="mt-2 font-serif text-3xl">Your estimate</h1><p className="mt-3 text-sm">Review the exact proposed quantities, prices and terms. Your decision does not authorize clinical treatment, record payment or reserve stock.</p></header>
      {closed?<section aria-label="Private estimate access" className="space-y-3"><h2 className="text-xl font-semibold">Open the original link from the practice</h2><p>This page does not save access details. Reopen your original link to view the estimate or recover a submitted request. If the link has expired or been revoked, contact the practice to reconcile the original request.</p></section>:<>
        <div className="flex flex-wrap gap-3"><Button onClick={()=>void open()} disabled={busy||blocked}>Open estimate</Button><Button variant="outline" onClick={close}>Close private estimate</Button></div>
        {busy&&<p role="status">Checking the exact estimate request…</p>}
        {error&&<p role="alert" className="rounded-md border border-destructive p-4 text-destructive">{error}</p>}
        {blocked&&<p role="alert">This tab’s saved request could not be read. Do not clear its storage or submit another decision. Contact the practice for reconciliation.</p>}
        {notice&&<p role="status" className="rounded-md border border-border bg-muted p-4">{notice}</p>}
        {pending&&<section aria-label="Unresolved estimate request" className="space-y-3 rounded-lg border border-border bg-card p-4"><h2 className="text-lg font-semibold">Resolve your original request</h2><p>Your original {pending.request.choice==='accept'?'acceptance':'decline'} may already be recorded. Recovery keeps the same request; it does not submit a different decision.</p><p className="break-all text-sm">Request reference: {pending.id}</p><div className="flex flex-wrap gap-2"><Button onClick={()=>void submit('recover',pending)} disabled={busy||blocked}>Recover original decision</Button>{canRetry&&<Button variant="outline" onClick={()=>void submit('record',pending)} disabled={busy||blocked}>Retry original decision</Button>}<Button variant="outline" onClick={()=>void submit('close',pending)} disabled={busy||blocked}>Resolve or close original request</Button></div><p className="text-sm text-muted-foreground">Closing returns any recorded decision, or permanently prevents this original request from recording one. It does not undo a decision already made.</p></section>}
        {decision&&<section aria-label="Recorded estimate decision" className="space-y-2 rounded-lg border border-border bg-card p-4"><h2 className="text-xl font-semibold">Decision recorded</h2><p>{decision.choice==='accept'?'Accepted':'Declined'} by {decision.signer_name} · {decision.signer_relationship==='owner'?'Reported owner':'Reported authorized agent'}</p><p className="text-sm">{decision.attribution==='link_holder'?'Submitted through a private link; name and relationship supplied by the respondent.':'Recorded by practice staff from an offline decision.'}</p><p className="text-sm">Recorded {new Date(decision.recorded_at).toLocaleString()}</p>{decision.comment&&<p className="whitespace-pre-wrap">{decision.comment}</p>}</section>}
        {review&&view&&<section aria-label="Exact published estimate" className="space-y-4"><div><h2 className="text-xl font-semibold">{review.review.title}</h2><p>{review.review.patient.name} · {review.review.household_name}</p><p className="mt-1 font-medium">{money(review.review.total_cents)} USD</p><p className="text-sm">Acceptance deadline: {review.review.accept_by}, Mountain Time. This deadline limits acceptance, not completion of accepted quantities.</p>{review.publication_status!=='open'&&<p role="status">This publication is {review.publication_status}. It cannot receive a new decision.</p>}</div><iframe className="h-[32rem] w-full rounded-md border border-border bg-background" title="Exact estimate document" src={view.url} sandbox="" referrerPolicy="no-referrer"/><a className="inline-block underline underline-offset-4" href={view.url} download={view.filename}>Download exact estimate</a></section>}
        {canDecide&&<form className="space-y-4 rounded-lg border border-border bg-card p-4 md:p-6" onSubmit={e=>{e.preventDefault();void submit('record');}} aria-label="Your estimate decision">
          <h2 className="text-xl font-semibold">Your decision</h2><p className="text-sm text-muted-foreground">This private link establishes access, not verified identity. Enter your own name and relationship.</p>
          <label className="block space-y-1">Your name<input className="block w-full rounded-md border border-input bg-background p-2" value={name} onChange={e=>setName(e.target.value)} disabled={busy} autoComplete="name" required/></label>
          <label className="block space-y-1">Your relationship<select className="block w-full rounded-md border border-input bg-background p-2" value={relationship} onChange={e=>setRelationship(e.target.value as 'owner'|'authorized_agent')} disabled={busy}><option value="owner">Owner</option><option value="authorized_agent">Authorized agent</option></select></label>
          <label className="block space-y-1">Optional message<textarea className="block w-full rounded-md border border-input bg-background p-2" value={comment} onChange={e=>setComment(e.target.value)} disabled={busy} rows={3}/></label>
          <fieldset className="space-y-2" disabled={busy}><legend className="mb-2 font-medium">Choose one decision</legend>{(['accept','decline'] as const).map(v=><label className="flex items-start gap-2" key={v}><input type="radio" name="decision" value={v} checked={choice===v} onChange={()=>{setChoice(v);setAttest({...attest,choice:false});}}/>{v==='accept'?'Accept this estimate':'Decline this estimate'}</label>)}</fieldset>
          <div className="space-y-3">{([{key:'document',label:'I reviewed the exact estimate document and its terms.'},{key:'authority',label:'I am the owner or authorized to decide for this patient.'},{key:'choice',label:'I confirm my selected decision for the entire estimate.'}] as const).map(a=><label key={a.key} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={attest[a.key]} onChange={e=>setAttest({...attest,[a.key]:e.target.checked})} disabled={busy}/>{a.label}</label>)}</div>
          <p className="text-sm">{choice==='decline'?'Declining does not agree to perform the work or automatically cancel appointments.':'Acceptance applies to this entire exact published estimate and does not replace clinical consent.'}</p>
          <Button type="submit" disabled={busy||!choice||!validName||Array.from(comment.trim()).length>2000||!attest.document||!attest.authority||!attest.choice}>{choice==='decline'?'Confirm decline':'Confirm acceptance'}</Button>
        </form>}
        {opened&&!view&&!pending&&!error&&!busy&&!decision&&!notice&&<p>Open the estimate to review its current availability.</p>}
      </>}
    </div>
  </main>;
}
