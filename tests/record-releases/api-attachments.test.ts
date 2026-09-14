import test from 'node:test';
import assert from 'node:assert/strict';
import { apiAttachmentArtifact, apiOriginalBytes } from './api-attachment-fixture.ts';
import { renderRecordRelease, type ReleaseBundle } from '../../supabase/functions/_shared/record-release-renderer.ts';
import { buildReleaseEmailPayload } from '../../supabase/functions/_shared/release-email-payload.ts';
import { buildDocumentLinkArtifacts } from '../../supabase/functions/_shared/document-link-artifacts.ts';

test('schema9 renders API provenance alongside older lab and manual-export originals',()=>{
 const a=apiAttachmentArtifact();a.preview.snapshot.api_attachments![0].record.title='<script>source</script>';
 const html=renderRecordRelease(a);assert.match(html,/Selected ezyVet API originals/);assert.match(html,/Selected laboratory report provenance/);assert.match(html,/Selected external medical originals/);assert.match(html,/&lt;script&gt;source&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,new RegExp(a.preview.snapshot.api_attachments![0].capture.object_path));
});
const invalid:{[name:string]:(a:ReturnType<typeof apiAttachmentArtifact>)=>void}={
 'missing source':a=>{a.preview.snapshot.api_attachments=[];},
 'unselected source':a=>{a.preview.snapshot.selection!.api_attachment_ids=[];},
 'duplicate source':a=>{a.preview.snapshot.api_attachments!.push(a.preview.snapshot.api_attachments![0]);},
 'wrong patient':a=>{a.preview.snapshot.api_attachments![0].record.pet_id='d9000000-0000-4000-8000-999999999999';},
 'wrong parent':a=>{a.preview.snapshot.api_attachments![0].record.source_context.parent.pet_id='d9000000-0000-4000-8000-999999999999';},
 'capture owner':a=>{a.preview.snapshot.api_attachments![0].capture.actor_id='d9000000-0000-4000-8000-999999999999';},
 'capture digest':a=>{a.preview.snapshot.api_attachments![0].capture.content_sha256='0'.repeat(64);},
 'wrong approval reference':a=>{a.preview.snapshot.attachments.at(-1)!.api_attachment_ref!.record_hash='0'.repeat(64);},
 'missing original':a=>{a.preview.snapshot.attachments.pop();},
 'ordinary downgrade':a=>{a.preview.snapshot.attachments.at(-1)!.bucket='patient-documents';},
 'path traversal':a=>{a.preview.snapshot.api_attachments![0].capture.object_path+='/../original';},
 'wrong version':a=>{a.preview.snapshot.attachments.at(-1)!.version=2;},
 'schema downgrade':a=>{a.preview.snapshot.schema_version=8;},
 'hidden provider metadata':a=>{Object.assign(a.preview.snapshot.api_attachments![0].record.source_context,{attachment_metadata:{file_download_url:'https://example.test/private'}});},
};
for(const [name,mutate] of Object.entries(invalid))test(`schema9 rejects ${name}`,()=>{const a=apiAttachmentArtifact();mutate(a);assert.throws(()=>renderRecordRelease(a),/schema9 API attachment/);});
function bundle(channel:'EMAIL'|'SMS'):ReleaseBundle{const a=apiAttachmentArtifact();return{release:{...a.preview,id:'d9000000-0000-4000-8000-000000009000',pet_id:a.preview.snapshot.patient.id,client_id:a.preview.snapshot.recipient.client_id,channel,recipient:channel==='EMAIL'?'owner@example.test':'+13035550123',selection:a.preview.snapshot.selection!,created_by:'d9000000-0000-4000-8000-000000009001',created_at:'2026-09-13T12:00:00Z'},events:[],eligible:true,ineligibility_reason:null};}
for(const channel of ['EMAIL','SMS'] as const)test(`schema9 ${channel} freezes mixed originals and rejects changed API bytes`,async()=>{
 const b=bundle(channel),calls:string[]=[];
 const build=(bad=false)=>{const download=async(bucket:string)=>{calls.push(bucket);const changed=apiOriginalBytes.slice();changed[changed.length-1]^=1;return bad&&bucket==='ezyvet-attachments'?changed:apiOriginalBytes;};
 return channel==='EMAIL'?buildReleaseEmailPayload({id:'request',release_id:b.release.id,actor_id:b.release.created_by,recipient:b.release.recipient,subject:'Records',body:'Reviewed originals',release_hash:b.release.source_hash},b,{from:'care@example.test',replyTo:'care@example.test'},download):buildDocumentLinkArtifacts({id:'grant',family:'record_release',source_id:b.release.id,client_id:b.release.client_id,actor_id:b.release.created_by,recipient:b.release.recipient,source_hash:b.release.source_hash,source_bundle:b,created_at:b.release.created_at,expires_at:'2026-09-14T00:00:00Z',origin:'https://example.test',key_version:'test',capability_context:'synthetic',message_template:'Review records',state:'preparing'},{name:'Synthetic',address:'Synthetic',domain:null},download);};
 await build();assert.ok(calls.includes('patient-documents'));assert.ok(calls.includes('ezyvet-attachments'));await assert.rejects(build(true),/bytes.*(capture|provenance)|original.*capture/i);
});
