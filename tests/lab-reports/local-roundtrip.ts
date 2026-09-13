/** Actual local HTTP/Auth/SQL/private Storage roundtrip with a synthetic report file. */
import {execFileSync,spawn} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
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

const ids:string[]=[];let actor="",client="";
let assertions=0;
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
const root="http://127.0.0.1:56511",origin="https://thelivingroom.vet";
let server:ReturnType<typeof spawn>|null=null,path="";
try{
 const email=`lab-byte-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 actor=(await api("/auth/v1/admin/users",{email,password,email_confirm:true})).id;ids.push(actor);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'ADMIN') on conflict do nothing;`);
 const staff=(name:string,args:Record<string,unknown>)=>rpc(name,args,true);
 client=(await staff("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Lab bytes",p_primary_phone:null,p_primary_email:null,p_preferred_channel:"EMAIL",p_mailing_address:null,p_housecall_address:null})).id;ids.push(client);
 const pet=(await staff("save_patient",{p_id:null,p_client_id:client,p_expected_version:null,p_name:"Synthetic lab patient",p_species:"Dog",p_breed:null,p_dob:null,p_birth_date_precision:"unknown",p_color:null,p_sex:"unknown",p_neuter_status:"unknown",p_microchip_id:null,p_archived_at:null,p_deceased_at:null})).id;ids.push(pet);
 const document=randomUUID(),source=randomUUID(),receipt=randomUUID();ids.push(document,source,receipt);
 const bytes=new TextEncoder().encode("%PDF-1.7\nSynthetic private lab report only\n%%EOF");
 const doc=await staff("prepare_patient_document",{p_id:document,p_pet_id:pet,p_encounter_id:null,p_file_name:"synthetic-lab.pdf",p_mime_type:"application/pdf",p_file_size:bytes.length,p_category:"lab_result",p_source:"Synthetic fixture",p_document_date:null,p_visibility:"internal"});path=doc.file_path;
 const upload=await fetch(local.API_URL+"/storage/v1/object/patient-documents/"+path,{method:"POST",headers:{apikey:local.ANON_KEY,Authorization:staffHeaders.Authorization,"Content-Type":"application/pdf","x-upsert":"false"},body:bytes});check(upload.ok,"Actual private Storage upload succeeded");
 const ready=await staff("finalize_patient_document",{p_id:document});
 await staff("review_lab_source_account",{p_id:source,p_provider_label:"Synthetic manual lab",p_account_reference:"Synthetic account",p_environment_label:"local synthetic",p_review_note:"No laboratory API connection"});
 server=spawn("deno",["run","--cached-only","--allow-env","--allow-net=127.0.0.1","tests/lab-reports/local-server.ts"],{env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,APP_URL:origin,LAB_REPORT_VERIFICATION_ENABLED:"true"},stdio:"ignore"});
 let booted=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error("Local lab server failed to boot");try{booted=await(await fetch(root+"/health")).text()==="ready";if(booted)break;}catch{/* Boot pending. */}await new Promise(resolve=>setTimeout(resolve,100));}check(booted,"Production runtime boots with external networking denied");
 const post=(args:unknown,authorized=true)=>fetch(root+"/verify",{method:"POST",headers:{Origin:origin,...(authorized?staffHeaders:{"Content-Type":"application/json"})},body:JSON.stringify(args)});
 const args={action:"prepare",p_id:receipt,p_source_account_id:source,p_document_id:document,p_document_version:ready.version,p_source_patient_reference:"Synthetic patient",p_source_order_reference:"Synthetic order",p_source_report_reference:"Synthetic report",p_received_at:new Date(Date.now()-1000).toISOString()};
 check((await post(args,false)).status===401,"Anonymous byte verification denied");
 const response=await post(args);check(response.status===200,"Actual Auth/Storage/SQL verification succeeds");const verified=await response.json();
 check(verified.capture.content_sha256===createHash("sha256").update(bytes).digest("hex"),"Stored proof hashes exact uploaded bytes");
 check(!JSON.stringify(verified).includes(path)&&!JSON.stringify(verified).includes("%PDF"),"Staff response omits private path and bytes");
 check((await post({...args,p_source_report_reference:"Changed source"})).status===409,"Exact SQL receipt conflict cannot recover as success");
 const again=await(await post(args)).json();check(again.capture.capture_hash===verified.capture.capture_hash,"Exact retry returns original immutable byte proof");
 check(sql(`select count(*) from public.lab_report_byte_captures where receipt_id=${quote(receipt)};`)==="1","One durable capture exists");
 await staff("void_patient_document",{p_id:document,p_expected_version:ready.version,p_reason:"Synthetic test void"});
 const recovered=await(await post({action:"recover",p_receipt_id:receipt})).json();check(recovered.capture.capture_hash===verified.capture.capture_hash,"Voided document preserves historical proof without another download");
 check(recovered.report===null,"Byte verification never creates clinical report link");
}catch(error){failures.push(error);}finally{
 if(server){server.kill("SIGTERM");await new Promise<void>(resolve=>{if(server!.exitCode!==null||server!.signalCode!==null)resolve();else server!.once("exit",()=>resolve());});}
 try{
  if(path){const removed=await fetch(local.API_URL+"/storage/v1/object/patient-documents",{method:"DELETE",headers:serviceHeaders,body:JSON.stringify({prefixes:[path]})});check(removed.ok,"Synthetic private object cleaned");}
  if(ids.length){const patterns=ids.map(value=>quote(`%${value}%`)).join(',');sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`);}
  if(actor)check((await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders})).ok,"Synthetic Auth user cleaned");
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local lab byte verification or cleanup failed");
console.log(`Local lab HTTP/Auth/Storage/SQL verification: ${assertions} checks passed. Synthetic only; no Antech requests.`);
