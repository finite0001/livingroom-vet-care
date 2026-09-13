/** Actual local HTTP/Auth/SQL roundtrip with synthetic provider responses only. */
import {execFileSync, spawn} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
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
const origin="https://thelivingroom.vet",root="http://127.0.0.1:56491";
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
try{
 const profiles=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;"));
 check(!profiles.length || (profiles.length===1 && profiles[0].return_origin===origin && profiles[0].livemode===false),"Only compatible synthetic provider profile reused");
 if(profiles.length)account=profiles[0].account_id;else{account="acct_Local"+randomUUID().replaceAll("-","");await rpc("configure_payment_provider",{p_account_id:account,p_livemode:false,p_return_origin:origin});createdProfile=true;}
 const email=`reconciliation-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 actor=(await api("/auth/v1/admin/users",{email,password,email_confirm:true})).id;ids.push(actor);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 client=(await rpc("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Reconciliation",p_primary_phone:null,p_primary_email:null,p_preferred_channel:"EMAIL",p_mailing_address:null,p_housecall_address:null},true)).id;ids.push(client);
 product=(await rpc("save_catalog_product",{p_id:null,p_expected_version:null,p_name:"Synthetic visit",p_kind:"service",p_manufacturer:"",p_unit:"visit",p_unit_price_cents:10000,p_active:true},true)).id;ids.push(product);
 const invoice=randomUUID(),attempt=randomUUID(),caseId=randomUUID();ids.push(invoice,attempt,caseId);
 await rpc("create_billing_invoice",{p_id:invoice,p_client_id:client},true);
 await rpc("add_invoice_service",{p_id:randomUUID(),p_invoice_id:invoice,p_pet_id:null,p_product_id:product,p_quantity:1},true);
 await rpc("issue_billing_invoice",{p_id:invoice,p_expected_version:Number(sql(`select version from public.billing_invoices where id=${quote(invoice)};`))},true);
 const state=await rpc("read_invoice_payment_state",{p_invoice_id:invoice,p_client_id:client},true);
 await rpc("prepare_invoice_checkout",{p_request_id:attempt,p_invoice_id:invoice,p_client_id:client,p_source_hash:state.source_hash,p_amount_cents:10000,p_account_id:account,p_livemode:false,p_success_url:origin+"/payment/return",p_cancel_url:origin+"/payment/cancel"},true);
 const objectId="cs_test_Local"+attempt.replaceAll("-","");
 await rpc("apply_checkout_evidence",{p_event_id:"evt_Local"+randomUUID().replaceAll("-",""),p_request_id:attempt,p_account_id:account,p_livemode:false,p_kind:"session_open",p_session_id:objectId,p_payment_id:null,p_amount_cents:10000,p_currency:"usd",p_source_hash:state.source_hash});
 await rpc("record_payment_reconciliation",{p_family:"checkout",p_request_id:attempt,p_reason:"provider_object_unavailable"});
 server=spawn("deno",["run","--cached-only","--allow-env","--allow-net=127.0.0.1","tests/payment-reconciliation/local-server.ts"],{env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,PAYMENT_TEST_REQUEST_ID:attempt,APP_URL:origin,STRIPE_SECRET_KEY:""},stdio:"ignore"});
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error("Local Deno handler failed to boot");try{ready=await(await fetch(root+"/health")).text()==="ready";if(ready)break;}catch{/* Boot pending. */}await new Promise(resolve=>setTimeout(resolve,100));}
 check(ready,"Real localhost HTTP server boots with external network denied");
 const post=(args:unknown,authenticated=true)=>fetch(root+"/verify",{method:"POST",headers:{Origin:origin,...(authenticated?staffHeaders:{"Content-Type":"application/json"})},body:JSON.stringify(args)});
 const previewArgs={action:"preview",p_invoice_id:invoice,p_family:"checkout",p_request_id:attempt,p_provider_object_id:objectId};
 check((await post(previewArgs,false)).status===401,"Unauthenticated HTTP request denied");
 check((await post(previewArgs)).status===404,"Real authenticated non-admin SQL request denied");
 sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'ADMIN') on conflict do nothing;`);
 const previewResponse=await post(previewArgs);check(previewResponse.status===200,"Real administrator preview succeeds");
 const preview=await previewResponse.json();check(preview.blocker_refs.length===1 && preview.amount_cents==="10000","Preview binds exact local blocker and cents");
 const workspace=await rpc("list_payment_reconciliation_workspace",{p_invoice_id:invoice},true);
 check(workspace.targets[0].provider_object_id===objectId && workspace.targets[0].reviewable,"Discovery returns only attributed reviewable target");
 const args={...previewArgs,action:"prepare",p_case_id:caseId,p_blocker_refs:preview.blocker_refs,p_expected_case_hash:preview.snapshot_hash};
 const preparedResponse=await post(args);check(preparedResponse.status===200,"Synthetic retrieval captures strict proof through actual Auth/PostgREST");
 const prepared=await preparedResponse.json();check(prepared.capture.evidence.object_id===objectId && prepared.capture.evidence.status==="session_open","Durable proof preserves known object and normalized state");
 check(!/checkout.stripe|customer_details|private@example/.test(JSON.stringify(prepared)),"HTTP proof has no raw provider URL or customer payload");
 check((await post({...args,p_expected_case_hash:"f".repeat(64)})).status===409,"SQL rejects changed recovered case context");
 const replay=await(await post(args)).json();check(replay.capture.proof_hash===prepared.capture.proof_hash,"Exact replay recovers immutable captured proof");
 await rpc("complete_payment_reconciliation",{p_case_id:caseId,p_reviewed_proof_hash:prepared.capture.proof_hash,p_expected_case_hash:preview.snapshot_hash,p_attest:true},true);
 const recovered=await(await post({action:"recover",p_case_id:caseId})).json();check(recovered.resolution.proof_hash===prepared.capture.proof_hash,"Real actor completion and HTTP recovery preserve reviewed proof");
 check((await(await fetch(root+"/stats")).json()).retrieved===1,"Replay and recovery perform no further provider retrieval");
 check(sql(`select count(*) from public.invoice_payments where invoice_id=${quote(invoice)};`)==="0","Open proof resolution never posts cash");
 check((await rpc("read_invoice_payment_state",{p_invoice_id:invoice,p_client_id:client},true)).source_hash===state.source_hash,"Resolution preserves invoice source");
}catch(error){failures.push(error);}finally{
 if(server){server.kill("SIGTERM");await new Promise<void>(resolve=>{if(server!.exitCode!==null || server!.signalCode!==null)resolve();else server!.once("exit",()=>resolve());});}
 try{
  if(ids.length || createdProfile){const patterns=ids.length?ids.map(id=>quote(`%${id}%`)).join(","):quote("%"+randomUUID()+"%");sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;${createdProfile?`delete from public.payment_provider_profiles where account_id=${quote(account)};`:""}commit;`);}
  if(actor){const removed=await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders});check(removed.ok,"Synthetic Auth user cleanup succeeded");check(sql(`select count(*) from public.payment_collection_grants where actor_id=${quote(actor)};`)==="0","Synthetic grant cleanup verified");}
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local reconciliation roundtrip or cleanup failed");
console.log(`Local reconciliation HTTP/Auth/SQL roundtrip: ${assertions} checks passed. Provider responses were synthetic; no Stripe requests.`);
