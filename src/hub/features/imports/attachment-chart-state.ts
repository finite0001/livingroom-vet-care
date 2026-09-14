import { z } from "zod";
import { parseAttachmentReviewHistory } from "./attachment-review-state.ts";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),date=z.string().refine(v=>Number.isFinite(Date.parse(v)));
function chartRecord(value:unknown,pet:string){
 const r=z.record(z.unknown()).parse(value),c=z.record(z.unknown()).parse(r.source_context),parent=z.record(z.unknown()).parse(c.parent);
 return parseAttachmentReviewHistory({request_id:r.request_id,pet_id:pet,animal_link_id:r.animal_link_id,attachment_external_id:r.attachment_external_id,latest_record_id:r.id,records:[r],has_more:false,next_cursor:null},{id:uuid.parse(r.request_id),pet,externalId:z.string().parse(r.attachment_external_id),parent:parent as Parameters<typeof parseAttachmentReviewHistory>[1]['parent']}).records[0];
}
export function parseAttachmentChart(value:unknown,pet:string){
 const p=z.object({pet_id:uuid,records:z.array(z.object({record:z.unknown(),is_latest:z.boolean(),source_current:z.boolean()}).strict()).max(20),has_more:z.boolean(),next_cursor:z.object({before_at:date,before_id:uuid}).strict().nullable()}).strict().parse(value);
 if(p.pet_id!==pet)throw new Error('Chart belongs to another patient.');
 const ids=new Set<string>(),records=p.records.map(row=>{const record=chartRecord(row.record,pet);if(ids.has(record.id))throw new Error('Duplicate chart record.');ids.add(record.id);return {...row,record};});
 if(p.has_more!==(p.next_cursor!==null))throw new Error('Chart cursor differs.');
 if(p.next_cursor){const last=records.at(-1)?.record;if(!last||last.id!==p.next_cursor.before_id||last.created_at!==p.next_cursor.before_at)throw new Error('Chart cursor differs.');}
 return {...p,records,next_cursor:p.next_cursor?{before_at:p.next_cursor.before_at!,before_id:p.next_cursor.before_id!}:null};
}
export function parseAttachmentChartOriginal(value:unknown,pet:string,id:string,captureHash:string){
 const e=z.object({record:z.unknown(),capture:z.unknown()}).strict().parse(value),r=chartRecord(e.record,pet);
 const c=z.object({request_id:uuid,actor_id:uuid,pet_id:uuid,intent_hash:hash,capture_hash:hash,storage_object_id:uuid,bucket:z.literal('ezyvet-attachments'),object_path:z.string(),content_sha256:hash,file_size:z.number().int().min(1).max(20971520),mime_type:z.enum(['application/pdf','image/jpeg','image/png']),captured_at:date}).strict().parse(e.capture);
 const prefix=`${c.actor_id}/${pet}/${c.request_id}/`,rest=c.object_path.slice(prefix.length).split('/');
 if(r.id!==id||r.capture_hash!==captureHash||c.capture_hash!==captureHash||c.request_id!==r.request_id||c.actor_id!==r.actor_id||c.pet_id!==pet||!c.object_path.startsWith(prefix)||rest.length!==2||!z.string().uuid().safeParse(rest[0]).success||rest[1]!=='original')throw new Error('Chart original differs from the reviewed capture.');
 return {record:r,capture:c};
}
