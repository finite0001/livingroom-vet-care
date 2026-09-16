import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationWeightApi } from "../../src/hub/features/imports/migration-weight-api.ts";
function fixture(resource = "healthstatus") {
  const actor = randomUUID(), scope = randomUUID(), child = randomUUID(), at = "2026-09-16T04:00:00Z";
  const binding = { id: randomUUID(), scope_id: scope, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Synthetic", created_at: at, context_hash: "a".repeat(64),
    child_context: { version: 1 as const, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "site", resource, parent_evidence: "mapping_identity_only" as const, context: {} } };
  const item = { page: 1, ordinal: 0, observed_head_version: null, snapshot_id: randomUUID(), evidence_hash: "b".repeat(64) };
  const result = { version: 1, binding_id: binding.id, scope_id: scope, child_run_id: child, actor_id: actor, resource, page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash,
    observation_head_available: false, exact_source_version_verified: false, complete_coverage_verified: false, observed_at: at,
    approval: { id: randomUUID(), approved_at: at, action: "link", relationship: "same_snapshot_unknown_observed_head", source_current: true, patient_version_unchanged: false, local_weight_matches_review: true, weight_id: randomUUID(), household_current: true }, source_reviews: [], has_more: false, next_cursor: null };
  return { actor, binding, item, result };
}

test("weight evidence preserves approval separately from source acknowledgments", async () => {
  const f = fixture();
  const api = createMigrationWeightApi({ async rpc(name, args) { assert.equal(name, "read_ezyvet_migration_weight_evidence"); assert.equal(args.p_limit,20); return { data:f.result,error:null }; } },f.actor);
  assert.deepEqual(await api.read(f.binding,f.item),f.result);
});
test("weight evidence rejects foreign identity, fabricated version credit, prose and cursor drift", async () => {
  const f = fixture();
  for (const result of [{...f.result,actor_id:randomUUID()}, {...f.result,snapshot_id:randomUUID()}, {...f.result,resource:"animal"}, {...f.result,exact_source_version_verified:true},
    {...f.result,approval:{...f.result.approval,reason:"Private prose"}}, {...f.result,has_more:true}, {...f.result,next_cursor:{created_at:f.result.observed_at,request_id:randomUUID()}}]) {
    await assert.rejects(()=>createMigrationWeightApi({async rpc(){return {data:result,error:null};}},f.actor).read(f.binding,f.item));
  }
});
test("weight evidence validates before transport and propagates database denial", async () => {
  const f=fixture();let calls=0;const error={code:"42501"};
  const api=createMigrationWeightApi({async rpc(){calls++;return {data:null,error};}},f.actor);
  for(const item of [{...f.item,page:0},{...f.item,ordinal:1},{...f.item,observed_head_version:1}]) await assert.rejects(()=>api.read(f.binding,item));
  assert.equal(calls,0);await assert.rejects(()=>api.read(f.binding,f.item),value=>value===error);
});

test("weight acknowledgment pagination rejects duplicates, reversed order and false relationships", async () => {
  const f=fixture();
  const newer={id:"00000000-0000-4000-8000-000000000002",created_at:f.result.observed_at,snapshot_id:f.item.snapshot_id,head_version:2,relationship:"same_snapshot_unknown_observed_head",source_current:true,promotes_local_weight:false};
  const older={...newer,id:"00000000-0000-4000-8000-000000000001"};
  const read=(rows:unknown[],before=null)=>createMigrationWeightApi({async rpc(){return {data:{...f.result,source_reviews:rows},error:null};}},f.actor).read(f.binding,f.item,before);
  assert.equal((await read([newer,older])).source_reviews.length,2);
  for(const rows of [[older,newer],[newer,newer],[{...newer,relationship:"different_snapshot"}],[{...newer,promotes_local_weight:true}]]) await assert.rejects(()=>read(rows));
  await assert.rejects(()=>read([newer],{created_at:newer.created_at,request_id:newer.id}));
  assert.equal((await read([older],{created_at:newer.created_at,request_id:newer.id})).source_reviews.length,1);
});
