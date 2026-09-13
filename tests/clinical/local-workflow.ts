/** Actual local HTTP/Auth/SQL roundtrip with synthetic provider responses only. */
import {execFileSync} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {renderVaccineCertificate} from "../../supabase/functions/_shared/vaccine-certificate-renderer.ts";
import {renderRecordRelease} from "../../supabase/functions/_shared/record-release-renderer.ts";
import {renderInvoiceDocument} from "../../supabase/functions/_shared/invoice-document.ts";
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
async function denied(name:string,args:Record<string,unknown>,code:string){const response=await fetch(local.API_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:staffHeaders,body:JSON.stringify(args)});const result=await response.json();check(!response.ok&&result.code===code,`${name} rejects cross-workflow invalid state (${code})`);}
const id=()=>{const value=randomUUID();ids.push(value);return value;};
try{
 const email=`clinical-roundtrip-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 actor=(await api("/auth/v1/admin/users",{email,password,email_confirm:true})).id;ids.push(actor);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'DVM') on conflict do nothing;`);
 const staff=(name:string,args:Record<string,unknown>)=>rpc(name,args,true);
 client=(await staff("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Clinical chain",p_primary_phone:"+13035550199",p_primary_email:"clinical@example.test",p_preferred_channel:"EMAIL",p_mailing_address:"Synthetic mailing address",p_housecall_address:"Synthetic housecall address"})).id;ids.push(client);
 const patientArgs={p_id:null,p_client_id:client,p_expected_version:null,p_name:"Synthetic patient",p_species:"Dog",p_breed:"Synthetic mixed",p_dob:"2020-01-01",p_birth_date_precision:"exact",p_color:"Brown",p_sex:"female",p_neuter_status:"neutered",p_microchip_id:"000000000000001",p_archived_at:null,p_deceased_at:null};
 const patient=await staff("save_patient",patientArgs),sibling=await staff("save_patient",{...patientArgs,p_name:"Excluded sibling",p_microchip_id:"000000000000002"});ids.push(patient.id,sibling.id);
 check(patient.client_id===client && sibling.client_id===client,"Patient and excluded sibling retain household identity");
 const tomorrow=new Date(Date.now()+86400000).toISOString(),later=new Date(Date.now()+2*86400000).toISOString();
 const bookingArgs={p_actor_id:actor,p_id:null,p_expected_version:null,p_client_id:client,p_pet_id:patient.id,p_scheduled_at:tomorrow,p_duration_minutes:30,p_appointment_type:"Synthetic visit",p_status:"SCHEDULED",p_assigned_dvm_id:actor,p_visit_type:"clinic",p_address_snapshot:"Ignored clinic draft address",p_travel_before_minutes:0,p_travel_after_minutes:0,p_resource_name:null,p_notes:"Internal scheduling note",p_reminder_offsets:[]};
 const clinic=await staff("save_appointment",bookingArgs),house=await staff("save_appointment",{...bookingArgs,p_scheduled_at:later,p_visit_type:"housecall",p_address_snapshot:"Synthetic housecall address",p_travel_before_minutes:20,p_travel_after_minutes:20});ids.push(clinic.id,house.id);
 check(clinic.pet_id===patient.id && house.client_id===client && clinic.address_snapshot==="2619 Spruce Street, Boulder, CO" && house.address_snapshot==="Synthetic housecall address","Both bookings preserve selected patient and correct location snapshots");
 const visitAt=new Date().toISOString();
 const soapArgs={p_id:null,p_pet_id:patient.id,p_expected_version:null,p_visit_at:visitAt,p_visit_type:house.visit_type,p_location:house.address_snapshot,p_subjective:"Synthetic history",p_objective:"Synthetic examination",p_assessment:"Synthetic assessment, no clinical recommendation",p_plan:"Synthetic workflow plan"};
 const encounter=await staff("save_clinical_encounter",soapArgs),excluded=await staff("save_clinical_encounter",{...soapArgs,p_subjective:"UNSELECTED DRAFT"});ids.push(encounter.id,excluded.id);
 const signed=await staff("sign_clinical_encounter",{p_id:encounter.id,p_expected_version:encounter.version});check(signed.pet_id===house.pet_id && signed.signed_by===actor,"Explicit SOAP creation and signing preserve booked patient and actor");
 const problem=await staff("save_patient_problem",{p_id:null,p_pet_id:patient.id,p_expected_version:null,p_title:"Synthetic prior vaccine reaction",p_notes:"TEST ONLY",p_onset_date:null,p_status:"resolved",p_importance:"high"});ids.push(problem.id);
 const stale=await staff("read_patient_treatment_alerts",{p_pet_id:patient.id});
 await staff("save_patient_problem",{p_id:problem.id,p_pet_id:patient.id,p_expected_version:problem.version,p_title:problem.title,p_notes:"TEST ONLY amended history",p_onset_date:null,p_status:"resolved",p_importance:"high"});
 const current=await staff("read_patient_treatment_alerts",{p_pet_id:patient.id});check(current.snapshot.important_problems[0].id===problem.id && current.source_hash!==stale.source_hash,"Resolved critical history remains visible and changes invalidate prior review");
 const invoice=id();await staff("create_billing_invoice",{p_id:invoice,p_client_id:client});
 const treatmentIds:string[]=[],lots:string[]=[];
 for(const kind of ["vaccine","medication"]){
  const product=await staff("save_catalog_product",{p_id:null,p_expected_version:null,p_name:`Synthetic ${kind}`,p_kind:kind,p_manufacturer:"Synthetic manufacturer",p_unit:"dose",p_unit_price_cents:kind==="vaccine"?3000:1500,p_active:true});ids.push(product.id);
  const lot=id();lots.push(lot);await staff("receive_inventory",{p_id:id(),p_lot_id:lot,p_product_id:product.id,p_lot_number:`SYNTHETIC-${kind}`,p_expires_on:"2099-12-31",p_location:house.address_snapshot,p_quantity:10,p_reason:"Synthetic workflow fixture"});
  const treatment=id();treatmentIds.push(treatment);
  const request={pet_id:patient.id,lot_id:lot,invoice_id:invoice,quantity:1,dose:"Synthetic dose",route:"SC",site:"Synthetic site",veterinarian:"Dr Synthetic",veterinarian_license:"TEST-ONLY",administered_at:visitAt,next_due_on:kind==="vaccine"?"2099-01-01":null,alert_review:{source_hash:current.source_hash,acknowledged:true}};
  if(kind==="vaccine"){
   await denied("record_patient_treatment",{p_id:treatment,p_request:{...request,alert_review:{source_hash:stale.source_hash,acknowledged:true}}},"40001");
   check(sql(`select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=${quote(lot)};`)==="10.000","Rejected stale alert leaves stock untouched");
   check(sql(`select count(*) from public.billing_invoice_items where invoice_id=${quote(invoice)};`)==="0","Rejected stale alert creates no invoice charge");
  }
  const saved=await staff("record_patient_treatment",{p_id:treatment,p_request:request});await staff("record_patient_treatment",{p_id:treatment,p_request:request});
  check(saved.pet_id===patient.id && saved.invoice_id===invoice,"Treatment binds patient and same household invoice");
  check(sql(`select sum(quantity) from public.inventory_movements where lot_id=${quote(lot)};`)==="9.000","Exact treatment replay debits stock only once");
 }
 const issued=await staff("issue_billing_invoice",{p_id:invoice,p_expected_version:Number(sql(`select version from public.billing_invoices where id=${quote(invoice)};`))});check(Number(issued.total_cents)===4500,"Issued invoice totals one vaccine and one medication charge");
 const invoiceDocument=await staff("read_invoice_document",{p_invoice_id:invoice,p_client_id:client});check(invoiceDocument.client.id===client && invoiceDocument.items.length===2 && invoiceDocument.items.every((item:{id:string})=>treatmentIds.includes(item.id)),"Invoice document retains household and exact treatment charge IDs");
 check(sql(`select count(*) from public.treatment_alert_reviews where treatment_id in (${treatmentIds.map(quote).join(',')}) and pet_id=${quote(patient.id)} and reviewed_by=${quote(actor)};`)==="2","Both stock-backed treatments retain actor-bound critical alert review");
 // Synthetic issuer belongs only to this run; this is not practice credential acceptance.
 sql(`insert into public.certificate_issuers(user_id,full_name,license_number,license_state,license_expires_on,practice_name,practice_address,practice_phone,verified_at,verification_reference,clinical_acceptance_at,active) values(${quote(actor)},'Dr Synthetic','TEST-ONLY','CO',current_date+365,'Synthetic practice','2619 Spruce Street, Boulder CO','3035550199',now(),'LOCAL TEST ONLY',now(),true);`);
 const certArgs={p_pet_id:patient.id,p_kind:"vaccine_history",p_rabies_treatment_id:null,p_details:{due_plan_review_version:2}};
 const preview=await staff("preview_vaccine_certificate",certArgs),certificate=id();
 check(preview.vaccinations.length===1 && JSON.stringify(preview).includes(treatmentIds[0]) && !JSON.stringify(preview).includes(treatmentIds[1]),"Certificate selects vaccine treatment rather than medication");
 const issuedCertificate=await staff("issue_vaccine_certificate",{p_id:certificate,...certArgs,p_reviewed_snapshot:preview,p_signature_name:"Dr Synthetic",p_attest_review:true});
 check(renderVaccineCertificate(issuedCertificate,[]).includes("SYNTHETIC-vaccine"),"Actual certificate snapshot renders frozen stock lot");
 check(renderInvoiceDocument(invoiceDocument,{name:"Synthetic practice",address:"Synthetic address"}).includes("Synthetic medication"),"Actual invoice snapshot renders medication charge");
 const selection={encounter_ids:[encounter.id],certificate_ids:[certificate],problem_ids:[problem.id],treatment_ids:treatmentIds};
 const releaseArgs={p_pet_id:patient.id,p_client_id:client,p_channel:"EMAIL",p_recipient:"clinical@example.test",p_selection:selection};
 const released=await staff("preview_record_release",releaseArgs);check(!JSON.stringify(released).includes("UNSELECTED DRAFT") && !JSON.stringify(released).includes(sibling.id),"Selected release excludes unselected draft and sibling");
 check(released.snapshot.encounters.length===1 && released.snapshot.certificates.length===1 && released.snapshot.treatments.length===2,"Selected release binds signed SOAP, certificate and both treatments");
 const releaseHtml=renderRecordRelease({preview:released});check(releaseHtml.includes("Synthetic history") && releaseHtml.includes("Synthetic vaccine") && !releaseHtml.includes("UNSELECTED DRAFT"),"Actual selected release renders SOAP and vaccine without excluded draft");
 await denied("preview_record_release",{...releaseArgs,p_pet_id:sibling.id},"23514");
 const policyBefore=sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.record_release_policy p;"),releaseId=id();
 const jsonq=(value:unknown)=>quote(JSON.stringify(value))+"::jsonb";
 // Policy gate and confirmation are inside one rolled-back transaction, never a persistent approval.
 const confirmed=sql(`begin;insert into public.record_release_policy(id,enabled,accepted_schema_version,accepted_by,accepted_at,acceptance_reference) values(true,true,3,'SYNTHETIC ONLY',now(),'ROLLBACK TEST ONLY') on conflict(id) do update set enabled=true,accepted_schema_version=3,accepted_by='SYNTHETIC ONLY',accepted_at=now(),acceptance_reference='ROLLBACK TEST ONLY';set local role authenticated;select set_config('request.jwt.claims',${quote(JSON.stringify({sub:actor,role:"authenticated"}))},true);select public.confirm_record_release(${quote(releaseId)},${quote(patient.id)},${quote(client)},'EMAIL','clinical@example.test',${jsonq(selection)},${jsonq(released.snapshot)},${quote(released.source_hash)},true);select jsonb_build_object('count',(select count(*) from public.record_release_sources where release_id=${quote(releaseId)}),'eligible',public.read_record_release(${quote(releaseId)})->'eligible');rollback;`);
 const result=JSON.parse(confirmed.split("\n").at(-1)!);check(result.count===5 && result.eligible===true,"Rollback-only release confirmation binds exactly five selected sources");
 check(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.record_release_policy p;")===policyBefore && sql(`select count(*) from public.record_releases where id=${quote(releaseId)};`)==="0","Clinical acceptance policy and confirmed package did not persist");
 check(sql(`select count(*) from public.communication_outbox where client_id=${quote(client)};`)==="0","Clinical chain never enqueues a client message");
}catch(error){failures.push(error);}finally{
 try{
  if(ids.length){const patterns=ids.map(value=>quote(`%${value}%`)).join(',');sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`);}
  if(actor){check((await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders})).ok,"Synthetic Auth user cleaned");check(sql(`select count(*) from public.clients where id=${quote(client||actor)};`)==="0","Synthetic clinical household cleanup verified");}
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local clinical workflow or cleanup failed");
console.log(`Local clinical Auth/PostgREST/SQL workflow: ${assertions} checks passed. Synthetic only; no clinical acceptance or provider sends.`);
