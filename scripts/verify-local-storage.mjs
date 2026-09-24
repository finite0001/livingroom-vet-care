// Creates synthetic immutable records. Run only on a disposable local stack; reset it afterward.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
(async () => {
 assert.equal(process.env.RUN_ISOLATED_STORAGE_TEST, '1', 'Requires RUN_ISOLATED_STORAGE_TEST=1 and an isolated disposable local database.');
 const args = ['status', '--output', 'json'];
 if (process.env.SUPABASE_TEST_WORKDIR) args.push('--workdir', process.env.SUPABASE_TEST_WORKDIR);
 const config = JSON.parse(execFileSync('supabase', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
 assert.equal(new URL(config.API_URL).hostname, '127.0.0.1');
 assert.ok(['54321','56321'].includes(new URL(config.API_URL).port), 'Only known isolated Supabase test ports allowed');
 const opts = { auth: { persistSession: false, autoRefreshToken: false } };
 const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, opts);
 const api = createClient(config.API_URL, config.ANON_KEY, opts);
 const anonymous = createClient(config.API_URL, config.ANON_KEY, opts);
 function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
 const email = `storage-${randomUUID()}@example.test`;
 const password = randomUUID()+randomUUID();
 const user = checked(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
 // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
 // that needs an active synthetic staff member must activate it explicitly.
 // This script has no sql() helper; it reaches Postgres through PostgREST with
 // the service-role client, so activation uses the same mechanism.
 checked(await admin.from('user_roles').insert({user_id:user.id,role:'STAFF'}));
 checked(await admin.from('profiles').update({is_active:true}).eq('id',user.id));
 checked(await api.auth.signInWithPassword({email,password}));
 const client = checked(await api.rpc('save_client',{p_actor_id:user.id,p_client_id:null,p_expected_version:null,p_first_name:'Synthetic Storage',p_last_name:'Roundtrip',p_primary_email:null,p_primary_phone:null,p_preferred_channel:'EMAIL',p_mailing_address:null,p_housecall_address:null}));
 const pet = checked(await api.rpc('save_patient',{p_id:null,p_client_id:client.id,p_expected_version:null,p_name:'Synthetic Storage Patient',p_species:'Dog',p_breed:null,p_dob:null,p_birth_date_precision:'unknown',p_color:null,p_sex:'unknown',p_neuter_status:'unknown',p_microchip_id:null,p_archived_at:null,p_deceased_at:null}));
 const content = Buffer.from('%PDF-1.7\nSynthetic storage verification; no clinical data\n%%EOF');
 const row = checked(await api.rpc('prepare_patient_document',{p_id:randomUUID(),p_pet_id:pet.id,p_encounter_id:null,p_file_name:'synthetic.pdf',p_mime_type:'application/pdf',p_file_size:content.length,p_category:'medical_record',p_source:'Automated isolated local verification',p_document_date:null,p_visibility:'internal'}));
 const storage=api.storage.from('patient-documents');
 checked(await storage.upload(row.file_path,content,{contentType:'application/pdf',upsert:false}));
 const ready=checked(await api.rpc('finalize_patient_document',{p_id:row.id}));
 assert.equal(ready.status,'ready');
 assert.equal(checked(await api.rpc('finalize_patient_document',{p_id:row.id})).version,ready.version);
 const signed=checked(await storage.createSignedUrl(row.file_path,60,{download:'synthetic.pdf'}));
 const download=await fetch(signed.signedUrl); assert.equal(download.status,200); assert.deepEqual(Buffer.from(await download.arrayBuffer()),content);
 assert.ok((await anonymous.storage.from('patient-documents').download(row.file_path)).error,'anonymous private read denied');
 const publicFetch=await fetch(`${config.API_URL}/storage/v1/object/public/patient-documents/${row.file_path}`); assert.equal(publicFetch.ok,false);
 assert.ok((await storage.upload(row.file_path,content,{contentType:'application/pdf',upsert:true})).error,'ready object overwrite denied');
 const removal=await storage.remove([row.file_path]); if (!removal.error) assert.deepEqual(removal.data,[]);
 assert.deepEqual(Buffer.from(await checked(await storage.download(row.file_path)).arrayBuffer()),content,'ready original retained');
 checked(await api.rpc('void_patient_document',{p_id:row.id,p_expected_version:ready.version,p_reason:'Synthetic verification complete'}));
 const voidRemoval=await storage.remove([row.file_path]); if (!voidRemoval.error) assert.deepEqual(voidRemoval.data,[]);
 assert.deepEqual(Buffer.from(await checked(await storage.download(row.file_path)).arrayBuffer()),content,'void original retained');
 console.log('PASS: real local Auth/PostgREST/Storage roundtrip, idempotent finalize, exact-byte signed download, anonymous/public denial, immutable ready/void originals. Synthetic fixtures require isolated reset.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
