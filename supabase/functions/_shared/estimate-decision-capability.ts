/** Dedicated estimate capabilities. Returned secrets are transient and must never be logged or persisted. */
export interface EstimateDecisionBinding {
  target: { estimate_id: string; client_id: string; pet_id: string };
  publication_id: string;
  content_hash: string;
  artifact_hash: string;
}
export interface EstimateDecisionCapabilityGrant {
  id: string;
  actor_id: string;
  binding: EstimateDecisionBinding;
  expires_at: string;
  origin: string;
  key_version: string;
  capability_context: string;
  context_hash: string;
}
export interface EstimateDecisionConfig {
  origin: string;
  activeKeyVersion: string;
  keys: Record<string, string>;
  publicEnabled: boolean;
  issuanceEnabled: boolean;
}
export interface EstimateDecisionConfigValues {
  origin?: string;
  activeKeyVersion?: string;
  keys?: string;
  publicEnabled?: string;
  issuanceEnabled?: string;
}
export interface EstimateDecisionCapabilityContext {
  domain: 'lrv-estimate-decision/v1';
  context_version: 1;
  grant_id: string;
  actor_id: string;
  binding: EstimateDecisionBinding;
  expires_at: string;
  origin: string;
  key_version: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const version = /^[A-Za-z0-9_-]{1,40}$/;
function unavailable(): never { throw new Error('Estimate access unavailable'); }
function closed(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(object,k))) unavailable();
  return object;
}
function matches(value: unknown, pattern: RegExp): value is string { return typeof value === 'string' && pattern.test(value); }
function origin(value: unknown): string {
  if (typeof value !== 'string') unavailable();
  let url: URL;
  try { url = new URL(value); } catch { unavailable(); }
  if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) unavailable();
  return value;
}
function keyBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) unavailable();
  let raw: string;
  try { raw = atob(value); } catch { unavailable(); }
  if (raw.length < 32 || raw.length > 64 || btoa(raw) !== value) unavailable();
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function estimateDecisionConfig(values: EstimateDecisionConfigValues): EstimateDecisionConfig {
  const trustedOrigin = origin(values.origin);
  if (!matches(values.activeKeyVersion,version)) unavailable();
  let keys: unknown;
  try { keys = JSON.parse(values.keys ?? '{}'); } catch { unavailable(); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.prototype.hasOwnProperty.call(keys,values.activeKeyVersion)) unavailable();
  if (Object.keys(keys).length > 16) unavailable();
  for (const [v,k] of Object.entries(keys)) { if (!version.test(v)) unavailable(); keyBytes(k); }
  for (const flag of [values.publicEnabled,values.issuanceEnabled]) if (flag !== undefined && flag !== 'true' && flag !== 'false') unavailable();
  return { origin:trustedOrigin,activeKeyVersion:values.activeKeyVersion,keys:{...keys} as Record<string,string>,publicEnabled:values.publicEnabled==='true',issuanceEnabled:values.issuanceEnabled==='true' };
}
function binding(value: unknown): EstimateDecisionBinding {
  const b=closed(value,['target','publication_id','content_hash','artifact_hash']);
  const t=closed(b.target,['estimate_id','client_id','pet_id']);
  if (![t.estimate_id,t.client_id,t.pet_id,b.publication_id].every(v=>matches(v,uuid)) || !matches(b.content_hash,hash) || !matches(b.artifact_hash,hash)) unavailable();
  return value as EstimateDecisionBinding;
}
function instant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return false;
  const time=Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19)===value.slice(0,19);
}
function sameBinding(a: EstimateDecisionBinding,b: EstimateDecisionBinding): boolean {
  return a.publication_id===b.publication_id && a.content_hash===b.content_hash && a.artifact_hash===b.artifact_hash && a.target.estimate_id===b.target.estimate_id && a.target.client_id===b.target.client_id && a.target.pet_id===b.target.pet_id;
}
async function digest(value:string):Promise<string> {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function constantTime(a:string,b:string):boolean {
  let difference=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++) difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return difference===0;
}
export function validEstimateDecisionCapability(value:unknown):value is string {
  if (!matches(value,/^e1\.[A-Za-z0-9_-]{43}$/)) return false;
  // A SHA-256 digest has two zero padding bits; reject alternate encodings.
  return 'AEIMQUYcgkosw048'.includes(value.at(-1)!);
}
export async function estimateDecisionCapabilityHash(token:string):Promise<string> {
  if(!validEstimateDecisionCapability(token)) unavailable();
  return digest(token);
}
export async function validateEstimateDecisionContext(grant:EstimateDecisionCapabilityGrant,config:EstimateDecisionConfig):Promise<EstimateDecisionCapabilityContext> {
  closed(grant,['id','actor_id','binding','expires_at','origin','key_version','capability_context','context_hash']);
  if(!matches(grant.id,uuid)||!matches(grant.actor_id,uuid)||!instant(grant.expires_at)||!matches(grant.key_version,version)||!matches(grant.context_hash,hash)) unavailable();
  binding(grant.binding);
  if(origin(grant.origin)!==origin(config.origin)||!Object.prototype.hasOwnProperty.call(config.keys,grant.key_version)) unavailable();
  keyBytes(config.keys[grant.key_version]);
  const text=grant.capability_context;
  if(typeof text!=='string'||new TextEncoder().encode(text).length>8192||/[\uD800-\uDFFF]/u.test(text)) unavailable();
  if(!constantTime(await digest(text),grant.context_hash)) unavailable();
  let parsed:unknown;
  try { parsed=JSON.parse(text); } catch { unavailable(); }
  const c=closed(parsed,['domain','context_version','grant_id','actor_id','binding','expires_at','origin','key_version']);
  const b=binding(c.binding);
  if(c.domain!=='lrv-estimate-decision/v1'||c.context_version!==1||c.grant_id!==grant.id||c.actor_id!==grant.actor_id||c.expires_at!==grant.expires_at||c.origin!==grant.origin||c.key_version!==grant.key_version||!sameBinding(b,grant.binding)) unavailable();
  return parsed as EstimateDecisionCapabilityContext;
}
export async function materializeEstimateDecision(grant:EstimateDecisionCapabilityGrant,config:EstimateDecisionConfig) {
  await validateEstimateDecisionContext(grant,config);
  const key=await crypto.subtle.importKey('raw',keyBytes(config.keys[grant.key_version]),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['living-room-vet.estimate-decision.v1',grant.capability_context]))));
  const token='e1.'+btoa(String.fromCharCode(...signature)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return {token,token_hash:await estimateDecisionCapabilityHash(token),url:`${grant.origin}/estimate/${grant.id}#${token}`};
}
/** Cryptographic proof only: HTTP gates and SQL current grant eligibility remain mandatory. */
export async function verifyEstimateDecisionCapability(token:unknown,grant:EstimateDecisionCapabilityGrant,config:EstimateDecisionConfig):Promise<string> {
  if(!validEstimateDecisionCapability(token)) unavailable();
  const expected=await materializeEstimateDecision(grant,config);
  if(!constantTime(token,expected.token)) unavailable();
  return expected.token_hash;
}
