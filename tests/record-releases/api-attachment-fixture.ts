import { createHash } from 'node:crypto';
import { sourceProvenanceArtifact, sourceOriginalBytes } from './source-provenance-fixture.ts';
import { releaseApiAttachmentDocument, type ReleaseApiAttachment } from '../../supabase/functions/_shared/record-release-api-attachments.ts';
export { sourceOriginalBytes as apiOriginalBytes };
const id=(n:number)=>`d9000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function apiAttachmentArtifact(){
 const artifact=sourceProvenanceArtifact(),s=artifact.preview.snapshot,h='a'.repeat(64),at='2026-09-13T12:00:00Z';
 s.schema_version=9;s.patient.id=id(1);s.recipient.client_id=id(2);
 s.imported_histories=[];s.problem_source_extractions=[];s.imported_vaccinations=[];s.imported_prescriptions=[];
 const parent={animal_link_id:id(3),pet_id:id(1),client_id:id(2),animal_external_id:'77',source_origin:'https://api.trial.ezyvet.com',source_site_uid:'synthetic-site',parent_type:'Animal' as const,parent_external_id:'77',parent_snapshot_id:id(4),parent_payload_hash:h,parent_observed_head_version:1};
 const source:ReleaseApiAttachment={record:{id:id(5),actor_id:id(6),request_id:id(7),pet_id:id(1),animal_link_id:id(3),source_origin:parent.source_origin,source_site_uid:parent.source_site_uid,attachment_external_id:'701',request_hash:h,capture_hash:h,record_hash:h,title:'Reviewed API source',review_reason:'Reviewed exact patient and original',previous_record_id:null,version:1,entry_method:'staff_reviewed_api_attachment_v1',created_at:at,source_context:{schema_version:1,run_id:id(8),page:1,parent,attachment_snapshot_id:id(9),attachment_external_id:'701',attachment_payload_hash:h,attachment_observed_head_version:1}},capture:{request_id:id(7),actor_id:id(6),pet_id:id(1),intent_hash:h,capture_hash:h,storage_object_id:id(10),bucket:'ezyvet-attachments',object_path:`${id(6)}/${id(1)}/${id(7)}/${id(11)}/original`,content_sha256:createHash('sha256').update(sourceOriginalBytes).digest('hex'),file_size:sourceOriginalBytes.length,mime_type:'application/pdf',captured_at:at}};
 s.selection={...s.selection,imported_vaccination_ids:[],imported_prescription_ids:[],api_attachment_ids:[source.record.id]};s.api_attachments=[source];s.attachments.push(releaseApiAttachmentDocument(source));
 return artifact;
}
