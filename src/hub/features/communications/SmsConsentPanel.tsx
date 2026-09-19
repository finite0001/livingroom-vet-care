import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClientConsent, useUpdateConsent } from "@/hub/hooks/use-sms-consent";
interface SmsConsentPanelProps { clientId: string; }
interface ConsentDraft { phone: string; expected: string | null; optedIn: boolean; method: "VERBAL" | "WRITTEN" | "WEB_FORM"; details: string; }
export function SmsConsentPanel({clientId}:SmsConsentPanelProps) {
 const query=useClientConsent(clientId); const save=useUpdateConsent();
 const [draft,setDraft]=useState<ConsentDraft|null>(null); const [notice,setNotice]=useState("");
 const start=()=>{
  if(!query.data?.phone_number)return;
  setDraft({phone:query.data.phone_number,expected:query.data.updated_at,optedIn:false,method:"VERBAL",details:""});
  setNotice("");save.reset();
 };
 const submit=async()=>{
  if(!draft)return;
  try {
   await save.mutateAsync({clientId,phoneNumber:draft.phone,optedIn:draft.optedIn,method:draft.method,details:draft.details,expectedUpdatedAt:draft.expected});
   setDraft(null);setNotice("Consent record saved. Effective messaging permission is checked again before delivery.");
  } catch { /* Mutation retains the form and exposes the server error below. */ }
 };
 return <section aria-label="SMS consent" className="rounded-lg border bg-card p-4 space-y-3">
  <h2 className="font-semibold">SMS consent</h2>
  {query.isLoading?<p>Loading consent…</p>:query.isError?<p role="alert">Unable to load consent. <button className="underline" onClick={()=>void query.refetch()}>Retry</button></p>:<>
   <p className="text-sm">{query.data?.phone_number??"No valid primary phone number"}</p>
   <p className="text-sm text-muted-foreground">{query.data?.can_message?"SMS consent is recorded and the number is eligible for messaging.":"SMS is blocked. Consent may be missing, withdrawn, shared or suppressed."}</p>
   {query.data?.consent_details&&<p className="text-sm whitespace-pre-wrap">Recorded evidence: {query.data.consent_details}</p>}
   {!draft&&<Button variant="outline" disabled={!query.data?.phone_number} onClick={start}>Record consent or withdrawal</Button>}
  </>}
  {draft&&<fieldset disabled={save.isPending} className="space-y-3">
   <legend className="text-sm font-medium">Record the client’s stated preference</legend>
   <div className="space-y-1"><Label htmlFor="sms-preference">Preference</Label><select id="sms-preference" className="w-full rounded-md border bg-background p-2" value={draft.optedIn?"yes":"no"} onChange={e=>setDraft({...draft,optedIn:e.target.value==='yes'})}><option value="no">Withdraw / do not allow SMS</option><option value="yes">Client explicitly agrees to SMS</option></select></div>
   <div className="space-y-1"><Label htmlFor="sms-method">How was this preference received?</Label><select id="sms-method" className="w-full rounded-md border bg-background p-2" value={draft.method} onChange={e=>setDraft({...draft,method:e.target.value as ConsentDraft['method']})}><option value="VERBAL">Verbal</option><option value="WRITTEN">Written</option><option value="WEB_FORM">Web form</option></select></div>
   <div className="space-y-1"><Label htmlFor="sms-evidence">Consent evidence</Label><Textarea id="sms-evidence" maxLength={1000} value={draft.details} onChange={e=>setDraft({...draft,details:e.target.value})} placeholder="Who gave this preference, when and where it was documented" /></div>
   <p className="text-xs text-muted-foreground">This records consent for {draft.phone}. It does not remove provider complaints or other delivery exclusions.</p>
   {save.isError&&<p role="alert" className="text-sm text-destructive">{save.error instanceof Error?save.error.message:"Consent could not be saved. Reload the saved record and review before retrying."} Your entry is preserved.</p>}
   <div className="flex flex-wrap gap-2"><Button disabled={draft.details.trim().length<5||save.isPending} onClick={()=>void submit()}>{save.isPending?"Saving…":"Save consent record"}</Button><Button variant="outline" onClick={()=>{if(window.confirm("Discard this unsaved consent entry?")){setDraft(null);save.reset();void query.refetch();}}}>Discard and reload</Button></div>
  </fieldset>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
