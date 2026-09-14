import { same } from "../../../../supabase/functions/ezyvet-attachment-capture/contract.ts";
import { z } from "zod";
import { parseAttachmentReviewHistory } from "./attachment-review-state.ts";
import type { AttachmentFileIntent } from "./attachment-file-state.ts";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const schema=z.object({id:uuid,actor:uuid,pet:uuid,request:uuid,captureHash:hash,previous:uuid.nullable(),title:z.string().trim().min(1).max(200),reason:z.string().trim().min(1).max(2000)}).strict();
export type AttachmentDecision = z.infer<typeof schema>;
export function parseAttachmentDecision(value:unknown,file:AttachmentFileIntent,captureHash:string){const op=schema.parse(value);if(op.actor!==file.actor||op.pet!==file.pet||op.request!==file.id||op.captureHash!==captureHash)throw new Error("Decision identity differs.");return op;}
export function parseAttachmentDecisionOutcome(value:unknown,op:AttachmentDecision,file:AttachmentFileIntent){
 if(value===null)return null;
 const e=z.object({status:z.enum(['approved','canceled']),record:z.unknown(),cancellation:z.unknown()}).strict().parse(value);
 if(e.status==='canceled'){
  const c=z.object({id:uuid,actor_id:uuid,request_id:uuid,pet_id:uuid,capture_hash:hash,created_at:z.string().refine(v=>Number.isFinite(Date.parse(v)))}).strict().parse(e.cancellation);
  if(e.record!==null||c.id!==op.id||c.actor_id!==op.actor||c.request_id!==op.request||c.pet_id!==op.pet||c.capture_hash!==op.captureHash)throw new Error('Cancellation differs.');
  return {status:'canceled' as const,id:c.id,version:null};
 }
 const r=z.record(z.unknown()).parse(e.record),source=z.record(z.unknown()).parse(r.source_context);
 const {attachment_metadata:_metadata,...summary}=source;void _metadata;
 const page=parseAttachmentReviewHistory({request_id:file.id,pet_id:file.pet,animal_link_id:file.parent.animal_link_id,attachment_external_id:file.externalId,latest_record_id:r.id,records:[{...r,source_context:summary}],has_more:false,next_cursor:null},file);
 const saved=page.records[0],c=saved.source_context;
 if(c.run_id!==file.runId||c.page!==file.page||c.attachment_snapshot_id!==file.snapshotId||c.attachment_payload_hash!==file.payloadHash||c.attachment_observed_head_version!==file.headVersion||!same(c.parent,file.parent))throw new Error("Decision source differs from the inspected capture.");
 if(e.cancellation!==null||saved.id!==op.id||saved.actor_id!==op.actor||saved.request_id!==op.request||saved.capture_hash!==op.captureHash||saved.previous_record_id!==op.previous||saved.title!==op.title||saved.review_reason!==op.reason)throw new Error('Saved decision differs.');
 return {status:'approved' as const,id:saved.id,version:saved.version};
}
