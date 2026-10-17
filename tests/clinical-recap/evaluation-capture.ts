/** Actual local Auth/native-RPC source creation and frozen adapter capture. No provider calls. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  recapJobReadSchema, recapPreviewSchema, recapPolicyReceiptSchema,
  validateRecapPayload, type recapSourceSchema,
} from "../../supabase/functions/_shared/clinical-recap-model.ts";
import { veterinaryAmbiguityFlag } from "../../supabase/functions/_shared/clinical-veterinary-context.ts";
import {
  EVALUATION_CASES, EVALUATION_NAMESPACE, FIXTURE_REVISION, SEMANTIC_NEGATIVE_CONTROLS,
  type EvaluationFixture, type Support,
} from "./evaluation-corpus.ts";

const environment = z.object({
  RECAP_EVALUATION_PROJECT: z.string().min(1),
  RECAP_RUN_SYNTHETIC_LOCAL: z.literal("true"),
}).parse(process.env);
const root = fileURLToPath(new URL("../../", import.meta.url));
const project = realpathSync(environment.RECAP_EVALUATION_PROJECT);
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(/^project_id = "(lrv-recap-eval-[a-f0-9]+)"/m)?.[1];
assert.ok(identity, "Dedicated synthetic evaluation runtime required.");
const container = "supabase_db_" + identity;
function command(program: string, args: string[], input?: string) {
  try {
    return execFileSync(program, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 60000 }).trim();
  } catch {
    throw Error("Owned local evaluation command failed; private command output withheld.");
  }
}
const labels = JSON.parse(command("docker", ["inspect", container]))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(realpathSync(labels["com.supabase.cli.workdir"]), project);
const status = parseOwnedRuntimeStatus(command("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"]));
assert.equal(status.API_URL, "http://127.0.0.1:65321");
const localFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, status.API_URL, "Capture may contact only its owned local API.");
  return fetch(input, init);
};
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const uuid = z.string().uuid();
const rowSchema = z.object({ id: uuid }).passthrough();
const versionedRowSchema = rowSchema.extend({ version: z.number().int().positive() });
const runId = randomUUID();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function namespacedId(name: string) {
  const bytes = createHash("sha1").update(Buffer.from(EVALUATION_NAMESPACE.replaceAll("-", ""), "hex")).update(runId + ":" + name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
function sql(query: string) {
  return command("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], query);
}
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    mkdirSync(root + "tmp", { recursive: true, mode: 0o700 });
    writeFileSync(root + "tmp/clinical-recap-evaluation-local-failure.json", JSON.stringify({ rpc: name, code: error.code, details: error.details, message: error.message }, null, 2), { mode: 0o600 });
    throw Error("Synthetic local RPC failed: " + name + "; see private failure receipt.");
  }
  return data;
}
const canonicalSnapshot = () => JSON.parse(sql(`
create temp table recap_evaluation_canonical(name text,value jsonb);
do $$declare r record;v jsonb;begin
 for r in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p')and c.relname not like'clinical_recap_%'order by c.relname loop
  execute format('select jsonb_build_object(''count'',count(*),''sha256'',encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8''),''sha256''),''hex''))from public.%I t',r.relname)into v;
  insert into recap_evaluation_canonical values(r.relname,v);
 end loop;
end $$;
select jsonb_object_agg(name,value)from recap_evaluation_canonical;
`));
interface SourceAlias {
  id: string;
  source_ref: string | null;
  kind: z.infer<typeof recapSourceSchema>["kind"];
  version: number | null;
  excluded: boolean;
}
interface PreparedCase {
  fixture: EvaluationFixture;
  pet_id: string;
  encounter_ids: string[];
  aliases: Record<string, SourceAlias>;
  creation_receipts: Record<string, unknown>;
}
interface CapturedCase {
  id: EvaluationFixture["id"];
  title: string;
  context: z.infer<typeof recapJobReadSchema>;
  expected_facts: EvaluationFixture["expected_facts"];
  source_aliases: Record<string, SourceAlias>;
  creation_receipts: Record<string, unknown>;
  structural_probe: unknown;
  structural_probe_scope: string;
  scaffold_notes: string[];
  deterministic_vocabulary_warning: string | null;
}
const email = "synthetic-recap-evaluation-" + runId + "@example.test";
const password = randomUUID() + randomUUID();
const requestedAuthor = namespacedId("author");
const created = await service.auth.admin.createUser({ id: requestedAuthor, email, password, email_confirm: true });
if (created.error) throw Error("Synthetic local author creation failed.");
const actor = uuid.parse(created.data.user?.id);
assert.equal(actor, requestedAuthor);
sql(`update profiles set is_active=true,full_name='SYNTHETIC RECAP AUTHOR'where id='${actor}';insert into user_roles(user_id,role)values('${actor}','ADMIN')on conflict do nothing;`);
const staff = createClient(status.API_URL, status.ANON_KEY, options);
const signedIn = await staff.auth.signInWithPassword({ email, password });
if (signedIn.error || !signedIn.data.session) throw Error("Synthetic local author authentication failed.");
assert.equal(signedIn.data.user?.id, actor);
const policy = recapPolicyReceiptSchema.parse(await rpc(staff, "save_clinical_recap_policy", {
  p_actor_id: actor, p_id: namespacedId("policy"), p_request: {
    expected_version: 1, status: "approved", consent_text: "SYNTHETIC LOCAL EVALUATION ONLY. Eight wholly fictional records captured for model/provenance evaluation. This is not practice clinical activation.",
    retention_text: "SYNTHETIC LOCAL EVALUATION ONLY. Export frozen fictional manifests privately; destroy this uniquely owned local runtime after capture. No real patient processing.", attest_reviewed: true,
  },
})).policy;
assert.equal(policy.status, "approved");
const client = rowSchema.parse(await rpc(staff, "save_client", {
  p_actor_id: actor, p_client_id: null, p_expected_version: null, p_first_name: "SYNTHETIC", p_last_name: "RECAP EVALUATION",
  p_primary_phone: "+13035550188", p_primary_email: "synthetic-recap-evaluation@example.test", p_preferred_channel: "EMAIL", p_housecall_address: null, p_mailing_address: null,
})).id;
const prepared: PreparedCase[] = [];
for (const fixture of EVALUATION_CASES) {
  const patientArgs = { p_id: null as string | null, p_client_id: client, p_expected_version: null as number | null, p_name: "SYNTHETIC RECAP " + fixture.id, p_species: "Dog", p_breed: null, p_dob: null,
    p_birth_date_precision: "unknown", p_color: "", p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null,
    p_archived_at: null as string | null, p_deceased_at: null as string | null };
  let patient = versionedRowSchema.parse(await rpc(staff, "save_patient", patientArgs));
  const aliases: Record<string, SourceAlias> = {}, creation_receipts: Record<string, unknown> = { patient_created: patient };
  const encounterIds: string[] = [];
  for (const encounter of fixture.encounters) {
    const draft = versionedRowSchema.parse(await rpc(staff, "save_clinical_encounter", {
      p_id: null, p_pet_id: patient.id, p_expected_version: null, p_visit_at: encounter.visit_at, p_visit_type: "clinic", p_location: "SYNTHETIC EVALUATION ONLY",
      p_subjective: encounter.subjective, p_objective: encounter.objective, p_assessment: encounter.assessment, p_plan: encounter.plan,
    }));
    const signed = versionedRowSchema.parse(await rpc(staff, "sign_clinical_encounter", { p_id: draft.id, p_expected_version: draft.version }));
    assert.equal(signed.status, "signed");
    assert.equal(signed.pet_id, patient.id);
    assert.equal(signed.subjective, encounter.subjective);
    assert.equal(signed.objective, encounter.objective);
    assert.equal(signed.assessment, encounter.assessment);
    assert.equal(signed.plan, encounter.plan);
    encounterIds.push(signed.id);
    aliases[encounter.alias] = { id: signed.id, source_ref: null, kind: "signed_encounter", version: signed.version, excluded: false };
    creation_receipts[encounter.alias] = signed;
    for (const addendum of encounter.addenda ?? []) {
      const saved = rowSchema.parse(await rpc(staff, "add_clinical_addendum", { p_encounter_id: signed.id, p_content: addendum.content }));
      assert.equal(saved.content, addendum.content);
      assert.equal(saved.encounter_id, signed.id);
      assert.ok(Date.parse(String(saved.created_at)) >= Date.parse(String(signed.signed_at)));
      aliases[addendum.alias] = { id: saved.id, source_ref: null, kind: "addendum", version: null, excluded: false };
      creation_receipts[addendum.alias] = saved;
    }
  }
  for (const problem of fixture.problems) {
    const saved = versionedRowSchema.parse(await rpc(staff, "save_patient_problem", {
      p_id: null, p_pet_id: patient.id, p_expected_version: null, p_title: problem.title, p_notes: problem.notes, p_onset_date: problem.onset_date,
      p_status: problem.status, p_importance: problem.importance,
    }));
    aliases[problem.alias] = { id: saved.id, source_ref: null, kind: "native_problem", version: saved.version, excluded: !!problem.outside_linked };
    creation_receipts[problem.alias] = saved;
    if (problem.outside_linked) {
      const linkId = namespacedId(fixture.id + ":outside-provenance");
      // Owner-only fictional retained-import provenance fixture, not an external import/API operation.
      // Actual clinical problem creation above uses the native authorized staff RPC.
      sql(`insert into ezyvet_history_requests(id,actor_id,pet_id,kind,status,payload,request_hash,review_context)values('${linkId}','${actor}','${patient.id}','problem_extraction','prepared','{}',public.clinical_recap_hash('{}'::jsonb),'{}');
insert into ezyvet_problem_extractions(id,pet_id,problem_id,action,problem_version,problem_fields,extracted_by)select '${linkId}',p.pet_id,p.id,'link',p.version,public.ezyvet_problem_fields(p),'${actor}'from patient_problems p where p.id='${saved.id}';`);
      creation_receipts[problem.alias + ":outside_link"] = { id: linkId, method: "owner-only fictional retained-import provenance fixture; no external provider or reviewed-import activation" };
    }
  }
  if (fixture.lifecycle) {
    // Every historical encounter is already signed while active. Never bypass the active-patient guard.
    assert.ok(encounterIds.length > 0);
    patient = versionedRowSchema.parse(await rpc(staff, "save_patient", { ...patientArgs, p_id: patient.id, p_expected_version: patient.version, p_archived_at: fixture.lifecycle.archived_at, p_deceased_at: fixture.lifecycle.deceased_at }));
    creation_receipts.patient_lifecycle_updated_after_signing = patient;
  }
  prepared.push({ fixture, pet_id: patient.id, encounter_ids: encounterIds.sort(), aliases, creation_receipts });
}
const before = canonicalSnapshot();
const cases: CapturedCase[] = [];
let structuralChecks = 0;
function payloadFor(context: z.infer<typeof recapJobReadSchema>, aliases: Record<string, SourceAlias>, text: string, support: Support, temporal = "historical") {
  const alias = aliases[support.source_alias];
  assert.ok(alias && !alias.excluded && alias.source_ref);
  const payload = { claims: [{ claim_id: "claim_001", category: "history", temporal_status: temporal, text, uncertainty: "", citations: [{ source_ref: alias.source_ref, field_path: support.field_path, quote: support.quote }] }], review_flags: [] };
  validateRecapPayload(payload, context.manifest);
  structuralChecks++;
  return payload;
}
for (const item of prepared) {
  const { fixture } = item;
  const selection = { encounter_ids: item.encounter_ids, include_native_problems: fixture.include_native_problems, visit_from: fixture.visit_from, visit_to: fixture.visit_to };
  const preview = recapPreviewSchema.parse(await rpc(staff, "preview_clinical_recap", { p_actor_id: actor, p_pet_id: item.pet_id, p_selection: selection }));
  const jobId = namespacedId(fixture.id + ":reservation");
  const reserved = recapJobReadSchema.parse(await rpc(staff, "reserve_clinical_recap", { p_actor_id: actor, p_id: jobId, p_request: {
    pet_id: item.pet_id, expected_pet_version: preview.source_set.patient.version, policy_version: policy.version, selection,
    expected_source_fingerprint: preview.source_fingerprint, source_note: "SYNTHETIC EVALUATION " + fixture.id + ": fixed fictional source fidelity screen; no clinical use.", attest_authorized: true, previous_job_id: null,
  } }));
  const context = recapJobReadSchema.parse(await rpc(staff, "read_clinical_recap_job", { p_actor_id: actor, p_id: jobId }));
  assert.deepEqual(context, reserved);
  assert.equal(context.job.actor_id, actor);
  assert.equal(context.job.pet_id, item.pet_id);
  assert.equal(context.current.source_status, "current");
  assert.equal(context.output, null);
  assert.equal(context.review, null);
  assert.equal(context.job.attempts.length, 0);
  assert.equal(context.manifest.source_fingerprint, preview.source_fingerprint);
  assert.deepEqual(context.manifest.source_set, preview.source_set);
  for (const alias of Object.values(item.aliases)) {
    const source = context.manifest.source_set.sources.find((value) => value.id === alias.id);
    if (alias.excluded) assert.equal(source, undefined);
    else {
      assert.ok(source);
      assert.equal(source.kind, alias.kind);
      assert.equal(source.version, alias.version);
      alias.source_ref = source.ref;
    }
  }
  const included = Object.values(item.aliases).filter((a) => !a.excluded);
  assert.equal(context.manifest.source_set.sources.length, included.length);
  for (const fact of fixture.expected_facts.required) for (const evidence of fact.support) {
    const alias = item.aliases[evidence.source_alias];
    const source = context.manifest.source_set.sources.find((value) => value.ref === alias?.source_ref);
    assert.ok(source && !alias.excluded, "Inventory evidence must belong to the actual frozen source set.");
    const field = (source.fields as Record<string, unknown>)[evidence.field_path.slice(7)];
    assert.ok(typeof field === "string" && field.includes(evidence.quote));
    structuralChecks++;
  }
  const structuralProbe = payloadFor(context, item.aliases, fixture.structural_probe.text, fixture.structural_probe.support, fixture.structural_probe.temporal_status);
  assert.throws(() => validateRecapPayload({ ...structuralProbe, claims: [{ ...structuralProbe.claims[0], citations: [{ ...structuralProbe.claims[0].citations[0], quote: "SYNTHETIC INVENTED QUOTE NOT IN ANY SOURCE" }] }] }, context.manifest));
  structuralChecks++;
  assert.throws(() => validateRecapPayload({ ...structuralProbe, claims: [{ ...structuralProbe.claims[0], citations: [{ ...structuralProbe.claims[0].citations[0], source_ref: "src_0064" }] }] }, context.manifest));
  structuralChecks++;
  if (fixture.id === "B") {
    const addendum = context.manifest.source_set.sources.find((s) => s.id === item.aliases["A-B1"].id);
    assert.ok(addendum?.kind === "addendum");
    assert.ok(addendum.metadata.created_at.slice(0, 10) > "2024-06-01");
    assert.equal(context.manifest.source_set.membership.addenda_by_encounter[0].source_ids.length, 1);
    assert.equal(addendum.version, null);
  }
  if (fixture.id === "H") {
    const patient = context.manifest.source_set.patient;
    assert.equal(patient.dob, null);
    assert.equal(patient.birth_date_precision, "unknown");
    assert.equal(patient.deceased_at, "2025-09-01");
    assert.equal(patient.archived_at, "2025-09-02T12:00:00.000000Z");
    assert.equal(context.manifest.source_set.exclusions.outside_linked_problem_count, 1);
    assert.deepEqual(context.manifest.source_set.membership.native_problem_ids, []);
  }
  const clinicalText = context.manifest.source_set.sources.flatMap((source) => Object.values(source.fields).filter((value): value is string => typeof value === "string")).join("\n");
  const vocabularyWarning = veterinaryAmbiguityFlag(clinicalText);
  if (fixture.id === "D" || fixture.id === "F") assert.ok(vocabularyWarning, "Fixed ambiguity warning must be present.");
  cases.push({ id: fixture.id, title: fixture.title, context, expected_facts: fixture.expected_facts, source_aliases: item.aliases, creation_receipts: item.creation_receipts, structural_probe: structuralProbe, structural_probe_scope: "Incomplete transport/citation probe only; not model output, fidelity adjudication or mandatory-fact coverage.", scaffold_notes: fixture.scaffold_notes ?? [], deterministic_vocabulary_warning: vocabularyWarning });
}
const negativeControls = SEMANTIC_NEGATIVE_CONTROLS.map((control) => {
  const item = cases.find((c) => c.id === control.case_id)!;
  const payload = payloadFor(item.context, item.source_aliases, control.text, control.support);
  return { ...control, payload, structural_result: "pass", semantic_adjudication: { expected: "fail", severity: "critical", rationale: control.reason }, note: "Deliberately false but source-cited. Validator pass is not a fidelity pass." };
});
const after = canonicalSnapshot();
assert.deepEqual(after, before, "No canonical source or other non-recap public row may change during capture.");
const hashProof = JSON.parse(sql(`select jsonb_build_object('manifest_count',count(*),'all_manifest_hashes_valid',bool_and(m.sha256=public.clinical_recap_hash(m.document-'sha256')),'all_source_fingerprints_valid',bool_and(m.document->>'source_fingerprint'=public.clinical_recap_hash(m.document->'source_set')),'all_source_hashes_valid',bool_and(not exists(select 1 from jsonb_array_elements(m.document#>'{source_set,sources}')s where s->>'sha256'<>public.clinical_recap_hash(s-array['ref','sha256']))))from clinical_recap_manifests m;`));
assert.equal(hashProof.manifest_count, 8);
assert.equal(hashProof.all_manifest_hashes_valid, true);
assert.equal(hashProof.all_source_fingerprints_valid, true);
assert.equal(hashProof.all_source_hashes_valid, true);
assert.equal(sql("select count(*)from clinical_recap_attempts;"), "0");
assert.equal(cases.length, 8);
assert.deepEqual(cases.map((c) => c.id), ["A", "B", "C", "D", "E", "F", "G", "H"]);
const sourceFiles = ["tests/clinical-recap/evaluation-corpus.ts", "tests/clinical-recap/evaluation-capture.ts", "tests/clinical-recap/evaluation-local.py", "supabase/functions/_shared/clinical-recap-model.ts", "supabase/functions/_shared/clinical-recap-handler.ts", "supabase/functions/_shared/clinical-veterinary-context.ts", "supabase/migrations/20261017015543_clinical_record_recap.sql"];
const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, sha(readFileSync(root + file, "utf8"))]));
const output = {
  corpus_version: "lrv-recap-synthetic-eight-v1." + runId, namespace: EVALUATION_NAMESPACE, run_id: runId, fixture_revision: FIXTURE_REVISION, exported_at: new Date().toISOString(),
  identity, synthetic_only: true, provider_requests: 0, author_id: actor, client_id: client,
  identity_assignment: "Auth author and policy/reservation/provenance action IDs are UUIDv5 from the dedicated namespace plus run ID/alias, accepted by their supported APIs. Native staff create RPCs allocate actual source/patient/client UUIDs; source_aliases map those returned values. No source UUID, version, timestamp, fingerprint or manifest hash is rewritten.",
  cases, semantic_negative_controls: negativeControls,
  engineering_proof: { structural_checks: structuralChecks, canonical_before: before, canonical_after: after, canonical_unchanged: true, adapter_hashes: hashProof, source_sha256: sourceHashes, real_provider_evaluation: false, clinical_adjudication_complete: false, local_runtime_cleanup: "owned Python bootstrap must verify removal separately" },
};
mkdirSync(root + "tmp", { recursive: true, mode: 0o700 });
writeFileSync(root + "tmp/clinical-recap-evaluation-corpus.json", JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ cases: cases.length, fixture_revision: FIXTURE_REVISION, structural_checks: structuralChecks, semantic_negative_controls: negativeControls.length, canonical_unchanged: true, adapter_hashes_valid: true, provider_requests: 0, exported: "tmp/clinical-recap-evaluation-corpus.json" }));
