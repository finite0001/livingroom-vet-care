/** Actual local HTTP/Auth/SQL roundtrip with synthetic provider responses only. */
import {execFileSync, spawn} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {materializePaymentAccess,paymentAccessConfig,paymentGrantFromContext} from "../../supabase/functions/_shared/payment-access-capability.ts";
let project = process.env.PAYMENT_TEST_PROJECT || "/tmp/livingroom-vet-foundation";
let temporaryProject = "";
// The existing containers may outlive their /tmp configuration. This config is
// used for status only; this runner never starts, resets, or stops Supabase.
if (!process.env.PAYMENT_TEST_PROJECT && !existsSync(`${project}/supabase/config.toml`)) {
  temporaryProject = mkdtempSync(join(tmpdir(), "lrv-payment-local-"));
  project = temporaryProject;
  mkdirSync(join(project, "supabase"));
  writeFileSync(join(project, "supabase/config.toml"), 'project_id = "livingroom-vet-foundation"\n[api]\nport = 56321\n[db]\nport = 56322\nshadow_port = 56320\n');
  process.once("exit", () => rmSync(temporaryProject, {recursive: true, force: true}));
}
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId, "Explicit local project required");
const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", project, "--output", "json"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}));
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]}).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const origin="https://thelivingroom.vet",root="http://127.0.0.1:56471";
const key=btoa(randomUUID().replaceAll("-",""));
const config=paymentAccessConfig({origin,activeKeyVersion:"local-v1",keys:JSON.stringify({"local-v1":key}),collectionEnabled:"true",statusEnabled:"true"});
const ids:string[]=[];let actor="",client="",product="",account="",createdProfile=false;
let server:ReturnType<typeof spawn>|null=null,assertions=0;
const failures:unknown[]=[];
const check=(value:unknown,message:string)=>{assert.ok(value,message);assertions++;};
const serviceHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${local.SERVICE_ROLE_KEY}`,"Content-Type":"application/json"};
let staffHeaders:Record<string,string>={};
async function api(path:string,args:unknown,headers=serviceHeaders){
 const response=await fetch(local.API_URL+path,{method:"POST",headers,body:JSON.stringify(args)});
 if(!response.ok)throw new Error(`Local fixture ${path} failed: HTTP ${response.status}`);
 const text=await response.text();return text?JSON.parse(text):null;
}
const rpc=(name:string,args:Record<string,unknown>,staff=false)=>api("/rest/v1/rpc/"+name,args,staff?staffHeaders:serviceHeaders);
const post=(path:string,grantId:string,token:string,action?:string)=>fetch(root+path,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({grant_id:grantId,token,...(action?{action}:{})})});
async function fixture(badHash=false){
 const invoice=randomUUID(),grantId=randomUUID();ids.push(invoice,grantId);
 await rpc("create_billing_invoice",{p_id:invoice,p_client_id:client},true);
 await rpc("add_invoice_service",{p_id:randomUUID(),p_invoice_id:invoice,p_pet_id:null,p_product_id:product,p_quantity:1},true);
 const version=Number(sql(`select version from public.billing_invoices where id=${quote(invoice)};`));
 await rpc("issue_billing_invoice",{p_id:invoice,p_expected_version:version},true);
 const state=await rpc("read_invoice_payment_state",{p_invoice_id:invoice,p_client_id:client},true);
 const args={p_request_id:grantId,p_invoice_id:invoice,p_client_id:client,p_source_hash:state.source_hash,p_amount_cents:10000,p_expires_at:new Date(Date.now()+6*86400000).toISOString()};
 await rpc("prepare_payment_collection",args,true);
 const preparing=await rpc("payment_collection_capture_context",{p_request_id:grantId,p_actor_id:actor,p_origin:origin,p_key_version:"local-v1"});
 const access=await materializePaymentAccess(paymentGrantFromContext(preparing),config);
 const captured=await rpc("capture_payment_collection",{p_request_id:grantId,p_actor_id:actor,p_origin:origin,p_key_version:"local-v1",p_collection_token_hash:badHash?"f".repeat(64):access.collection_token_hash,p_status_token_hash:access.status_token_hash});
 const recovered=await rpc("recover_payment_collection",{p_invoice_id:invoice,p_request_id:grantId},true);
 const again=await materializePaymentAccess(paymentGrantFromContext(recovered),config);
 check(again.collection_token===access.collection_token && again.status_token===access.status_token,"Canonical SQL capture context recovers exact role capabilities");
 check((await post("/real/collection",grantId,access.collection_token,"inspect")).status===404,"Unreviewed capture unavailable through actual runtime");
 await rpc("attest_payment_collection",{p_request_id:grantId,p_reviewed_context_hash:captured.capture.context_hash,p_attest:true},true);
 return {invoice,grantId,access};
}
try{
 const profiles=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;"));
 check(!profiles.length || (profiles.length===1 && profiles[0].return_origin===origin && profiles[0].livemode===false),"Only compatible local test provider profile reused");
 if(profiles.length)account=profiles[0].account_id;else{account="acct_Local"+randomUUID().replaceAll("-","");await rpc("configure_payment_provider",{p_account_id:account,p_livemode:false,p_return_origin:origin});createdProfile=true;}
 const email=`payment-roundtrip-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 const user=await api("/auth/v1/admin/users",{email,password,email_confirm:true});actor=user.id;ids.push(actor);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 const c=await rpc("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Payment roundtrip",p_primary_phone:null,p_primary_email:null,p_preferred_channel:"EMAIL",p_mailing_address:null,p_housecall_address:null},true);client=c.id;ids.push(client);
 const p=await rpc("save_catalog_product",{p_id:null,p_expected_version:null,p_name:"Synthetic visit",p_kind:"service",p_manufacturer:"",p_unit:"visit",p_unit_price_cents:10000,p_active:true},true);product=p.id;ids.push(product);
 server=spawn("deno",["run","--cached-only","--allow-env","--allow-net=127.0.0.1","tests/payment-access/local-server.ts"],{env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,PAYMENT_TEST_STAFF_TOKEN:auth.access_token,APP_URL:origin,PAYMENT_ACCESS_STAFF_ENABLED:"true",PAYMENT_ACCESS_ORIGIN:origin,PAYMENT_ACCESS_ACTIVE_KEY_VERSION:"local-v1",PAYMENT_ACCESS_KEYS:JSON.stringify({"local-v1":key}),PAYMENT_COLLECTION_ENABLED:"true",PAYMENT_STATUS_ENABLED:"true",STRIPE_PAYMENTS_ENABLED:"false",STRIPE_COLLECTIONS_ENABLED:"false",STRIPE_SECRET_KEY:""},stdio:"ignore"});
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error("Local Deno handler failed to boot");try{ready=await(await fetch(root+"/health")).text()==="ready";if(ready)break;}catch{/* Boot pending. */}await new Promise(resolve=>setTimeout(resolve,100));}
 check(ready,"Actual localhost Deno HTTP server booted with external network denied");
 const staffPost=(path:string,args:unknown,authenticated=true)=>fetch(root+path,{method:"POST",headers:{Origin:origin,...(authenticated?staffHeaders:{"Content-Type":"application/json"})},body:JSON.stringify(args)});
 const staffInvoice=randomUUID(),staffGrant=randomUUID();ids.push(staffInvoice,staffGrant);
 await rpc("create_billing_invoice",{p_id:staffInvoice,p_client_id:client},true);
 await rpc("add_invoice_service",{p_id:randomUUID(),p_invoice_id:staffInvoice,p_pet_id:null,p_product_id:product,p_quantity:1},true);
 await rpc("issue_billing_invoice",{p_id:staffInvoice,p_expected_version:Number(sql(`select version from public.billing_invoices where id=${quote(staffInvoice)};`))},true);
 const staffState=await rpc("read_invoice_payment_state",{p_invoice_id:staffInvoice,p_client_id:client},true);
 const staffArgs={p_request_id:staffGrant,p_invoice_id:staffInvoice,p_client_id:client,p_source_hash:staffState.source_hash,p_amount_cents:10000,p_expires_at:new Date(Date.now()+6*86400000).toISOString()};
 check((await staffPost("/staff/prepare",staffArgs,false)).status===401,"Staff preparation denies missing authentication through HTTP");
 const preparedResponse=await staffPost("/staff/prepare",staffArgs);
 check(preparedResponse.status===200,"Production staff runtime prepares and captures through actual Auth/PostgREST");
 const prepared=await preparedResponse.json();
 check(prepared.grant.id===staffGrant && prepared.grant.state==="captured" && !!prepared.capture,"Staff preparation returns exact captured metadata");
 check(!/(?:p1|s1)\.[A-Za-z0-9_-]{43}/.test(JSON.stringify(prepared)) && !JSON.stringify(prepared).includes("token_hash"),"Staff response exposes no usable capabilities or service hashes");
 check((await staffPost("/staff/prepare",{...staffArgs,p_amount_cents:9999})).status===409,"Changed captured amount is rejected by real SQL");
 const microsecondExpiry=staffArgs.p_expires_at.replace(/Z$/, "001Z");
 check(Date.parse(microsecondExpiry)===Date.parse(staffArgs.p_expires_at),"Microsecond regression has equal JavaScript timestamps");
 check((await staffPost("/staff/prepare",{...staffArgs,p_expires_at:microsecondExpiry})).status===409,"Sub-millisecond changed expiry cannot override SQL rejection");
 const recoveredStaff=await(await staffPost("/staff/recover",{p_invoice_id:staffInvoice,p_request_id:staffGrant})).json();
 check(recoveredStaff.capture.context_hash===prepared.capture.context_hash && recoveredStaff.grant.expires_at===prepared.grant.expires_at,"Staff recovery preserves original capture and expiry");
 check((await staffPost("/staff/prepare",staffArgs)).status===200,"Exact staff preparation replay succeeds after conflicts");
 const staffAccess=await materializePaymentAccess(paymentGrantFromContext(prepared),config);
 check((await post("/real/collection",staffGrant,staffAccess.collection_token,"inspect")).status===404,"Staff capture alone does not authorize public collection");
 await rpc("attest_payment_collection",{p_request_id:staffGrant,p_reviewed_context_hash:prepared.capture.context_hash,p_attest:true},true);
 check((await post("/real/collection",staffGrant,staffAccess.collection_token,"inspect")).status===200,"Explicit staff attestation enables captured public inspection");
 const paid=await fixture(),lost=await fixture(),revoked=await fixture(),bad=await fixture(true);
 const inspected=await post("/real/collection",paid.grantId,paid.access.collection_token,"inspect");
 check(inspected.status===200,"Production runtime inspection reaches real PostgREST");
 const minimal=await inspected.json();check(minimal.amount_cents==="10000" && minimal.collection_available===false,"Inspection shows frozen amount without provider enablement");
 check(sql(`select count(*) from public.payment_collection_attempts where grant_id=${quote(paid.grantId)};`)==="0","Inspection creates no attempt");
 check((await post("/real/status",paid.grantId,paid.access.status_token)).status===200,"Production runtime accepts reviewed separate status capability");
 check((await post("/real/status",paid.grantId,paid.access.collection_token)).status===404,"Collection token cannot become status token");
 check((await post("/real/collection",paid.grantId,paid.access.status_token,"inspect")).status===404,"Status token cannot authorize collection");
 check((await post("/real/collection",paid.grantId,lost.access.collection_token,"inspect")).status===404,"Valid token from another captured grant denied");
 check((await post("/real/collection",bad.grantId,bad.access.collection_token,"inspect")).status===404,"Derived HMAC cannot override mismatched durable hash");
 const collected=await post("/paid/collection",paid.grantId,paid.access.collection_token,"activate");
 check(collected.status===200 && (await collected.json()).state==="paid","Synthetic provider normalization posts actual payment ledger through HTTP");
 const payment=JSON.parse(sql(`select to_jsonb(p) from public.invoice_payments p where invoice_id=${quote(paid.invoice)};`));ids.push(payment.id);
 check(payment.amount_cents===10000,"Exactly one real local ledger collection has reviewed cents");
 await rpc("credit_billing_invoice",{p_id:randomUUID(),p_invoice_id:paid.invoice,p_amount_cents:1000,p_reason:"LOCAL SYNTHETIC refund adjustment"},true);
 const refund=randomUUID();ids.push(refund);
 await rpc("prepare_invoice_refund",{p_request_id:refund,p_invoice_id:paid.invoice,p_payment_id:payment.id,p_amount_cents:1000,p_reason:"LOCAL SYNTHETIC partial refund"},true);
 await rpc("apply_refund_evidence",{p_event_id:"evt_Local"+randomUUID().replaceAll("-",""),p_request_id:refund,p_account_id:account,p_livemode:false,p_refund_id:"re_Local"+randomUUID().replaceAll("-",""),p_provider_payment_id:payment.payment_id,p_amount_cents:1000,p_currency:"usd",p_status:"succeeded"});
 const refunded=await(await post("/real/status",paid.grantId,paid.access.status_token)).json();
 check(refunded.state==="partially_refunded" && refunded.confirmed_refunded_cents==="1000","Production status runtime reads actual partial refund ledger");
 const first=await post("/lost/collection",lost.grantId,lost.access.collection_token,"activate");check(first.status===202,"Lost acknowledgement after actual DB commit returns pending");
 const original=sql(`select request_id from public.payment_collection_attempts where grant_id=${quote(lost.grantId)};`);ids.push(original);
 const recovered=await post("/lost/collection",lost.grantId,lost.access.collection_token,"activate");check(recovered.status===200 && (await recovered.json()).state==="checkout_ready","Retry retrieves existing synthetic session after lost acknowledgement");
 check(sql(`select count(*) from public.payment_collection_attempts where grant_id=${quote(lost.grantId)};`)==="1" && sql(`select request_id from public.payment_collection_attempts where grant_id=${quote(lost.grantId)};`)===original,"Recovery never rotates immutable attempt UUID");
 const raced=await post("/revoked/collection",revoked.grantId,revoked.access.collection_token,"activate");const raceBody=await raced.json();
 check(raced.status===200 && raceBody.collection_available===false && !("checkout_url" in raceBody),"Actual revocation during synthetic provider call suppresses URL after evidence commit");
 check(sql(`select count(*) from public.invoice_payment_evidence e join public.payment_collection_attempts a on a.request_id=e.request_id where a.grant_id=${quote(revoked.grantId)};`)==="1","Revocation does not erase unresolved provider evidence");
 check((await post("/real/status",revoked.grantId,revoked.access.status_token)).status===200,"Reviewed narrow status remains accessible after revocation");
 const persisted=sql(`select coalesce(jsonb_agg(to_jsonb(g)),'[]') from public.payment_collection_grants g where actor_id=${quote(actor)};select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.payment_collection_captures c join public.payment_collection_grants g on g.id=c.grant_id where g.actor_id=${quote(actor)};select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.invoice_checkout_attempts a where actor_id=${quote(actor)};`);
 check([paid,lost,revoked,bad].every(f=>!persisted.includes(f.access.collection_token)&&!persisted.includes(f.access.status_token)),"Usable collection and status tokens absent from durable grant/capture/attempt rows");
}catch(error){failures.push(error);}finally{
 if(server){server.kill("SIGTERM");await new Promise<void>(resolve=>{if(server!.exitCode!==null || server!.signalCode!==null)resolve();else server!.once("exit",()=>resolve());});}
 try{
  if(ids.length || createdProfile){const patterns=ids.length?ids.map(id=>quote(`%${id}%`)).join(","):quote("%"+randomUUID()+"%");sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;${createdProfile?`delete from public.payment_provider_profiles where account_id=${quote(account)};`:""}commit;`);}
  if(actor){const removed=await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders});check(removed.ok,"Synthetic Auth user cleanup succeeded");check(sql(`select count(*) from public.payment_collection_grants where actor_id=${quote(actor)};`)==="0","Synthetic grant cleanup verified");}
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local payment roundtrip or cleanup failed");
console.log(`Local payment HTTP/Auth/SQL roundtrip: ${assertions} checks passed. Provider responses were synthetic; no Stripe requests.`);
