import { z } from 'zod';
import { validEstimateDecisionCapability, verifyEstimateDecisionCapability, type EstimateDecisionConfig, type EstimateDecisionCapabilityGrant } from './estimate-decision-capability.ts';
import { estimateClientDecisionRequestSchema, estimateDecisionBindingSchema, estimateDecisionHeadSchema, estimatePublicDecisionSchema, estimatePublicDecisionReceiptSchema, verifyEstimateDecisionResolution, sameEstimateDecisionEvidence as equal } from './estimate-decision-contract.ts';
import { estimatePublicationSnapshotSchema } from './estimate-publication-document.ts';

export interface EstimateDecisionDatabase { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}> }
export interface EstimateDecisionHttpDependencies {
  db:EstimateDecisionDatabase;
  config:EstimateDecisionConfig;
  /** Deployment-owned bounded limiter; returning false must happen before database work. */
  rateLimit(request:Request):Promise<boolean>;
}
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
const text=(max:number)=>z.string().refine(v=>v===v.trim()&&Array.from(v).length>=1&&Array.from(v).length<=max&&!/[\uD800-\uDFFF]/u.test(v)&&!Array.from(v).some(c=>{const n=c.charCodeAt(0);return n===127||(n<32&&n!==9&&n!==10);}));
const issueRequest=z.object({binding:estimateDecisionBindingSchema,expected_publication_head:estimateDecisionHeadSchema,expires_at:instant,recipient_label:text(200),purpose:text(500),attest_recipient_authority:z.literal(true)}).strict();
const activation=z.object({id:uuid,actor_id:uuid,created_at:instant}).strict();
const grantSchema=z.object({version:z.literal(1),id:uuid,actor_id:uuid,request:issueRequest,request_hash:hash,created_at:instant,
  capability:z.object({origin:z.string(),key_version:z.string(),context_hash:hash}).strict(),capture:z.object({token_hash:hash,captured_at:instant}).strict(),head:estimateDecisionHeadSchema,state:z.enum(['captured','active','revoked']),activation:activation.nullable(),revocation:activation.extend({reason:text(2000)}).strict().nullable(),
}).strict();
const accessSchema=z.object({grant:grantSchema,capability_context:z.string().max(8192),context_hash:hash,captured:z.literal(true)}).strict();
const bodySchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('read'),grant_id:uuid}).strict(),
  z.object({action:z.enum(['record','recover','close']),id:uuid,request:estimateClientDecisionRequestSchema}).strict(),
]);
function requireEvidence(condition:unknown):asserts condition {if(!condition) throw new Error('Invalid estimate evidence');}
function constantTime(a:string,b:string):boolean {let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;}
async function sha(bytes:Uint8Array<ArrayBuffer>):Promise<string> {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
export async function validateEstimatePublicReview(value:unknown,grant:EstimateDecisionCapabilityGrant):Promise<EstimatePublicReview> {
  const r=estimatePublicReviewSchema.parse(value);
  requireEvidence(r.grant_id===grant.id&&equal(r.binding,grant.binding)&&r.artifact.sha256===grant.binding.artifact_hash);
  requireEvidence(!r.decision||equal(r.decision.binding,r.binding));
  requireEvidence(r.publication_head.version>0);
  const match=/^estimate-(.*)-draft-(\d+)-publication-(.*)\.html$/.exec(r.artifact.filename);
  requireEvidence(match&&match[1]===grant.binding.target.estimate_id&&uuid.safeParse(match[3]).success&&Number(match[2])<=2147483647);
  requireEvidence(r.content_base64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(r.content_base64));
  const raw=atob(r.content_base64);requireEvidence(btoa(raw)===r.content_base64&&raw.length===r.artifact.byte_length);
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  requireEvidence(constantTime(await sha(bytes),r.artifact.sha256));
  // Deadline belongs to the frozen publication; a grant may expire earlier.
  requireEvidence(Date.parse(grant.expires_at)<=Date.parse(r.review.expires_at));
  const next=new Date(Date.parse(r.review.accept_by+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(r.review.expires_at)).map(p=>[p.type,p.value]));
  requireEvidence(`${parts.year}-${parts.month}-${parts.day}`===next&&parts.hour==='00'&&parts.minute==='00'&&parts.second==='00'&&!/\.(?!0+Z)\d+Z$/.test(r.review.expires_at));
  return r;
}
async function readBody(req:Request):Promise<unknown> {
  requireEvidence(req.headers.get('content-type')?.split(';')[0].trim()==='application/json');
  const length=req.headers.get('content-length');
  requireEvidence(!length||(/^\d+$/.test(length)&&Number(length)<=65536));
  const reader=req.body?.getReader();requireEvidence(reader);
  const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;requireEvidence(size<=65536);chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function createEstimateDecisionHandler(deps:EstimateDecisionHttpDependencies) {
  return async(req:Request):Promise<Response>=>{
    const allowed=req.headers.get('origin')===deps.config.origin;
    const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store, private',Pragma:'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',Vary:'Origin'};
    if(allowed){headers['Access-Control-Allow-Origin']=deps.config.origin;headers['Access-Control-Allow-Headers']='content-type,x-estimate-capability,apikey';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
    const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
    const unavailable=()=>response({error:'Estimate access unavailable'},404);
    try {
      if(!allowed||!deps.config.publicEnabled)return unavailable();
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(req.method!=='POST'||req.headers.has('authorization')||req.headers.has('cookie'))return unavailable();
      if(!await deps.rateLimit(req))return response({error:'Estimate access unavailable'},429);
      const body=bodySchema.parse(await readBody(req));
      const token=req.headers.get('x-estimate-capability');
      requireEvidence(validEstimateDecisionCapability(token));
      const grantId=body.action==='read'?body.grant_id:body.request.grant_id;
      const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await deps.db.rpc(name,args);if(error)throw new Error('Estimate access unavailable');return data;};
      const a=accessSchema.parse(await rpc('native_estimate_decision_access_context',{p_grant_id:grantId}));
      const g=a.grant;
      requireEvidence(g.id===grantId&&g.capability.context_hash===a.context_hash);
      const grant:EstimateDecisionCapabilityGrant={id:g.id,actor_id:g.actor_id,binding:g.request.binding,expires_at:g.request.expires_at,origin:g.capability.origin,key_version:g.capability.key_version,capability_context:a.capability_context,context_hash:a.context_hash};
      const tokenHash=await verifyEstimateDecisionCapability(token,grant,deps.config);
      requireEvidence(constantTime(tokenHash,g.capture.token_hash));
      const proof={p_token_hash:tokenHash,p_origin:grant.origin,p_key_version:grant.key_version};
      if(body.action==='read')return response(await validateEstimatePublicReview(await rpc('retrieve_native_estimate_decision',{p_grant_id:grantId,...proof}),grant));
      requireEvidence(equal(body.request.binding,grant.binding));
      const data=await rpc(`${body.action==='record'?'record':body.action==='recover'?'recover':'close'}_native_estimate_client_decision`,{p_id:body.id,p_request:body.request,...proof});
      const operation={version:1,id:body.id,grant_id:grantId,publication_id:body.request.binding.publication_id,request:body.request};
      if(body.action==='record'){
        const receipt=estimatePublicDecisionReceiptSchema.parse(data);
        verifyEstimateDecisionResolution({version:1,status:'recorded',receipt},operation,true);
        return response(receipt);
      }
      return response(verifyEstimateDecisionResolution(data,operation,body.action==='close'));
    }catch{return unavailable();}
  };
}
