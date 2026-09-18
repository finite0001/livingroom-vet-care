import { z } from "zod";
import type { PrescriptionRpc } from "../prescriptions/prescription-api.ts";
import {
  estimateDecisionBindingSchema,
  estimateDecisionHeadSchema,
  estimateDecisionTargetSchema,
  estimatePublicDecisionSchema,
  estimateWitnessedDecisionRequestSchema,
  sameEstimateDecisionEvidence as equal,
} from "../../../../supabase/functions/_shared/estimate-decision-contract.ts";

const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
const provenance = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grant"), grant_id: uuid }).strict(),
  z.object({
    kind: z.literal("staff_witness"), actor_id: uuid,
    witness: estimateWitnessedDecisionRequestSchema.shape.witness,
  }).strict(),
]);
export const staffEstimateDecisionSchema = estimatePublicDecisionSchema
  .omit({ attribution: true })
  .extend({
    provenance,
    publication_head: estimateDecisionHeadSchema,
    decision_head: estimateDecisionHeadSchema,
  }).strict().refine((value) => value.decision_head.version === value.sequence - 1 && value.publication_head.version > 0);
export const staffEstimateDecisionStateSchema = z.object({
  version: z.literal(1), target: estimateDecisionTargetSchema,
  publication_head: estimateDecisionHeadSchema,
  decision_head: estimateDecisionHeadSchema,
  current_publication_id: uuid.nullable(),
  current_decision: staffEstimateDecisionSchema.nullable(),
}).strict().superRefine((value, context) => {
  const decision = value.current_decision;
  if (decision && (!equal(decision.binding.target, value.target) ||
      decision.binding.publication_id !== value.current_publication_id ||
      decision.sequence > value.decision_head.version ||
      (decision.sequence === value.decision_head.version &&
        (decision.id !== value.decision_head.event_id || decision.record_hash !== value.decision_head.record_hash)))) {
    context.addIssue({ code: "custom", message: "Current decision differs from its estimate state." });
  }
});
const pageSchema = z.object({
  version: z.literal(1), target: estimateDecisionTargetSchema,
  head: estimateDecisionHeadSchema,
  items: z.array(staffEstimateDecisionSchema).max(50),
  next_before_sequence: z.number().int().positive().nullable(),
  has_more: z.boolean(),
}).strict();
const previewSchema = z.object({
  version: z.literal(1), binding: estimateDecisionBindingSchema,
  publication_head: estimateDecisionHeadSchema,
  expires_at: z.string().datetime(), decision: z.null(),
}).strict();
export interface StaffEstimateDecision extends z.infer<typeof staffEstimateDecisionSchema> {}
export interface StaffEstimateDecisionState extends z.infer<typeof staffEstimateDecisionStateSchema> {}
export interface StaffEstimateDecisionPage extends z.infer<typeof pageSchema> {}
export interface StaffEstimateDecisionTarget extends z.infer<typeof estimateDecisionTargetSchema> {}

/** Authenticated RPC reads; server rechecks current staff membership under its locks. */
export function createEstimateDecisionStaffReads(db: PrescriptionRpc, targetInput: StaffEstimateDecisionTarget) {
  const target = estimateDecisionTargetSchema.parse(targetInput);
  function requireMatch(condition: unknown): asserts condition {
    if (!condition) throw new Error("Estimate decision evidence does not match this patient and household.");
  }
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }
  return {
    async state() {
      const result = staffEstimateDecisionStateSchema.parse(await call("read_native_estimate_decision_state", {
        p_estimate_id: target.estimate_id, p_client_id: target.client_id,
      }));
      requireMatch(equal(result.target, target));
      return result;
    },
    async history(before: number | null = null, limit = 20) {
      z.number().int().positive().nullable().parse(before);
      z.number().int().min(1).max(50).parse(limit);
      const result = pageSchema.parse(await call("read_native_estimate_decisions", {
        p_estimate_id: target.estimate_id, p_client_id: target.client_id,
        p_before_sequence: before, p_limit: limit,
      }));
      requireMatch(equal(result.target, target) && result.items.length <= limit);
      let prior = before ?? result.head.version + 1;
      for (const item of result.items) {
        requireMatch(equal(item.binding.target, target) && item.sequence < prior && item.sequence <= result.head.version);
        if (item.sequence === result.head.version) requireMatch(item.id === result.head.event_id && item.record_hash === result.head.record_hash);
        prior = item.sequence;
      }
      requireMatch(result.has_more
        ? result.items.length === limit && result.next_before_sequence === result.items[result.items.length - 1]?.sequence
        : result.next_before_sequence === null);
      return result;
    },
    async preview(publicationId: string) {
      uuid.parse(publicationId);
      const result = previewSchema.parse(await call("preview_native_estimate_decision_grant", {
        p_publication_id: publicationId, p_client_id: target.client_id,
      }));
      requireMatch(equal(result.binding.target, target) && result.binding.publication_id === publicationId && result.publication_head.version > 0);
      return result;
    },
  };
}

