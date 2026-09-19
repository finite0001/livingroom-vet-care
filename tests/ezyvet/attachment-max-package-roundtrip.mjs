import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createPrepareReleaseEmailHandler } from '../../supabase/functions/_shared/prepare-release-email.ts';
import { createStaffDocumentLinkHandler,createRetrieveDocumentLinkHandler } from '../../supabase/functions/_shared/document-link-http.ts';
import { documentLinkConfig,materializeDocumentLink } from '../../supabase/functions/_shared/document-link-capability.ts';

const project=process.env.PAYMENT_TEST_PROJECT;
assert.ok(project);
const projectId=readFileSync(`${project}/supabase/config.toml`,'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
assert.match(projectId,/^lrv-attachment-[a-f0-9]{12}$/);
const local=JSON.parse(execFileSync('supabase',['status','--workdir',project,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(local.API_URL,'http://127.0.0.1:62421');
const sql=query=>execFileSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const digest=value=>createHash('sha256').update(value).digest('hex');
const bytesFor=n=>Buffer.from(`%PDF-1.7\nSynthetic maximum package original ${String(n).padStart(3,'0')}\n%%EOF\n`);
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,options);
const api=createClient(local.API_URL,local.ANON_KEY,options);
const checked=result=>{if(result.error)throw result.error;return result.data;};
const rpc=async(name,args,staff=false)=>checked(await (staff?api:admin).rpc(name,args));
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const denied=async action=>{await assert.rejects(action,error=>error.code==='23514');checks++;};
const servers=[];const failures=[];
const serve=async handler=>{
  const server=createServer(async(req,res)=>{
    try {
      let body='';for await(const chunk of req)body+=chunk;
      const response=await handler(new Request('http://local.test/package',{method:req.method,headers:req.headers,body}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    } catch(error){failures.push(error);res.statusCode=500;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};
const expected=new Map();const approvals=[];const documents=[];
const origin='https://thelivingroom.vet';
try {
  const email=`max-package-${randomUUID()}@example.test`,password=randomUUID()+randomUUID();
  const actor=checked(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id;
  sql(`insert into user_roles(user_id,role) values('${actor}','ADMIN') on conflict do nothing;update profiles set is_active=true where id='${actor}';`);
  const login=checked(await api.auth.signInWithPassword({email,password}));
  const headers={Authorization:`Bearer ${login.session.access_token}`,'Content-Type':'application/json',Origin:origin};
  const client=(await rpc('save_client',{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:'Synthetic maximum',p_last_name:'Package fixture',p_primary_phone:'+13035550489',p_primary_email:email,p_preferred_channel:'EMAIL',p_mailing_address:null,p_housecall_address:null},true)).id;
  const pet=(await rpc('save_patient',{p_id:null,p_client_id:client,p_expected_version:null,p_name:'Maximum package patient',p_species:'Dog',p_breed:null,p_dob:null,p_birth_date_precision:'unknown',p_color:null,p_sex:'unknown',p_neuter_status:'unknown',p_microchip_id:null,p_archived_at:null,p_deceased_at:null},true)).id;
  const mapping=randomUUID(),snapshot=randomUUID(),run=randomUUID(),site=`Max-${randomUUID()}`;
  sql(`insert into ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values('${snapshot}','https://api.trial.ezyvet.com',${quote(site)},'animal','77','{"id":77}',encode(sha256(convert_to('{"id":77}'::jsonb::text,'UTF8')),'hex'),'${actor}');
    insert into ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id,version) values('https://api.trial.ezyvet.com',${quote(site)},'animal','77','${snapshot}',1);
    insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by) values('${mapping}','${mapping}','synthetic-max-link','https://api.trial.ezyvet.com',${quote(site)},'animal','77','${snapshot}',1,'${client}','${pet}',1,'link','LOCAL SYNTHETIC ONLY','${actor}');`);
  for(let page=1;page<=3;page++) {
    const observations=[];
    for(let n=(page-1)*10+1;n<=Math.min(page*10,21);n++) observations.push({external_id:String(1000+n),file_id:String(2000+n),metadata:{id:String(1000+n),file_id:String(2000+n),record_type:'Animal',record_id:'77',name:`Maximum original ${n}`},raw_record_sha256:digest(`raw-${n}`),stable_metadata_sha256:digest(`stable-${n}`),file_sha256:null});
    sql(`update ezyvet_import_runs set retry_after=null where id='${run}';`);
    const claim=await rpc('claim_ezyvet_attachment_import',{p_id:run,p_actor:actor,p_site_uid:site,p_source_origin:'https://api.trial.ezyvet.com',p_animal_link_id:mapping});
    await rpc('stage_ezyvet_attachment_page',{p_run_id:run,p_actor:actor,p_lease_id:claim.lease_id,p_page:{contract_version:'ezyvet_animal_attachment_metadata_v1',parent:{record_type:'Animal',record_id:'77'},page,complete:page===3,pagination:{items_page:page,items_page_total:3,items_page_size:10,items_total:21},observations,page_sha256:digest(JSON.stringify(observations))}});
  }
  sql(`update ezyvet_import_runs set retry_after=null where id='${run}';`);
  const observed=(await rpc('list_ezyvet_attachment_observations',{p_run_id:run,p_animal_link_id:mapping,p_limit:50},true)).observations;
  check(observed.length===21,'Metadata fixture retains all21 potential originals');
  const capture=async n=>{
    const o=observed[n-1],id=randomUUID(),bytes=bytesFor(n),sha=digest(bytes);
    await rpc('prepare_ezyvet_attachment_capture',{p_id:id,p_animal_link_id:mapping,p_run_id:run,p_page:o.page,p_ordinal:o.ordinal,p_snapshot_id:o.snapshot_id,p_observed_head_version:o.observed_head_version,p_stable_metadata_sha256:o.stable_metadata_sha256},true);
    const claim=await rpc('claim_ezyvet_attachment_capture',{p_id:id,p_actor:actor});
    const reserved=await rpc('reserve_ezyvet_attachment_original',{p_id:id,p_actor:actor,p_lease_id:claim.lease_id,p_content_sha256:sha,p_mime_type:'application/pdf',p_file_size:bytes.length,p_before_raw_sha256:o.raw_record_sha256,p_after_raw_sha256:o.raw_record_sha256});
    checked(await api.storage.from(reserved.intent.bucket_id).upload(reserved.intent.object_path,bytes,{contentType:'application/pdf',upsert:false}));
    const stored=Buffer.from(await checked(await admin.storage.from(reserved.intent.bucket_id).download(reserved.intent.object_path)).arrayBuffer());
    check(digest(stored)===sha,'API original physical readback matches unique bytes');
    check(Boolean((await api.storage.from(reserved.intent.bucket_id).download(reserved.intent.object_path)).error),'Direct staff read of captured API bucket denied');
    const ready=await rpc('complete_ezyvet_attachment_capture',{p_id:id,p_actor:actor,p_lease_id:claim.lease_id,p_intent_id:reserved.intent.id,p_content_sha256:sha,p_mime_type:'application/pdf',p_file_size:bytes.length});
    const record=await rpc('approve_ezyvet_attachment_record',{p_id:randomUUID(),p_request_id:id,p_pet_id:pet,p_capture_hash:ready.request.capture.capture_hash,p_previous_record_id:null,p_title:`Maximum original ${n}`,p_review_reason:'Synthetic exact physical bytes inspected',p_attest:true},true);
    approvals.push(record.id);expected.set(id,sha);
  };
  const native=async n=>{
    const id=randomUUID(),bytes=bytesFor(100+n);
    const doc=await rpc('prepare_patient_document',{p_id:id,p_pet_id:pet,p_encounter_id:null,p_file_name:`native-${n}.pdf`,p_mime_type:'application/pdf',p_file_size:bytes.length,p_category:'medical_record',p_source:'Synthetic maximum package fixture',p_document_date:null,p_visibility:'client_shareable'},true);
    checked(await api.storage.from('patient-documents').upload(doc.file_path,bytes,{contentType:'application/pdf',upsert:false}));
    await rpc('finalize_patient_document',{p_id:id},true);documents.push(id);expected.set(id,digest(bytes));
    check(digest(Buffer.from(await checked(await api.storage.from('patient-documents').download(doc.file_path)).arrayBuffer()))===digest(bytes),'Native physical original matches unique bytes');
  };
  for(let n=1;n<=20;n++) await capture(n);
  for(let n=1;n<=4;n++) await native(n);
  const selection={api_attachment_ids:[...approvals],document_ids:[...documents]};
  const all=await rpc('select_all_record_release_sources_v9',{p_pet_id:pet},true);
  check(all.selection.api_attachment_ids.length===20&&all.selection.document_ids.length===4,'Select all retains20 API and4 native originals');
  check(new Set(expected.values()).size===24,'All24 selected physical contents are distinct');
  sql(`insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic local reviewer',now(),'MAXIMUM LOCAL TEST ONLY',9) on conflict(id) do update set enabled=true,accepted_schema_version=9;`);
  const releases={};
  for(const channel of ['EMAIL','SMS']) {
    const args={p_pet_id:pet,p_client_id:client,p_channel:channel,p_recipient:channel==='EMAIL'?email:'+13035550489',p_selection:selection};
    const preview=await rpc('preview_record_release_v9',args,true);
    check(preview.snapshot.api_attachments.length===20&&preview.snapshot.attachments.length===24,'Maximum preview retains every selected original');
    const release=await rpc('confirm_record_release',{...args,p_id:randomUUID(),p_reviewed_snapshot:preview.snapshot,p_reviewed_hash:preview.source_hash,p_attest_review:true},true);
    releases[channel]={release,preview};
  }
  const conversation=randomUUID();sql(`insert into conversations(id,client_id) values('${conversation}','${client}');`);
  let downloads=0;
  const download=async(bucket,path,size)=>{downloads++;const bytes=new Uint8Array(await checked(await admin.storage.from(bucket).download(path)).arrayBuffer());assert.equal(bytes.length,size);return bytes;};
  const authenticate=async token=>{const result=await admin.auth.getUser(token);return result.error||result.data.user?.id!==actor?null:{actorId:actor,db:api};};
  const emailUrl=await serve(createPrepareReleaseEmailHandler({authenticate,service:admin,download,sender:{from:'care@example.test',replyTo:'care@example.test'}}));
  const emailArgs={p_request_id:randomUUID(),p_release_id:releases.EMAIL.release.id,p_conversation_id:conversation,p_subject:'Synthetic maximum package',p_body:'Local fixture; never sent',p_release_hash:releases.EMAIL.release.source_hash};
  const post=async(url,args,staff=true)=>fetch(url,{method:'POST',headers:staff?headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
  const emailResponse=await post(emailUrl,emailArgs);check(emailResponse.ok,'Production HTTP handler prepares maximum email');
  const emailSaved=await emailResponse.json();check(emailSaved.manifest.length===25,'Email manifest contains report plus24 originals');
  for(const row of emailSaved.manifest.slice(1))check(row.sha256===expected.get(row.document_id),'Each email entry matches its physical original');
  await rpc('record_sms_consent',{p_actor_id:actor,p_client_id:client,p_phone:'+13035550489',p_opted_in:true,p_method:'WRITTEN',p_details:'Synthetic maximum package consent only',p_expected_updated_at:null},true);
  const config=documentLinkConfig({origin,activeKeyVersion:'synthetic',keys:JSON.stringify({synthetic:Buffer.from('synthetic-local-secret-00000000000').toString('base64')}),publicEnabled:'true'});
  const linkUrl=await serve(createStaffDocumentLinkHandler({config,authenticate,service:admin,download,practice:{name:'Synthetic',address:'Synthetic',domain:null}},'prepare'));
  const linkArgs={p_request_id:randomUUID(),p_family:'record_release',p_source_id:releases.SMS.release.id,p_client_id:client,p_conversation_id:conversation,p_recipient:'+13035550489',p_source_hash:releases.SMS.release.source_hash,p_expires_at:new Date(Date.now()+86400000).toISOString(),p_message_template:'Synthetic records: {{document_link}}'};
  const linkResponse=await post(linkUrl,linkArgs);check(linkResponse.ok,'Production HTTP handler prepares maximum link package');
  const linkSaved=await linkResponse.json();check(linkSaved.manifest.length===25,'Link manifest contains report plus24 originals');
  const context=await rpc('document_link_capture_context',{p_id:linkArgs.p_request_id,p_actor_id:actor});
  const capability=await materializeDocumentLink(context.grant,config);
  await rpc('attest_document_link',{p_request_id:linkArgs.p_request_id,p_reviewed_artifact_hash:linkSaved.artifact_hash,p_reviewed_message_hash:capability.message_hash,p_attest:true},true);
  const publicUrl=await serve(createRetrieveDocumentLinkHandler({config,service:admin}));
  for(let index=1;index<=24;index++) {
    const response=await post(publicUrl,{grant_id:linkArgs.p_request_id,token:capability.token,artifact_index:index},false);
    check(response.ok,'Public HTTP returns a selected maximum-package original');
    check(digest(Buffer.from(await response.arrayBuffer()))===expected.get(releases.SMS.preview.snapshot.attachments[index-1].id),'Retrieved maximum-package bytes match exact selected ID');
  }
  const reads=downloads;
  const replay=await post(emailUrl,emailArgs);check(replay.ok&&(await replay.json()).payload_hash===emailSaved.payload_hash,'Email retry retains maximum payload');
  check(downloads===reads,'Saved maximum package recovery and public retrieval do not reread Storage');
  await native(5);
  const previewArgs={p_pet_id:pet,p_client_id:client,p_channel:'EMAIL',p_recipient:email};
  await denied(()=>rpc('preview_record_release_v9',{...previewArgs,p_selection:{api_attachment_ids:[...approvals],document_ids:[...documents]}},true));
  await denied(()=>rpc('select_all_record_release_sources_v9',{p_pet_id:pet},true));
  await capture(21);
  await denied(()=>rpc('preview_record_release_v9',{...previewArgs,p_selection:{api_attachment_ids:[...approvals],document_ids:documents.slice(0,4)}},true));
  await denied(()=>rpc('select_all_record_release_sources_v9',{p_pet_id:pet},true));
  check((await rpc('read_record_release',{p_id:releases.EMAIL.release.id},true)).eligible,'Unselected extra originals do not invalidate frozen maximum package');
  check(sql('select count(*) from communication_outbox')==='0','Maximum preparation creates no queued messages');
  sql('update record_release_policy set enabled=false;');
  check(failures.length===0,'HTTP fixture had no uncaught errors');
} finally {
  await Promise.all(servers.map(server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));
  checked(await api.auth.signOut());
}
console.log(`Attachment maximum physical packages: ${checks} checks passed. Synthetic upstream only; no ezyVet requests.`);
