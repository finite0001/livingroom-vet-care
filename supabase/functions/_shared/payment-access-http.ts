import {materializePaymentAccess, materializePaymentCheckout, paymentCapabilityHash, paymentGrantFromContext, validPaymentCapability} from "./payment-access-capability.ts";
import type {PaymentAccessConfig, PaymentScopedCheckoutIntent} from "./payment-access-capability.ts";
import {checkoutEvidence} from "./stripe-provider.ts";
import type {CheckoutEvidence, StripeObject} from "./stripe-provider.ts";
export interface PublicPaymentState {
  state: string;
  amount_cents: string;
  currency: "usd";
  expires_at: string;
  status_expires_at: string;
  confirmed_paid_cents: string;
  confirmed_refunded_cents: string;
}
export interface PaymentActivation {
  state: string;
  attempt: (PaymentScopedCheckoutIntent & {state: string; current_source_matches: boolean; session_id: string | null}) | null;
}
export interface PaymentAccessDependencies {
  config: () => PaymentAccessConfig;
  providerEnabled: boolean;
  collectionsEnabled: boolean;
  context: (grantId: string) => Promise<unknown>;
  inspect: (grantId: string, hash: string, origin: string, version: string) => Promise<unknown>;
  status: (grantId: string, hash: string, origin: string, version: string) => Promise<unknown>;
  activate: (grantId: string, hash: string, origin: string, version: string, allowCreate: boolean) => Promise<PaymentActivation>;
  create: (intent: PaymentScopedCheckoutIntent) => Promise<StripeObject>;
  retrieve: (sessionId: string) => Promise<StripeObject>;
  apply: (intent: PaymentScopedCheckoutIntent, evidence: CheckoutEvidence, eventId: string) => Promise<"accepted" | "quarantined">;
  quarantine: (requestId: string) => Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function same(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let difference = 0; for (let i=0;i<b.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function denied(error: unknown): boolean {return !!error && typeof error === "object" && "code" in error && error.code === "42501";}
function projection(value: unknown): PublicPaymentState {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Invalid payment state");
  const p=value as PublicPaymentState;
  if (!["ready","confirmation_pending","paid","partially_refunded","refunded","reconciliation"].includes(p.state) || p.currency!=="usd" ||
      ![p.amount_cents,p.confirmed_paid_cents,p.confirmed_refunded_cents].every(v=>typeof v==="string" && /^(0|[1-9][0-9]{0,29})$/.test(v)) ||
      BigInt(p.confirmed_refunded_cents)>BigInt(p.confirmed_paid_cents) || ![p.expires_at,p.status_expires_at].every(v=>typeof v==="string" && Number.isFinite(Date.parse(v))) || Date.parse(p.status_expires_at)<Date.parse(p.expires_at)) throw new Error("Invalid payment state");
  const amount=BigInt(p.amount_cents),paid=BigInt(p.confirmed_paid_cents),refunded=BigInt(p.confirmed_refunded_cents);
  if(amount<50n || amount>99999999n ||
    (p.state==="paid" && (paid<amount || refunded!==0n)) ||
    (p.state==="partially_refunded" && (paid<amount || refunded===0n || refunded>=paid)) ||
    (p.state==="refunded" && (paid<amount || refunded!==paid)) ||
    (["ready","confirmation_pending"].includes(p.state) && (paid!==0n || refunded!==0n))) throw new Error("Invalid payment state");
  return {state:p.state,amount_cents:p.amount_cents,currency:p.currency,expires_at:p.expires_at,status_expires_at:p.status_expires_at,confirmed_paid_cents:p.confirmed_paid_cents,confirmed_refunded_cents:p.confirmed_refunded_cents};
}
async function body(request: Request): Promise<Record<string,unknown>> {
  if (!request.body || request.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json") throw new Error("Invalid request");
  const reader=request.body.getReader(); const chunks: Uint8Array[]=[];let size=0;
  try {for (;;) {const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024){await reader.cancel();throw new Error("Invalid request");}chunks.push(part.value);}} finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if (!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("Invalid request");return parsed;
}
async function observationId(intent: PaymentScopedCheckoutIntent, evidence: CheckoutEvidence) {
  const bytes=new TextEncoder().encode(JSON.stringify([intent.id,intent.account_id,intent.livemode,evidence.session_id,evidence.payment_id,evidence.state,evidence.amount_cents,evidence.currency,intent.source_hash]));
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return "observe:"+Array.from(digest,v=>v.toString(16).padStart(2,"0")).join("");
}
export function createPaymentAccessHandler(role: "collection"|"status", deps: PaymentAccessDependencies) {
  return async (request: Request): Promise<Response> => {
    let config: PaymentAccessConfig;
    const baseHeaders={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Vary":"Origin"};
    try {config=deps.config();} catch {return Response.json({error:"unavailable"},{status:503,headers:baseHeaders});}
    const headers={...baseHeaders,"Access-Control-Allow-Origin":config.origin};
    const reply=(status:number,value:object)=>Response.json(value,{status,headers});
    if (request.headers.get("Origin") && request.headers.get("Origin")!==config.origin) return reply(403,{error:"unavailable"});
    if (request.method==="OPTIONS") return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Methods":"POST","Access-Control-Allow-Headers":"content-type,apikey,x-client-info"}});
    if (request.method!=="POST" || new URL(request.url).search) return reply(405,{error:"unavailable"});
    if (!(role==="collection"?config.collectionEnabled:config.statusEnabled)) return reply(503,{error:"unavailable"});
    let input: Record<string,unknown>;
    try {input=await body(request);if(Object.keys(input).sort().join(",")!==(role==="collection"?"action,grant_id,token":"grant_id,token") || typeof input.grant_id!=="string" || !uuid.test(input.grant_id) || !validPaymentCapability(input.token,role) || (role==="collection" && (typeof input.action!=="string" || !["inspect","activate"].includes(input.action)))) throw new Error("Invalid request");} catch {return reply(404,{error:"unavailable"});}
    const id=input.grant_id as string,token=input.token as string;
    let grant: ReturnType<typeof paymentGrantFromContext>, access: Awaited<ReturnType<typeof materializePaymentAccess>>;
    let envelope: unknown;
    try {envelope=await deps.context(id);} catch(error){return reply(denied(error)?404:503,{error:"unavailable"});}
    try {
      grant=paymentGrantFromContext(envelope);
      if (grant.id!==id) throw new Error("Unavailable");
      access=await materializePaymentAccess(grant,config);
      const capture=(envelope as {capture:Record<string,unknown>}).capture;
      if (!same(token,role==="collection"?access.collection_token:access.status_token) ||
          !same(capture.collection_token_hash,access.collection_token_hash) || !same(capture.status_token_hash,access.status_token_hash) ||
          !same(await paymentCapabilityHash(token,role),role==="collection"?access.collection_token_hash:access.status_token_hash)) throw new Error("Unavailable");
    } catch {return reply(404,{error:"unavailable"});}
    const scoped=(value:unknown)=>{
      const p=projection(value);
      if(p.amount_cents!==grant.amount_cents || p.currency!==grant.currency || Date.parse(p.expires_at)!==Date.parse(grant.expires_at) || Date.parse(p.status_expires_at)!==Date.parse(grant.status_expires_at)) throw new Error("Payment scope mismatch");
      return p;
    };
    const inspect=async()=>scoped(await deps.inspect(id,access.collection_token_hash,grant.origin,grant.key_version));
    const status=async()=>scoped(await deps.status(id,access.status_token_hash,grant.origin,grant.key_version));
    if(role==="status") {try{return reply(200,await status());}catch(error){return reply(denied(error)?404:503,{error:"unavailable"});}}
    let current: PublicPaymentState;
    try {current=await inspect();} catch(error) {
      if(denied(error) && config.statusEnabled){try{return reply(200,{...await status(),collection_available:false});}catch{/* Generic unavailable below. */}}
      return reply(denied(error)?404:503,{error:"unavailable"});
    }
    const available=(state:PublicPaymentState)=>deps.providerEnabled && (state.state==="confirmation_pending" || (deps.collectionsEnabled && state.state==="ready"));
    if(input.action==="inspect" || !deps.providerEnabled || !["ready","confirmation_pending"].includes(current.state)) return reply(200,{...current,collection_available:available(current)});
    for(let step=0;step<2;step++) {
      let result: PaymentActivation;
      try {result=await deps.activate(id,access.collection_token_hash,grant.origin,grant.key_version,deps.collectionsEnabled);} catch(error){return reply(denied(error)?200:503,denied(error)?{...current,collection_available:false}:{error:"unavailable"});}
      if(!result.attempt){try{return reply(200,{...await inspect(),collection_available:false});}catch{return reply(404,{error:"unavailable"});}}
      const intent=result.attempt;
      let exact: PaymentScopedCheckoutIntent;
      try {exact=await materializePaymentCheckout(intent,grant,config);} catch {
        try {await deps.quarantine(intent.id);} catch{return reply(202,{...current,state:"confirmation_pending",collection_available:false});}
        return reply(200,{...current,state:"reconciliation",collection_available:false});
      }
      if(!intent.current_source_matches || !["prepared","open"].includes(intent.state)) return reply(200,{...current,state:"reconciliation",collection_available:false});
      if(!intent.session_id && !deps.collectionsEnabled) return reply(200,{...current,collection_available:false});
      let value: StripeObject;
      try {value=intent.session_id?await deps.retrieve(intent.session_id):await deps.create(exact);} catch{return reply(202,{...current,state:"confirmation_pending",collection_available:false});}
      let evidence: CheckoutEvidence;
      try {evidence=checkoutEvidence(value,intent);if(evidence.client_url && evidence.client_url.length>4096) throw new Error("Provider URL invalid");if(intent.session_id && evidence.session_id!==intent.session_id) throw new Error("Provider identity mismatch");} catch {
        try {await deps.quarantine(intent.id);} catch{return reply(202,{...current,state:"confirmation_pending",collection_available:false});}
        return reply(200,{...current,state:"reconciliation",collection_available:false});
      }
      try {if(await deps.apply(intent,evidence,await observationId(intent,evidence))!=="accepted") return reply(200,{...current,state:"reconciliation",collection_available:false});} catch{return reply(202,{...current,state:"confirmation_pending",collection_available:false});}
      try {current=await inspect();} catch(error) {
        if(denied(error) && config.statusEnabled){try{return reply(200,{...await status(),collection_available:false});}catch{/* Do not release URL. */}}
        return reply(denied(error)?404:503,{error:"unavailable"});
      }
      if(evidence.state==="session_open" && current.state==="confirmation_pending") {
        return reply(200,{...current,state:"checkout_ready",collection_available:true,checkout_url:evidence.client_url});
      }
      if(evidence.state==="session_expired" && current.state==="ready" && step===0 && deps.collectionsEnabled) continue;
      return reply(200,{...current,collection_available:available(current)});
    }
    return reply(200,{...current,collection_available:available(current)});
  };
}
