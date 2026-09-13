import type {CheckoutIntent} from "./stripe-provider.ts";
export interface PaymentAccessConfig {
  origin: string;
  activeKeyVersion: string;
  keys: Record<string, string>;
  collectionEnabled: boolean;
  statusEnabled: boolean;
}
export interface PaymentAccessGrant {
  id: string;
  actor_id: string;
  invoice_id: string;
  client_id: string;
  amount_cents: string;
  currency: string;
  source_hash: string;
  created_at: string;
  expires_at: string;
  status_expires_at: string;
  origin: string;
  key_version: string;
  capability_context: string;
  context_hash: string;
}
export interface PaymentAccessValues {
  origin?: string;
  activeKeyVersion?: string;
  keys?: string;
  collectionEnabled?: string;
  statusEnabled?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unavailable(): never {throw new Error("Payment access unavailable");}
function keyBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) unavailable();
  let binary: string;
  try {binary = atob(value);} catch {unavailable();}
  if (binary.length < 32 || binary.length > 64 || btoa(binary) !== value) unavailable();
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function paymentAccessConfig(values: PaymentAccessValues): PaymentAccessConfig {
  let url: URL; let keys: unknown;
  try {url = new URL(values.origin ?? ""); keys = JSON.parse(values.keys ?? "{}");} catch {unavailable();}
  if (url.protocol !== "https:" || url.origin !== values.origin || !/^[A-Za-z0-9_-]{1,40}$/.test(values.activeKeyVersion ?? "") ||
      !keys || typeof keys !== "object" || Array.isArray(keys) || !Object.hasOwn(keys, values.activeKeyVersion!)) unavailable();
  if (Object.keys(keys).length > 16) unavailable();
  for (const [version,value] of Object.entries(keys)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(version)) unavailable();
    keyBytes(value);
  }
  return {origin: url.origin, activeKeyVersion: values.activeKeyVersion!, keys: keys as Record<string,string>,
    collectionEnabled: values.collectionEnabled === "true", statusEnabled: values.statusEnabled === "true"};
}
function date(value: string): string {
  const time = Date.parse(value); if (!Number.isFinite(time)) unavailable(); return new Date(time).toISOString();
}
function context(grant: PaymentAccessGrant): string[] {
  if (![grant.id,grant.actor_id,grant.invoice_id,grant.client_id].every(value => typeof value === "string" && uuid.test(value)) ||
      !/^[1-9][0-9]{0,7}$/.test(grant.amount_cents) || BigInt(grant.amount_cents) < 50n || grant.currency !== "usd" ||
      !/^[0-9a-f]{64}$/.test(grant.source_hash)) unavailable();
  const created = date(grant.created_at), expires = date(grant.expires_at), statusExpires = date(grant.status_expires_at);
  if (Date.parse(expires) <= Date.parse(created) || Date.parse(expires)-Date.parse(created) > 7*86400000 ||
      Date.parse(statusExpires) <= Date.parse(expires) || Date.parse(statusExpires)-Date.parse(expires) > 30*86400000) unavailable();
  return [grant.id.toLowerCase(),grant.actor_id.toLowerCase(),grant.invoice_id.toLowerCase(),grant.client_id.toLowerCase(),
    grant.amount_cents,grant.currency,grant.source_hash,created,expires,statusExpires,grant.origin,grant.key_version];
}
export function validPaymentCapability(token: unknown, role: "collection" | "status"): token is string {
  return typeof token === "string" && (role === "collection" ? /^p1\.[A-Za-z0-9_-]{43}$/ : /^s1\.[A-Za-z0-9_-]{43}$/).test(token);
}
export async function paymentCapabilityHash(token: string, role: "collection" | "status"): Promise<string> {
  if (!validPaymentCapability(token,role)) unavailable();
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2,"0")).join("");
}
/** These returned tokens/URLs are transient; capture only the hashes in PostgreSQL. */
export async function materializePaymentAccess(grant: PaymentAccessGrant, config: PaymentAccessConfig) {
  if (grant.origin !== config.origin || !Object.hasOwn(config.keys,grant.key_version)) unavailable();
  const frozen = context(grant);
  if (typeof grant.capability_context !== "string" || grant.capability_context.length > 8192 || !/^[a-f0-9]{64}$/.test(grant.context_hash)) unavailable();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(grant.capability_context)));
  if (Array.from(digest,byte=>byte.toString(16).padStart(2,"0")).join("") !== grant.context_hash) unavailable();
  let captured: {domain?:unknown;context_version?:unknown;origin?:unknown;key_version?:unknown;grant?:unknown};
  try {captured=JSON.parse(grant.capability_context);} catch {unavailable();}
  if (!captured || captured.domain !== "lrv-payment-collection/v2" || captured.context_version !== 2 ||
      captured.origin !== grant.origin || captured.key_version !== grant.key_version || !captured.grant || typeof captured.grant !== "object") unavailable();
  const recorded = context({...captured.grant,origin:captured.origin,key_version:captured.key_version} as PaymentAccessGrant);
  if (JSON.stringify(recorded)!==JSON.stringify(frozen)) unavailable();
  const key = await crypto.subtle.importKey("raw", keyBytes(config.keys[grant.key_version]), {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sign = async (role: "collection" | "status") => {
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(JSON.stringify([`living-room-vet.payment-${role}.v1`,grant.capability_context]))));
    return (role === "collection" ? "p1." : "s1.") + btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  };
  const collectionToken = await sign("collection"), statusToken = await sign("status");
  return {
    collection_token: collectionToken, status_token: statusToken,
    collection_token_hash: await paymentCapabilityHash(collectionToken,"collection"), status_token_hash: await paymentCapabilityHash(statusToken,"status"),
    collection_url: `${grant.origin}/pay/${grant.id}#${collectionToken}`,
    status_url: `${grant.origin}/payment/return/${grant.id}#${statusToken}`,
    cancel_url: `${grant.origin}/payment/cancel/${grant.id}#${statusToken}`,
  };
}

