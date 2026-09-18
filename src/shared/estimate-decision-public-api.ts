import { z } from "zod";
import { estimatePublicationSnapshotSchema } from "../../supabase/functions/_shared/estimate-publication-document.ts";
import { estimateClientDecisionOperationSchema, estimateDecisionBindingSchema, estimateDecisionHeadSchema, estimatePublicDecisionSchema, estimatePublicDecisionReceiptSchema, verifyEstimateDecisionResolution, sameEstimateDecisionEvidence as equal } from "../../supabase/functions/_shared/estimate-decision-contract.ts";
import { retainPendingEstimateDecision, resolvePendingEstimateDecision, type EstimateDecisionStorage } from "./estimate-decision-state.ts";
const uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.string().datetime().refine(v=>Number.isFinite(Date.parse(v))&&!/\.\d{7}/.test(v));
const s=estimatePublicationSnapshotSchema.innerType().shape;
const artifact=z.object({filename:z.string().max(255).regex(/^estimate-[a-f0-9-]{36}-draft-[1-9]\d{0,9}-publication-[a-f0-9-]{36}\.html$/),mime_type:z.literal('text/html; charset=utf-8'),byte_length:z.number().int().min(1).max(2097152),sha256:hash,renderer_version:z.literal(1)}).strict();
export const estimatePublicReviewSchema=z.object({
  version:z.literal(1),grant_id:uuid,binding:estimateDecisionBindingSchema,publication_head:estimateDecisionHeadSchema,
  publication_status:z.enum(['open','expired','superseded','withdrawn']),decision:estimatePublicDecisionSchema.nullable(),
  review:z.object({practice:z.object({name:s.practice.shape.name,address:s.practice.shape.address,domain:s.practice.shape.domain}).strict(),household_name:s.client.shape.name,patient:z.object({name:s.patient.shape.name,species:s.patient.shape.species,breed:s.patient.shape.breed}).strict(),title:s.title,total_cents:s.total_cents,currency:z.literal('usd'),accept_by:s.acceptance.shape.accept_by,expires_at:instant,acknowledgment_version:z.literal(1),scope:z.literal('entire_exact_revision'),not_clinical_consent:z.literal(true),not_payment:z.literal(true)}).strict(),
  artifact,content_base64:z.string().min(4).max(2796204),
}).strict();
export interface EstimatePublicReview extends z.infer<typeof estimatePublicReviewSchema> {}
export interface EstimateDecisionBootstrapEnvironment {
  location: { pathname:string; search:string; hash:string };
  history: { replaceState(data:unknown,unused:string,url:string):void };
  addEventListener(event:'pagehide'|'hashchange',listener:()=>void):void;
  removeEventListener(event:'pagehide'|'hashchange',listener:()=>void):void;
}
export interface EstimateDecisionAccess { readonly grantId:string; available():boolean; retire():void }
interface Secret {token:string; controllers:Set<AbortController>}
const secrets=new WeakMap<EstimateDecisionAccess,Secret>();
function fail():never {throw new Error('Estimate access or outcome could not be verified. Keep the original request for recovery.');}
function verify(condition:unknown):asserts condition {if(!condition)fail();}
export function isEstimateDecisionRoute(pathname:string):boolean {return pathname==='/estimate'||pathname.startsWith('/estimate/');}
/** Invoke synchronously before importing the public page. No storage/auth/analytics access. */
export function bootstrapEstimateDecisionAccess(env:EstimateDecisionBootstrapEnvironment):EstimateDecisionAccess|null {
  if(!isEstimateDecisionRoute(env.location.pathname))return null;
  const path=env.location.pathname,match=/^\/estimate\/([a-f0-9-]{36})$/.exec(path);
  let token=env.location.hash.slice(1);
  const valid=!!match&&uuid.safeParse(match[1]).success&&env.location.search===''&&/^e1\.[A-Za-z0-9_-]{43}$/.test(token)&&'AEIMQUYcgkosw048'.includes(token.slice(-1));
  // Strip even invalid links. If history cannot strip, never retain a capability.
  try{env.history.replaceState(null,'',path);}catch{token='';}
  const secret:Secret={token:valid?token:'',controllers:new Set()};
  const retire=()=>{secret.token='';for(const c of secret.controllers)c.abort();secret.controllers.clear();env.removeEventListener('pagehide',hide);env.removeEventListener('hashchange',changed);};
  const hide=()=>retire();
  const changed=()=>{retire();try{env.history.replaceState(null,'',env.location.pathname);}catch{/* Capability is already retired; never recover it from the fragment. */}};
  const access:EstimateDecisionAccess=Object.freeze({grantId:match?.[1]??'',available:()=>secret.token!=='',retire});
  secrets.set(access,secret);env.addEventListener('pagehide',hide);env.addEventListener('hashchange',changed);
  token='';return access;
}
async function parseReview(value:unknown,grantId:string){
  const r=estimatePublicReviewSchema.parse(value);
  verify(r.grant_id===grantId&&r.publication_head.version>0&&r.artifact.sha256===r.binding.artifact_hash&&(!r.decision||equal(r.decision.binding,r.binding)));
  const m=/^estimate-(.*)-draft-(\d+)-publication-(.*)\.html$/.exec(r.artifact.filename);
  verify(m&&m[1]===r.binding.target.estimate_id&&uuid.safeParse(m[3]).success&&Number(m[2])<=2147483647);
  verify(r.content_base64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(r.content_base64));
  const raw=atob(r.content_base64);verify(btoa(raw)===r.content_base64&&raw.length===r.artifact.byte_length);
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');verify(digest===r.artifact.sha256);
  const next=new Date(Date.parse(r.review.accept_by+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(r.review.expires_at)).map(v=>[v.type,v.value]));
  verify(`${p.year}-${p.month}-${p.day}`===next&&p.hour==='00'&&p.minute==='00'&&p.second==='00'&&!/\.(?!0+Z)\d+Z$/.test(r.review.expires_at));
  return {review:r,document:new Blob([bytes],{type:r.artifact.mime_type})};
}
async function limitedJson(response:Response,limit:number){
  verify(response.ok&&!response.redirected&&response.headers.get('content-type')?.split(';')[0].trim()==='application/json');
  const length=response.headers.get('content-length');verify(!length||(/^\d+$/.test(length)&&Number(length)<=limit));
  const reader=response.body?.getReader();verify(reader);const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;verify(size<=limit);chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export interface EstimateDecisionPublicApiOptions {
  baseUrl:string;publishableKey?:string;storage:EstimateDecisionStorage;fetcher?:typeof fetch;
}
export function createEstimateDecisionPublicApi(access:EstimateDecisionAccess,options:EstimateDecisionPublicApiOptions){
  const secret=secrets.get(access);verify(secret);
  const origin=new URL(options.baseUrl);verify(origin.origin===options.baseUrl&&(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))));
  let reviewed:EstimatePublicReview|null=null;
  async function call(body:unknown,limit:number,signal?:AbortSignal){
    verify(access.available());const controller=new AbortController();secret!.controllers.add(controller);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
    const deadline=setTimeout(abort,15000);
    try{
      const encoded=JSON.stringify(body);verify(new TextEncoder().encode(encoded).length<=65536);
      const response=await (options.fetcher??fetch)(`${origin.origin}/functions/v1/estimate-decision`,{method:'POST',headers:{'Content-Type':'application/json','X-Estimate-Capability':secret!.token,...(options.publishableKey?{apikey:options.publishableKey}:{})},body:encoded,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      const data=await limitedJson(response,limit);verify(access.available()&&!controller.signal.aborted);return data;
    }catch{fail();}finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);secret!.controllers.delete(controller);}
  }
  async function mutate(action:'record'|'recover'|'close',input:unknown,signal?:AbortSignal){
    const operation=estimateClientDecisionOperationSchema.parse(input);verify(operation.grant_id===access.grantId);
    if(action==='record')verify(reviewed&&equal(operation.request.binding,reviewed.binding)&&equal(operation.request.expected_publication_head,reviewed.publication_head));
    retainPendingEstimateDecision(options.storage,operation);
    const data=await call({action,id:operation.id,request:operation.request},65536,signal);
    const resolution=action==='record'?verifyEstimateDecisionResolution({version:1,status:'recorded',receipt:estimatePublicDecisionReceiptSchema.parse(data)},operation,true):verifyEstimateDecisionResolution(data,operation,action==='close');
    verify(access.available());if(resolution.status!=='unrecorded')resolvePendingEstimateDecision(options.storage,operation,resolution);
    return resolution;
  }
  return {
    async read(signal?:AbortSignal){const result=await parseReview(await call({action:'read',grant_id:access.grantId},3*1024*1024,signal),access.grantId);verify(access.available()&&!signal?.aborted);if(reviewed)verify(equal(reviewed.binding,result.review.binding));reviewed=result.review;return result;},
    record:(operation:unknown,signal?:AbortSignal)=>mutate('record',operation,signal),
    recover:(operation:unknown,signal?:AbortSignal)=>mutate('recover',operation,signal),
    close:(operation:unknown,signal?:AbortSignal)=>mutate('close',operation,signal),
    retire:()=>{reviewed=null;access.retire();},
  };
}