const witnessOperationSchema=z.object({id:uuid,kind:z.literal('record_witnessed_estimate_decision'),payload:estimateWitnessedDecisionRequestSchema}).strict();
const principal=z.object({kind:z.literal('staff'),id:uuid}).strict();
const mutation=z.object({kind:z.literal('witnessed_decision'),request:estimateWitnessedDecisionRequestSchema}).strict();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.string().datetime().refine(v=>Number.isFinite(Date.parse(v))&&!/\.\d{7}/.test(v));
const witnessReceiptSchema=z.object({version:z.literal(1),id:uuid,principal,mutation,request_hash:hash,result:staffEstimateDecisionSchema,created_at:instant}).strict();
const witnessClosureSchema=z.object({version:z.literal(1),id:uuid,principal,mutation,request_hash:hash,closed_by:principal,reason:z.null(),closed_at:instant,record_hash:hash}).strict();
export interface EstimateWitnessOperation {id:string;kind:"record_witnessed_estimate_decision";payload:z.infer<typeof estimateWitnessedDecisionRequestSchema>}
export interface EstimateWitnessReceipt extends z.infer<typeof witnessReceiptSchema> {}
export function createEstimateDecisionStaffApi(db:PrescriptionRpc,actorId:string,targetInput:StaffEstimateDecisionTarget){
  uuid.parse(actorId);const target=estimateDecisionTargetSchema.parse(targetInput);
  function require(condition:unknown):asserts condition{if(!condition)throw new Error('Witnessed decision evidence differs from the original staff request.');}
  const parseOperation=(value:unknown):EstimateWitnessOperation=>{const op=witnessOperationSchema.parse(value);require(equal(op.payload.decision.binding.target,target));return op as EstimateWitnessOperation;};
  function receipt(value:unknown,op:EstimateWitnessOperation){
    const r=witnessReceiptSchema.parse(value),q=op.payload.decision;
    require(r.id===op.id&&r.principal.id===actorId&&equal(r.mutation.request,op.payload)&&r.result.id===op.id&&r.created_at===r.result.recorded_at&&r.result.provenance.kind==='staff_witness');
    require(r.result.provenance.actor_id===actorId&&equal(r.result.provenance.witness,op.payload.witness)&&equal(r.result.binding,q.binding)&&equal(r.result.publication_head,q.expected_publication_head));
    for(const key of ['choice','signer_name','signer_relationship','comment','acknowledgment_version'] as const)require(r.result[key]===q[key]);
    const micros=(v:string)=>BigInt(Date.parse(v.replace(/\.\d+(?=Z$)/,'')))*1000n+BigInt((/\.(\d+)Z$/.exec(v)?.[1]??'').padEnd(6,'0'));
    require(micros(op.payload.witness.occurred_at)<=micros(r.created_at));return r;
  }
  async function call(name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
  return {...createEstimateDecisionStaffReads(db,target),parseOperation,
    async execute(input:unknown){const op=parseOperation(input);return receipt(await call('record_native_estimate_witnessed_decision',{p_id:op.id,p_request:op.payload}),op);},
    async recover(input:unknown){const op=parseOperation(input);const r=await call('recover_native_estimate_witnessed_decision',{p_id:op.id});return r===null?null:receipt(r,op);},
    async close(input:unknown){const op=parseOperation(input);const r=z.discriminatedUnion('status',[z.object({version:z.literal(1),status:z.literal('recorded'),receipt:witnessReceiptSchema}).strict(),z.object({version:z.literal(1),status:z.literal('closed_unrecorded'),closure:witnessClosureSchema}).strict()]).parse(await call('close_native_estimate_witnessed_decision',{p_id:op.id,p_request:op.payload}));
      if(r.status==='recorded')return {version:1 as const,status:'recorded' as const,receipt:receipt(r.receipt,op)};
      require(r.closure.id===op.id&&r.closure.principal.id===actorId&&r.closure.closed_by.id===actorId&&equal(r.closure.mutation.request,op.payload));return {version:1 as const,status:'closed_unrecorded' as const,closure:r.closure};
    },
  };
}
