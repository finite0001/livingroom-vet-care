import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {createServer} from "node:http";
import {prescriptionArtifact} from "./prescription-fixture.ts";
import {renderRecordRelease, type ReleaseApiOriginal, type ReleaseBundle} from "../../supabase/functions/_shared/record-release-renderer.ts";
import {validateReleaseApiOriginals} from "../../supabase/functions/_shared/record-release-api-originals.ts";
import {createReleaseApiOriginalReader} from "../../supabase/functions/_shared/release-api-original-download.ts";
import {buildReleaseEmailPayload} from "../../supabase/functions/_shared/release-email-payload.ts";
import {buildDocumentLinkArtifacts, type DocumentLinkGrant} from "../../supabase/functions/_shared/document-link-artifacts.ts";
const bytes=new TextEncoder().encode("%PDF-1.7\nSynthetic original\n%%EOF"), hash=createHash("sha256").update(bytes).digest("hex"), now="2026-09-14T12:00:00Z";
function fixture(){
 const artifact=prescriptionArtifact(), s=artifact.preview.snapshot;
 s.patient.id=randomUUID();s.recipient.client_id=randomUUID();
 for (const key of Object.keys(s)) if (Array.isArray(s[key])) s[key]=[];
 for (const key of Object.keys(s.selection || {})) s.selection![key]=[];
 const r:ReleaseApiOriginal["record"]={id:randomUUID(),action_id:randomUUID(),approved_by:randomUUID(),approved_at:now,pet_id:s.patient.id,client_id:s.recipient.client_id,patient_version:1,animal_link_id:randomUUID(),capture_id:randomUUID(),capture_request_id:randomUUID(),capture_hash:"a".repeat(64),request_hash:"b".repeat(64),record_hash:"c".repeat(64),source_origin:"https://api.ezyvet.com",source_site_uid:"synthetic",source_animal_id:"77",source_attachment_id:"701",source_file_id:"801",snapshot_id:randomUUID(),observed_head_version:1,stable_metadata_sha256:"d".repeat(64),raw_record_sha256:"e".repeat(64),metadata:{id:"701",file_id:"801",record_type:"Animal",record_id:"77",name:"<script>Original</script>"},content_sha256:hash,mime_type:"application/pdf",file_size:bytes.length,captured_at:now,entry_method:"staff_reviewed_ezyvet_api_attachment_v1",source_current_at_review:false,previous_record_id:null,version:1,kind:"original",review_reason:"Reviewed source and patient"};
 const original:ReleaseApiOriginal={record:r,acknowledgment:{id:randomUUID(),action_id:randomUUID(),record_id:r.id,pet_id:r.pet_id,actor_id:randomUUID(),record_hash:r.record_hash,capture_hash:r.capture_hash,created_at:now}};
 s.schema_version=9;s.selection={...s.selection,api_original_ids:[r.id]};s.api_originals=[original];
 // Existing fixture source documents require their own captured bytes; this fixture isolates the new family.
 s.attachments=[];s.lab_reports=[];s.external_records=[];s.lab_results=[];
 const bundle:ReleaseBundle={release:{...artifact.preview,id:randomUUID(),pet_id:r.pet_id,client_id:r.client_id,channel:"EMAIL",recipient:"owner@example.test",selection:s.selection!,created_by:r.approved_by,created_at:now},events:[],eligible:true,ineligibility_reason:null};
 const intent={id:randomUUID(),release_id:bundle.release.id,actor_id:r.approved_by,recipient:bundle.release.recipient,subject:"Reviewed originals",body:"Records",release_hash:bundle.release.source_hash};
 const context={record_id:r.id,record_hash:r.record_hash,capture_hash:r.capture_hash,content_sha256:r.content_sha256,mime_type:r.mime_type,file_size:r.file_size,bucket_id:"ezyvet-attachment-originals",object_path:`${r.approved_by}/${r.pet_id}/${r.capture_request_id}/${randomUUID()}/original`,storage_object_id:randomUUID()};
 return {artifact,s,original,bundle,intent,context};
}
test("schema9 renders complete API-only provenance and historical-source disclosure",()=>{
 const f=fixture();const html=renderRecordRelease(f.artifact);assert.match(html,/Reviewed ezyVet API originals/);assert.match(html,/Veterinary acknowledgment/);assert.match(html,/Historical provider observation/);assert.match(html,/&lt;script&gt;Original/);assert.doesNotMatch(html,/<script>/);assert.match(html,new RegExp(hash));assert.equal(html,renderRecordRelease(f.artifact));
});
test("schema9 requires exact patient, client, selection, capture acknowledgment and private-free projection",()=>{
 const mutations=[(f:ReturnType<typeof fixture>)=>{f.s.api_originals=undefined;},(f:ReturnType<typeof fixture>)=>{f.s.selection!.api_original_ids=[];},(f:ReturnType<typeof fixture>)=>{f.original.record.pet_id=randomUUID();},(f:ReturnType<typeof fixture>)=>{f.original.record.client_id=randomUUID();},(f:ReturnType<typeof fixture>)=>{f.original.acknowledgment.capture_hash="f".repeat(64);},(f:ReturnType<typeof fixture>)=>{f.original.acknowledgment.record_id=randomUUID();},(f:ReturnType<typeof fixture>)=>{Object.assign(f.original.record,{object_path:"private"});},(f:ReturnType<typeof fixture>)=>{Object.assign(f.original.record.metadata,{file_download_url:"https://secret.invalid"});},(f:ReturnType<typeof fixture>)=>{f.s.api_originals!.push(f.original);},(f:ReturnType<typeof fixture>)=>{f.s.schema_version=8;}];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>validateReleaseApiOriginals(f.s));}
});
test("both builders attach identical unchanged originals with distinct provider and link envelopes",async()=>{
 const f=fixture(), old=async()=>{throw Error("No patient document expected");};
 const email=await buildReleaseEmailPayload(f.intent,f.bundle,{from:"practice@example.test",replyTo:"practice@example.test"},old,async()=>bytes);
 const attachment=JSON.parse(email.payload_text).attachments.at(-1);assert.deepEqual(Object.keys(attachment).sort(),["content","content_type","filename"]);assert.equal(attachment.filename,"1-ezyvet-original-701.pdf");assert.deepEqual(Buffer.from(attachment.content,"base64"),Buffer.from(bytes));
 f.bundle.release.channel="SMS";
 const grant={family:"record_release",source_bundle:f.bundle,source_id:f.bundle.release.id,client_id:f.bundle.release.client_id,recipient:f.bundle.release.recipient,source_hash:f.bundle.release.source_hash} as DocumentLinkGrant;
 const link=await buildDocumentLinkArtifacts(grant,{name:"Practice",address:"Boulder",domain:"example.test"},old,async()=>bytes);
 const a=JSON.parse(link.payload_text).artifacts.at(-1);assert.equal(a.document_id,null);assert.equal(a.api_original_id,f.original.record.id);assert.equal(a.filename,attachment.filename);assert.equal(a.content,attachment.content);
});
test("builders reject missing reader and same-size substituted API bytes",async()=>{
 const f=fixture();const sender={from:"practice@example.test",replyTo:"practice@example.test"};const corrupt=bytes.slice();corrupt[10]^=1;
 await assert.rejects(()=>buildReleaseEmailPayload(f.intent,f.bundle,sender,async()=>bytes));
 await assert.rejects(()=>buildReleaseEmailPayload(f.intent,f.bundle,sender,async()=>bytes,async()=>corrupt));
 f.bundle.release.channel="SMS";const grant={family:"record_release",source_bundle:f.bundle,source_id:f.bundle.release.id,client_id:f.bundle.release.client_id,recipient:f.bundle.release.recipient,source_hash:f.bundle.release.source_hash} as DocumentLinkGrant;
 await assert.rejects(()=>buildDocumentLinkArtifacts(grant,{name:"Practice",address:"Boulder",domain:"example.test"},async()=>bytes,async()=>corrupt));
});
test("bounded production reader uses native HTTP and revalidates exact context after bytes",async()=>{
 const f=fixture();let calls=0;const server=createServer((req,res)=>{assert.equal(req.headers.authorization,"Bearer synthetic-service");assert.match(req.url!,/^\/storage\/v1\/object\/authenticated\/ezyvet-attachment-originals\//);res.writeHead(200,{"Content-Type":"application/pdf","Content-Length":bytes.length});res.end(bytes);});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{const address=server.address() as {port:number};const read=createReleaseApiOriginalReader({url:`http://127.0.0.1:${address.port}`,serviceKey:"synthetic-service",apiKey:"synthetic-anon",service:{rpc:async(name,args)=>{assert.equal(name,"get_release_api_original_context");assert.deepEqual(args,{p_family:"release_email",p_id:f.intent.id,p_actor_id:f.intent.actor_id,p_record_id:f.original.record.id});calls++;return {data:f.context,error:null};}}});assert.deepEqual(await read(f.original,"release_email",f.intent.id,f.intent.actor_id),bytes);assert.equal(calls,2);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test("reader rejects context substitution before read, object replacement or revoked eligibility afterward",async()=>{
 for(const mode of ["wrong-pet-path","wrong-hash","wrong-bucket","after-object","after-role","corrupt","partial","compressed","oversize"]){const f=fixture();let calls=0,reads=0;const read=createReleaseApiOriginalReader({url:"https://storage.invalid",serviceKey:"synthetic",apiKey:"synthetic",service:{rpc:async()=>{calls++;const c={...f.context};if(mode==="wrong-pet-path")c.object_path=c.object_path.replace(f.original.record.pet_id,randomUUID());if(mode==="wrong-hash")c.capture_hash="f".repeat(64);if(mode==="wrong-bucket")c.bucket_id="patient-documents";if(mode==="after-object"&&calls===2)c.storage_object_id=randomUUID();return {data:c,error:mode==="after-role"&&calls===2?{code:"42501"}:null};}},fetch:async(_input,init)=>{reads++;assert.equal(init?.redirect,"error");assert.ok(init?.signal);const b=bytes.slice();if(mode==="corrupt")b[10]^=1;return new Response(b,{status:mode==="partial"?206:200,headers:{"Content-Type":"application/pdf",...(mode==="compressed"?{"Content-Encoding":"gzip"}:{}),...(mode==="oversize"?{"Content-Length":"20971521"}:{})}});}});await assert.rejects(()=>read(f.original,"release_email",f.intent.id,f.intent.actor_id));if(mode.startsWith("wrong-"))assert.equal(reads,0);}
});
test("mixed originals preserve legacy envelope and append API file at the global index",async()=>{
 const f=fixture();f.s.attachments=[{id:randomUUID(),version:1,file_name:"ordinary.pdf",file_path:"actor/pet/document/original",bucket:"patient-documents",mime_type:"application/pdf",file_size:bytes.length,document_date:null,category:"medical_record"}];
 const order:string[]=[];const result=await buildReleaseEmailPayload(f.intent,f.bundle,{from:"practice@example.test",replyTo:"practice@example.test"},async(bucket)=>{order.push(bucket);return bytes;},async()=>{order.push("api");return bytes;});
 assert.deepEqual(order,["patient-documents","api"]);assert.equal(JSON.parse(result.payload_text).attachments[2].filename,"2-ezyvet-original-701.pdf");
 f.bundle.release.channel="SMS";const grant={family:"record_release",source_bundle:f.bundle,source_id:f.bundle.release.id,client_id:f.bundle.release.client_id,recipient:f.bundle.release.recipient,source_hash:f.bundle.release.source_hash} as DocumentLinkGrant;
 const link=JSON.parse((await buildDocumentLinkArtifacts(grant,{name:"Practice",address:"Boulder",domain:"example.test"},async()=>bytes,async()=>bytes)).payload_text).artifacts;
 assert.deepEqual(Object.keys(link[1]).sort(),["content","document_id","filename","mime_type"]);assert.equal(link[1].document_id,f.s.attachments[0].id);assert.equal(link[2].api_original_id,f.original.record.id);
});
test("combined size and count bounds reject before any Storage read",async()=>{
 for(const mode of ["size","count"]){const f=fixture();let reads=0;const original=f.original;
 if(mode==="size")original.record.file_size=20971520;
 f.s.attachments=Array.from({length:mode==="count"?24:1},()=>({id:randomUUID(),version:1,file_name:"ordinary.pdf",file_path:"actor/pet/document/original",bucket:"patient-documents" as const,mime_type:"application/pdf" as const,file_size:mode==="size"?20971520:bytes.length,document_date:null,category:"medical_record"}));
 await assert.rejects(()=>buildReleaseEmailPayload(f.intent,f.bundle,{from:"practice@example.test",replyTo:"practice@example.test"},async()=>{reads++;return bytes;},async()=>{reads++;return bytes;}));assert.equal(reads,0);
 f.bundle.release.channel="SMS";const grant={family:"record_release",source_bundle:f.bundle,source_id:f.bundle.release.id,client_id:f.bundle.release.client_id,recipient:f.bundle.release.recipient,source_hash:f.bundle.release.source_hash} as DocumentLinkGrant;
 await assert.rejects(()=>buildDocumentLinkArtifacts(grant,{name:"Practice",address:"Boulder",domain:"example.test"},async()=>{reads++;return bytes;},async()=>{reads++;return bytes;}));assert.equal(reads,0);}
});
