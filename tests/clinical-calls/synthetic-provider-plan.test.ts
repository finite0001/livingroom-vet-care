import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFrozenCallBundle } from "./evaluation-offline.ts";
import { CALL_PROVIDER_BUNDLE_SHA256, TRANSPORT_FILES, planCallProviderBundle } from "./synthetic-provider-plan.ts";

const bundle = await buildFrozenCallBundle();
const bytes = Buffer.from(JSON.stringify(bundle));
test("transport plan admits only exact frozen ten requests with separate code fingerprints and zero network", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Network forbidden."); };
  try {
    const plan = await planCallProviderBundle(bytes);
    assert.equal(plan.bundle_sha256, CALL_PROVIDER_BUNDLE_SHA256);
    assert.equal(plan.cases.length, 10);
    assert.deepEqual(Object.keys(plan.transport_source_sha256).sort(), [...TRANSPORT_FILES].sort());
    for (const [n, item] of plan.cases.entries()) {
      assert.equal(Buffer.from(item.request_body_base64, "base64").toString(), bundle.cases[n].request_json);
      assert.equal(item.request_service_tier, "unpinned");
      assert.equal(item.maximum_output_tokens, 8000);
    }
    const bad = structuredClone(bundle); Object.assign(bad.cases[0].context, { model: "other-model" });
    await assert.rejects(planCallProviderBundle(Buffer.from(JSON.stringify(bad))));
    await assert.rejects(planCallProviderBundle(Buffer.from([0xff])));
  } finally { globalThis.fetch = original; }
});

