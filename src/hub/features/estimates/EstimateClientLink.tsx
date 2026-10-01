import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {denverInstant,denverLocal} from '../scheduling/time';
import {EstimateGrantUnavailableError,type EstimateGrantOutcome,type EstimateGrantPreview,type EstimateIssuedGrant,type createEstimateDecisionGrantApi} from './decision-grant-api';
type GrantApi=ReturnType<typeof createEstimateDecisionGrantApi>;
interface Props {
  grants:GrantApi;
  /** Current undecided publication preview, or an error when there is none to link. */
  preview:()=>Promise<EstimateGrantPreview>;
  disabled:boolean;
  onDirtyChange:(dirty:boolean)=>void;
}
const disabledNotice='This link is active, but client-link issuance is switched off on the server (ESTIMATE_DECISION_ISSUANCE_ENABLED), so the link cannot be shown. Ask an administrator to turn issuance on, then recover it here.';
const time=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Denver'});
/** Issue, activate and recover the client's private estimate link (`/estimate/:id#token`). */
export function EstimateClientLink({grants,preview,disabled,onDirtyChange}:Props){
 const [recipient,setRecipient]=useState(''),[purpose,setPurpose]=useState('Review and accept or decline this estimate'),[expires,setExpires]=useState(''),[attest,setAttest]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[link,setLink]=useState<{url:string;expires_at:string}|null>(null),[issued,setIssued]=useState<EstimateIssuedGrant[]|null>(null),[copied,setCopied]=useState(false);
 const alive=useRef(true),lock=useRef(false);
 useEffect(()=>()=>{alive.current=false;},[]);
 const dirty=busy||!!recipient.trim()||attest;
 useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
 async function run(work:()=>Promise<void>){
  if(lock.current||disabled)return;lock.current=true;setBusy(true);setError('');setNotice('');setCopied(false);
  try{await work();}catch(failure){if(alive.current)setError(failure instanceof EstimateGrantUnavailableError?failure.message:'The client link could not be confirmed. Use “Recover client links” to check this request before issuing another.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 /** Activate a captured grant if needed, then show whatever the creator may see. */
 async function settle(result:EstimateGrantOutcome,intent:EstimateIssuedGrant['intent']){
  let current=result;
  if(current.status==='not_active'&&current.grant.state==='captured'){
   const p=await preview();
   await grants.activate(current.grant,p.publication_head);
   current=await grants.recover(intent);
  }
  if(!alive.current)return;
  if(current.status==='link'){setLink({url:current.url,expires_at:current.expires_at});setNotice('Client link ready. Send it only to the named recipient; anyone holding it can record a decision.');}
  else if(current.status==='issuance_disabled'){setLink(null);setNotice(disabledNotice);}
  else if(current.status==='absent'){setLink(null);setNotice('No saved request was found for this link yet. An absent recovery is not cancellation; try again shortly.');}
  else {setLink(null);setNotice(`This link is ${current.grant.state} and cannot be shown.`);}
 }
 function issue(){void run(async()=>{
  const p=await preview();
  const intent=grants.intent(p,{recipient_label:recipient,purpose,expires_at:expires||p.expires_at,attest_recipient_authority:attest});
  const result=await grants.prepare(intent);
  await settle(result,intent);
  if(alive.current){setRecipient('');setAttest(false);setExpires('');}
 });}
 function list(){void run(async()=>{const mine=await grants.issued();if(alive.current){setIssued(mine);if(!mine.length)setNotice('You have not issued a client link for this estimate.');}});}
 function recover(grant:EstimateIssuedGrant){void run(async()=>{await settle(await grants.recover(grant.intent),grant.intent);});}
 async function copy(){if(!link)return;try{await navigator.clipboard.writeText(link.url);if(alive.current)setCopied(true);}catch{if(alive.current)setError('Copy failed. Select the link and copy it manually.');}}
 const ready=!disabled&&!busy&&!!recipient.trim()&&!!purpose.trim()&&attest;
 return <section aria-label="Client estimate link" className="space-y-3 rounded-md border border-border p-3">
  <h4 className="font-semibold">Client estimate link</h4>
  <p className="text-sm text-muted-foreground">Issue a private link the client opens to review this exact published estimate and accept or decline it. The decision is attributed to the link holder, not a verified signature.</p>
  {error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {link&&<div className="space-y-2"><label className="block text-sm">Client link (expires {time(link.expires_at)}, Mountain Time)<input readOnly className="block w-full rounded-md border border-input bg-background p-2 font-mono text-xs" value={link.url} onFocus={e=>e.currentTarget.select()}/></label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={()=>void copy()}>{copied?'Copied':'Copy link'}</Button><Button type="button" variant="outline" onClick={()=>{setLink(null);setNotice('');}}>Hide link</Button></div></div>}
  <fieldset disabled={disabled||busy} className="space-y-3">
   <label className="block">Recipient<input className="block w-full rounded-md border border-input bg-background p-2" value={recipient} placeholder="Name and relationship, e.g. Jane Doe (owner)" onChange={e=>{setRecipient(e.target.value);setAttest(false);}}/></label>
   <label className="block">Purpose<input className="block w-full rounded-md border border-input bg-background p-2" value={purpose} onChange={e=>{setPurpose(e.target.value);setAttest(false);}}/></label>
   <label className="block">Link expires (Mountain Time; defaults to the estimate's acceptance deadline)<input type="datetime-local" className="block w-full rounded-md border border-input bg-background p-2" value={expires?denverLocal(expires):''} onChange={e=>{setAttest(false);if(!e.target.value){setExpires('');return;}try{setExpires(denverInstant(e.target.value));setError('');}catch(failure){setExpires('');setError(failure instanceof Error?failure.message:'Choose a valid expiry.');}}}/></label>
   <label className="flex items-start gap-2"><input type="checkbox" checked={attest} onChange={e=>setAttest(e.target.checked)}/>The named recipient is the patient's owner or someone they have authorized to decide on this estimate.</label>
   <div className="flex flex-wrap gap-2"><Button type="button" onClick={issue} disabled={!ready}>Issue client link</Button><Button type="button" variant="outline" onClick={list} disabled={disabled||busy}>Recover client links</Button></div>
  </fieldset>
  {issued&&issued.length>0&&<ul className="space-y-2">{issued.map(g=><li key={g.intent.id} className="flex flex-col gap-2 rounded-md border border-border p-2 md:flex-row md:items-center md:justify-between"><span className="text-sm">{g.intent.request.recipient_label} · issued {time(g.issued_at)} · expires {time(g.intent.request.expires_at)} · {g.eligibility.replace('_',' ')}</span><Button type="button" variant="outline" disabled={busy||!['preparing','captured','active'].includes(g.eligibility)} onClick={()=>recover(g)}>Show link</Button></li>)}</ul>}
 </section>;
}