export interface PaymentScopedCheckoutIntent extends CheckoutIntent {
  actor_id?: string;
  invoice_id?: string;
  client_id?: string;
}
export async function materializePaymentCheckout(intent: PaymentScopedCheckoutIntent, grant: PaymentAccessGrant, config: PaymentAccessConfig): Promise<PaymentScopedCheckoutIntent> {
  if (intent.return_context_version!==2 || intent.return_scope_id!==grant.id || intent.return_key_version!==grant.key_version || intent.return_origin!==grant.origin ||
      intent.actor_id!==grant.actor_id || intent.invoice_id!==grant.invoice_id || intent.client_id!==grant.client_id || intent.amount_cents!==grant.amount_cents ||
      intent.currency!==grant.currency || intent.source_hash!==grant.source_hash ||
      intent.success_url!==`${grant.origin}/payment/return/${grant.id}#{{payment_status}}` || intent.cancel_url!==`${grant.origin}/payment/cancel/${grant.id}#{{payment_status}}`) unavailable();
  const access=await materializePaymentAccess(grant,config);
  return {...intent,success_url:access.status_url,cancel_url:access.cancel_url};
}
export function paymentGrantFromContext(value: unknown): PaymentAccessGrant {
  if (!value || typeof value!=="object" || Array.isArray(value)) unavailable();
  const envelope=value as {grant?:unknown;capture?:unknown};
  if (!envelope.grant || typeof envelope.grant!=="object" || Array.isArray(envelope.grant) || !envelope.capture || typeof envelope.capture!=="object" || Array.isArray(envelope.capture)) unavailable();
  const captured=envelope.capture as {origin?:unknown;key_version?:unknown;capability_context?:unknown;context_hash?:unknown;grant_id?:unknown;context_version?:unknown};
  const grant=envelope.grant as PaymentAccessGrant;
  if (captured.grant_id!==grant.id || captured.context_version!==2 || typeof captured.origin!=="string" || typeof captured.key_version!=="string" || typeof captured.capability_context!=="string" || typeof captured.context_hash!=="string") unavailable();
  return {...grant,origin:captured.origin,key_version:captured.key_version,capability_context:captured.capability_context,context_hash:captured.context_hash};
}