test("actual generated Deno callbacks enforce fixed auth/body/gates, atomic one-shot and raw-byte/redaction outcomes offline", () => {
  const directory = mkdtempSync(join(tmpdir(), "lrv-fixed-call-probe-"));
  const template = readFileSync(new URL("./synthetic-provider-probe.ts.in", import.meta.url), "utf8");
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  const item = bundle.cases[0];
  const fixed = { id: "A", ticket: "a".repeat(20), bundle_sha256: bundle.bundle_sha256,
    request_sha256: item.request_sha256, request_body_base64: Buffer.from(item.request_json).toString("base64"),
    context_base64: Buffer.from(JSON.stringify(item.context)).toString("base64"), context_sha256: sha(JSON.stringify(item.context)),
    transport_source_sha256: {}, expires_at_ms: 2000000000000, provider_timeout_ms: 60000, guard_timeout_ms: 10000,
    guard_bucket: "call-eval-" + "a".repeat(20), guard_object: "A.lock", admission_sha256: "d".repeat(64),
    operator_token_sha256: sha("operator-offline") };
  let emitted = template.replace("__FIXED__", "globalThis.__FIXED__").replace('from "zod"', "from " + JSON.stringify(import.meta.resolve("zod")));
  for (const name of ["clinical-call-note-provider.ts", "clinical-call-model.ts"]) {
    emitted = emitted.replace("../_shared/" + name, new URL("../../supabase/functions/_shared/" + name, import.meta.url).href);
  }
  const envelope = { id: "resp_fictional", model: "returned-alias", status: "completed", error: null, incomplete_details: null, usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(item.semantic_negative_control.payload) }] }] };
  const prelude = `
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const mode=process.argv[2]; const fixedData=${JSON.stringify(fixed)};
const secret='sk-offline-dummy-secret-do-not-use', serviceSecret='offline-storage-credential', operatorSecret='operator-offline';
// Signed-looking synthetic identity only: these local tests assume the real gateway verifies signatures.
const b64url=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
const jwt=(payload={role:'service_role',ref:'kothoqicubowyhwfsrte'},header={alg:'HS256',typ:'JWT'})=>b64url(header)+'.'+b64url(payload)+'.'+Buffer.alloc(32,1).toString('base64url');
const callerCredential=jwt();const envReads=[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const env={OPENAI_API_KEY:secret,SUPABASE_SERVICE_ROLE_KEY:serviceSecret,SUPABASE_URL:'https://kothoqicubowyhwfsrte.supabase.co',CLINICAL_NOTE_PROCESSING_ENABLED:'true',CLINICAL_AUDIO_PROCESSING_ENABLED:'private-unrelated-flag'};
if(mode==='unpriced')fixedData.admission_sha256=null;
if(mode==='gate')env.CLINICAL_CALL_NOTE_PROCESSING_ENABLED='true';
if(mode==='tamper')fixedData.request_body_base64=Buffer.from('{}').toString('base64');
let callback, providerCount=0, guardCount=0; const locks=new Set();
globalThis.__FIXED__=fixedData;
globalThis.Deno={env:{get:name=>{envReads.push(name);return env[name];}},serve:fn=>{callback=fn;}};
let expectedRaw=Buffer.from(JSON.stringify(${JSON.stringify(envelope)}));
globalThis.fetch=async(url,options)=>{
 assert.equal(options.redirect,'error');
 if(url==='https://kothoqicubowyhwfsrte.supabase.co/storage/v1/object/'+fixedData.guard_bucket+'/A.lock'){
  guardCount++;assert.equal(options.headers['x-upsert'],'false');
  if(mode==='guard_timeout'){locks.add('A');throw Error(secret+' guard acknowledgement lost');}
  if(locks.has('A'))return new Response('{}',{status:409});locks.add('A');return new Response('{}',{status:201});
 }
 assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.method,'POST');
 assert.equal(options.body,Buffer.from(fixedData.request_body_base64,'base64').toString());providerCount++;
 assert.equal(options.headers.Authorization,'Bearer '+secret);
 if(mode==='timeout')throw Error(secret+' provider timeout');
 if(mode==='echo')expectedRaw=Buffer.from(JSON.stringify({message:secret}));
 if(mode==='service_echo')expectedRaw=Buffer.from(JSON.stringify({message:serviceSecret}));
 if(mode==='caller_echo')expectedRaw=Buffer.from(JSON.stringify({message:callerCredential}));
 if(mode==='escaped_caller_echo')expectedRaw=Buffer.from(JSON.stringify({message:callerCredential}).replace(callerCredential,callerCredential.split('').map(c=>String.fromCharCode(92)+'u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')));
 if(mode==='escaped_echo')expectedRaw=Buffer.from(JSON.stringify({message:secret}).replace('offline','\\\\u006fffline'));
 if(mode==='usage_missing'||mode==='usage_invalid'){const decoded=JSON.parse(expectedRaw.toString());if(mode==='usage_missing')delete decoded.usage;else decoded.usage.total_tokens=-1;expectedRaw=Buffer.from(JSON.stringify(decoded));}
 if(mode==='invalid_utf8')expectedRaw=Buffer.from([255,254,0,96]);
 if(mode==='oversize')expectedRaw=Buffer.alloc(512001,120);
 if(mode==='refusal')expectedRaw=Buffer.from(JSON.stringify({id:'refusal',status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'No'}]}]}));
 if(mode==='partial'||mode==='partial_escaped_echo'){
  expectedRaw=Buffer.from(mode==='partial'?'partial-prefix':'{"error":"'+'\\\\u0073'+secret.slice(1));let read=0;
  return new Response(new ReadableStream({pull(c){if(read++===0)c.enqueue(expectedRaw);else c.error(Error('interrupted '+secret));}}),{headers:{'x-request-id':'req_offline'}});
 }
 return new Response(expectedRaw,{status:mode==='http_error'?429:mode==='server503'?503:mode==='server408'?408:200,headers:{'x-request-id':mode==='header_echo'?secret:mode==='long_id'?'req_'+('x'.repeat(400)):'req_offline'}});
};
`;
  const after = `
let flagSnapshot='';
const invoke=(action='run',body='{}',auth=callerCredential,operator=operatorSecret,query='')=>callback(new Request('https://fixed.synthetic.invalid'+query,{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Length':String(Buffer.byteLength(body)),'x-evaluation-operator':operator,'x-evaluation-action':action,'x-evaluation-flags-sha256':flagSnapshot},body}));
const badTokens=[
 'wrong',jwt({role:'anon',ref:'kothoqicubowyhwfsrte'}),jwt({role:'authenticated',ref:'kothoqicubowyhwfsrte'}),
 jwt({role:'service_role',ref:'mgadheotkdnrsatfivjy'}),jwt({role:'service_role'}),jwt({role:'service_role',ref:3}),
 jwt([]),jwt(null),jwt({role:'service_role',ref:'kothoqicubowyhwfsrte'},{alg:'none',typ:'JWT'}),
 jwt({role:'service_role',ref:'kothoqicubowyhwfsrte'},{alg:'HS256',typ:'JWT',extra:true}),
 b64url({alg:'HS256',typ:'JWT'})+'.'+Buffer.from([255]).toString('base64url')+'.'+Buffer.alloc(32).toString('base64url'),
 b64url({alg:'HS256',typ:'JWT'})+'.'+b64url('{')+'.'+Buffer.alloc(32).toString('base64url'),
 jwt({role:'service_role',ref:'kothoqicubowyhwfsrte',padding:'x'.repeat(5000)}),
 jwt({role:'service_role',ref:'kothoqicubowyhwfsrte'},{alg:'HS256',typ:'JWT',padding:'x'.repeat(600)}),
 callerCredential+'.extra',callerCredential.slice(0,-1),callerCredential+'=',
 callerCredential.replace('.', '=.'),'a'.repeat(8193),callerCredential.replace(/.$/,'B')
];
for(const credential of badTokens){assert.equal((await invoke('run','{}',credential)).status,403);assert.equal(envReads.length,0);}
assert.equal((await invoke('run','{}',callerCredential,'wrong')).status,403);assert.equal(envReads.length,0);
assert.equal(providerCount,0);assert.equal(guardCount,0);
const originalExpiry=fixedData.expires_at_ms;fixedData.expires_at_ms=Date.now()-1;
assert.equal((await invoke()).status,403);assert.equal(envReads.length,0);fixedData.expires_at_ms=originalExpiry;
assert.equal((await callback(new Request('https://fixed.synthetic.invalid',{method:'GET',headers:{Authorization:'Bearer '+callerCredential,'x-evaluation-operator':operatorSecret}}))).status,403);assert.equal(envReads.length,0);
env.SUPABASE_URL='https://mgadheotkdnrsatfivjy.supabase.co';assert.equal((await invoke()).status,403);assert.ok(!envReads.includes('OPENAI_API_KEY'));env.SUPABASE_URL='https://kothoqicubowyhwfsrte.supabase.co';envReads.length=0;
assert.equal((await invoke('run','{"model":"other"}')).status,422);
assert.equal((await invoke('run','{}',callerCredential,operatorSecret,'?model=other')).status,422);
assert.equal((await invoke('retry')).status,422);assert.equal(providerCount,0);assert.equal(guardCount,0);
const attested=await(await invoke('attest')).json();flagSnapshot=attested.flags_sha256;assert.equal(attested.request_body_base64,fixedData.request_body_base64);
assert.equal(attested.flags.find(f=>f.name==='CLINICAL_NOTE_PROCESSING_ENABLED').enabled,true);
assert.ok(!JSON.stringify(attested).includes('private-unrelated-flag'));assert.equal(providerCount,0);
if(mode==='changed_flag')env.CLINICAL_AUDIO_PROCESSING_ENABLED='externally-changed';
if(mode==='unpriced'||mode==='gate'||mode==='changed_flag'){
 const refused=await invoke();assert.equal(refused.status,mode==='unpriced'?403:409);assert.equal(providerCount,0);assert.equal(guardCount,0);
}else{
 const outcomes=await Promise.all(Array.from({length:4},async()=>await(await invoke()).json()));
 assert.equal(providerCount,mode==='guard_timeout'?0:1);
 assert.equal(outcomes.reduce((n,c)=>n+c.provider_call_count,0),providerCount);
 const first=outcomes.find(c=>c.provider_call_count===1)??outcomes[0];
 assert.ok(!JSON.stringify(outcomes).includes(secret));assert.ok(!JSON.stringify(outcomes).includes(serviceSecret));assert.ok(!JSON.stringify(outcomes).includes(operatorSecret));assert.ok(!JSON.stringify(outcomes).includes(callerCredential));
 if(['echo','service_echo','caller_echo','escaped_caller_echo','escaped_echo','header_echo','partial_escaped_echo'].includes(mode)){
  assert.equal(first.state,'secret_echo_redacted');assert.equal(first.response_complete,false);assert.equal(first.raw_body_base64,'');assert.equal(first.raw_body_sha256,null);assert.equal(first.parsed_result,null);
 }else if(mode==='guard_timeout'){assert.equal(first.state,'guard_unconfirmed');}
 else if(mode==='timeout'){assert.equal(first.state,'dispatch_uncertain');assert.equal(first.uncertain,true);}
 else {
  const raw=Buffer.from(first.raw_body_base64,'base64');assert.deepEqual(raw,mode==='oversize'?expectedRaw.subarray(0,512000):expectedRaw);assert.equal(first.raw_body_sha256,digest(raw));
  if(mode==='partial'||mode==='oversize'){assert.equal(first.response_complete,false);assert.equal(first.state,'response_partial');assert.equal(first.uncertain,true);}
  else {assert.equal(first.response_complete,true);assert.equal(first.state,'response_complete');assert.equal(first.parser_pass,['success','long_id','usage_missing','usage_invalid'].includes(mode));
   if(['server503','server408','usage_missing','usage_invalid'].includes(mode)){assert.equal(first.billing_uncertain,true);assert.equal(first.stop_remaining,true);assert.equal(first.uncertain,true);}
   if(mode==='success'){assert.equal(first.billing_uncertain,false);assert.equal(first.usage.total_tokens,140);}
   if(mode==='long_id'){assert.equal(first.provider_request_id.length,300);assert.equal(first.provider_request_id_truncated,true);assert.equal(first.provider_request_id_sha256,digest('req_'+('x'.repeat(400))));}}
 }
 const again=await(await invoke()).json();assert.equal(again.provider_call_count,0);assert.equal(providerCount,mode==='guard_timeout'?0:1);
}
fixedData.expires_at_ms=Date.now()-1;assert.equal((await invoke()).status,403);
console.log('fixed generated call probe offline passed '+mode);
`;
  try {
    const source = join(directory, "probe.ts"); writeFileSync(source, prelude + emitted + after);
    for (const mode of ["success", "guard_timeout", "timeout", "partial", "invalid_utf8", "oversize", "refusal", "http_error", "echo", "service_echo", "caller_echo", "escaped_caller_echo", "escaped_echo", "header_echo", "unpriced", "gate", "changed_flag", "partial_escaped_echo", "server503", "server408", "usage_missing", "usage_invalid", "long_id"]) {
      execFileSync(process.execPath, ["--experimental-strip-types", source, mode], { stdio: "pipe", timeout: 30000 });
    }
    assert.throws(() => execFileSync(process.execPath, ["--experimental-strip-types", source, "tamper"], { stdio: "pipe", timeout: 30000 }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
