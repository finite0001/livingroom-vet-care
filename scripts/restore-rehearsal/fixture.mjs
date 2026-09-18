import { seedCommunications, verifyCommunications, assertExactOutbox } from './communications-fixture.mjs';
import { seedReleasePackages, verifyReleasePackages } from './release-packages.mjs';
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
const [mode, statusPath, run] = process.argv.slice(2);
assert.ok(["create", "verify", "verify-upgrade", "capture-review-audit", "capture-api-originals", "capture-release-packages", "capture-communications"].includes(mode));
const config = JSON.parse(readFileSync(statusPath, "utf8"));
const url = new URL(config.API_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.protocol, "http:");
const projectConfig = readFileSync(
  join(dirname(statusPath), "supabase/config.toml"),
  "utf8",
);
const project = projectConfig.match(/^project_id = "(lrv-restore-[a-f0-9]{10}-(?:source|destination))"/)[1];
assert.ok(project.endsWith(mode === "verify" ? "-destination" : "-source"));
const apiPort = projectConfig.match(/^\[api\]\r?\nport = (\d+)$/m)?.[1];
assert.ok(apiPort && Number(apiPort) >= 1025 && Number(apiPort) <= 65532);
assert.equal(url.port, apiPort);
const sql = (query) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 },
  ).trim();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const api = createClient(config.API_URL, config.ANON_KEY, options);
const anonymous = createClient(config.API_URL, config.ANON_KEY, options);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, options);
const checked = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const statePath = join(run, "synthetic-fixture.json");
let state;
const actor = (id) =>
  `set local role authenticated;select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true);`;
const snapshot = () =>
  JSON.parse(
    sql(`select jsonb_object_agg(name,rows) from (
${["clients", "pets", "profiles", "user_roles", "clinical_encounters", "clinical_addenda", "patient_documents", "catalog_products", "inventory_lots", "inventory_movements", "billing_invoices", "billing_invoice_items", "billing_credits", "audit_logs"].map((table) => `select '${table}' as name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from public.${table} t`).join(" union all ")}
union all select 'auth_users',jsonb_agg(jsonb_build_object('id',id,'email',email,'encrypted_password',encrypted_password) order by id) from auth.users
union all select 'storage_objects',jsonb_agg(to_jsonb(t) order by id) from storage.objects t
union all select 'schema_migrations',jsonb_agg(to_jsonb(t) order by version) from supabase_migrations.schema_migrations t
) x;`),
  );
if (mode === "create") {
  state = {
    email: `restore-${randomUUID()}@example.test`,
    password: randomUUID() + randomUUID(),
    invoice: randomUUID(),
    lot: randomUUID(),
    receipt: randomUUID(),
    adjustment: randomUUID(),
    line: randomUUID(),
    credit: randomUUID(),
  };
  state.projectRun = project.replace(/-(source|destination)$/, "");
  state.user = checked(
    await admin.auth.admin.createUser({
      email: state.email,
      password: state.password,
      email_confirm: true,
    }),
  ).user.id;
  checked(
    await api.auth.signInWithPassword({
      email: state.email,
      password: state.password,
    }),
  );
  const result =
    sql(`begin;create temp table fx(k text primary key,id uuid);grant all on fx to authenticated;${actor(state.user)}
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Synthetic Restore','Only','+13035550481','restore@example.test','EMAIL','Synthetic mailing address',null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Synthetic Restore Patient','Dog',null,null,'unknown',null,'unknown','unknown','0000123456789',null,null);
insert into fx select 'encounter',id from save_clinical_encounter(null,(select id from fx where k='pet'),null,now(),'clinic','Synthetic home base','Synthetic history','Synthetic examination','Synthetic assessment','Synthetic plan');
select sign_clinical_encounter((select id from fx where k='encounter'),1);
select add_clinical_addendum((select id from fx where k='encounter'),'Synthetic clarification retaining signed original');
insert into fx select 'product',id from save_catalog_product(null,null,'Synthetic medication','medication','Synthetic manufacturer','unit',1250,true);
select receive_inventory('${state.receipt}','${state.lot}',(select id from fx where k='product'),'SYNTHETIC-LOT',(now() at time zone 'America/Denver')::date+365,'Synthetic clinic',10,'Synthetic opening stock');
select adjust_inventory('${state.adjustment}','${state.lot}',-2,'Synthetic counted damage');
insert into fx select 'service',id from save_catalog_product(null,null,'Synthetic exam','service','','visit',9000,true);
select create_billing_invoice('${state.invoice}',(select id from fx where k='client'));
select add_invoice_service('${state.line}','${state.invoice}',(select id from fx where k='pet'),(select id from fx where k='service'),1);
select issue_billing_invoice('${state.invoice}',2);
select credit_billing_invoice('${state.credit}','${state.invoice}',500,'Synthetic accounting correction');
select jsonb_object_agg(k,id) from fx;commit;`);
  Object.assign(state, JSON.parse(result.split("\n").at(-1)));
  const content = Buffer.from(
    "%PDF-1.7\nSynthetic restore rehearsal original only; not a clinical form.\n%%EOF",
  );
  state.document = checked(
    await api.rpc("prepare_patient_document", {
      p_id: randomUUID(),
      p_pet_id: state.pet,
      p_encounter_id: state.encounter,
      p_file_name: "synthetic-restore.pdf",
      p_mime_type: "application/pdf",
      p_file_size: content.length,
      p_category: "medical_record",
      p_source: "Isolated restore rehearsal",
      p_document_date: null,
      p_visibility: "internal",
    }),
  );
  checked(
    await api.storage
      .from("patient-documents")
      .upload(state.document.file_path, content, {
        contentType: "application/pdf",
        upsert: false,
      }),
  );
  state.document = checked(
    await api.rpc("finalize_patient_document", { p_id: state.document.id }),
  );
  state.originalHash = hash(content);
  state.originalSize = content.length;
  // Snapshot after durable fixture creation; never include ephemeral auth session rows in comparison.
  state.snapshot = snapshot();
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(
    "Synthetic signed record, private original, issued invoice/credit and stock ledger created.",
  );
} else if (mode === "capture-communications") {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(project, `${state.projectRun}-source`);
  const previous = snapshot();
  state.communications = await seedCommunications({config,admin,sql});
  const captured = snapshot();
  // Every prior row remains byte-for-byte; this fixture may only add its own
  // synthetic identities, Storage originals and audits to the existing baseline.
  for (const [table, rows] of Object.entries(previous)) {
    const current = captured[table];
    for (const row of rows ?? []) assert.ok(current.some(value => JSON.stringify(value) === JSON.stringify(row)), `Communications changed existing ${table} evidence`);
  }
  state.snapshot = captured;
  writeFileSync(statePath,JSON.stringify(state),{mode:0o600});
} else if (mode === "capture-api-originals") {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(project, `${state.projectRun}-source`);
  const previous = snapshot();
  const hadAdmin = sql(`select exists(select 1 from user_roles where user_id='${state.user}' and role='ADMIN')`) === "t";
  if (!hadAdmin) sql(`insert into user_roles(user_id,role) values('${state.user}','ADMIN')`);
  const rows = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('run_id',o.run_id,'page',o.page,'ordinal',o.ordinal,'snapshot_id',o.snapshot_id,'head_version',o.head_version,'stable_hash',o.stable_metadata_sha256,'mapping',r.animal_link_id)) from ezyvet_attachment_page_observations o join ezyvet_attachment_runs r on r.run_id=o.run_id where r.actor_id='${state.user}'`));
  assert.equal(rows.length, 2);
  // Generated pending metadata run stays unfinished, but no provider lease is needed in this local byte fixture.
  sql(`update ezyvet_import_runs set lease_until=null,lease_id=null,retry_after=null where resource='attachment' and requested_by='${state.user}'`);
  checked(await api.auth.signInWithPassword({ email: state.email, password: state.password }));
  state.apiOriginals = [];
  try {
    for (const [index, row] of rows.entries()) {
      const id = randomUUID();
      const prepared = checked(await api.rpc('prepare_ezyvet_attachment_capture', {p_id:id,p_animal_link_id:row.mapping,p_run_id:row.run_id,p_page:row.page,p_ordinal:row.ordinal,p_snapshot_id:row.snapshot_id,p_observed_head_version:row.head_version,p_stable_metadata_sha256:row.stable_hash}));
      assert.equal(prepared.status, 'prepared');
      const claim = checked(await admin.rpc('claim_ezyvet_attachment_capture', {p_id:id,p_actor:state.user}));
      const bytes = Buffer.from(`%PDF-1.7\nSynthetic API original restore fixture ${index}; no provider call.\n%%EOF`);
      const digest = hash(bytes);
      const reserved = checked(await admin.rpc('reserve_ezyvet_attachment_original', {p_id:id,p_actor:state.user,p_lease_id:claim.lease_id,p_content_sha256:digest,p_mime_type:'application/pdf',p_file_size:bytes.length,p_before_raw_sha256:'a'.repeat(64),p_after_raw_sha256:'c'.repeat(64)}));
      checked(await api.storage.from(reserved.intent.bucket_id).upload(reserved.intent.object_path, bytes, {contentType:'application/pdf',upsert:false}));
      const stored = Buffer.from(await checked(await admin.storage.from(reserved.intent.bucket_id).download(reserved.intent.object_path)).arrayBuffer());
      assert.equal(hash(stored), digest);
      assert.ok((await api.storage.from(reserved.intent.bucket_id).download(reserved.intent.object_path)).error, 'Owning administrator cannot read private API original directly');
      let result = reserved;
      if (index === 0) result = checked(await admin.rpc('complete_ezyvet_attachment_capture', {p_id:id,p_actor:state.user,p_lease_id:claim.lease_id,p_intent_id:reserved.intent.id,p_content_sha256:digest,p_mime_type:'application/pdf',p_file_size:bytes.length}));
      state.apiOriginals.push({id,mapping:row.mapping,requestHash:result.request.request_hash,status:result.request.status,intent:reserved.intent,contentSha256:digest,bytes:bytes.length,capture:result.request.capture});
    }
    const ready = state.apiOriginals.find(original => original.status === 'ready');
    assert.ok(ready);
    const approvalArgs = (id, previous = null) => ({p_id:id,p_request_id:ready.id,p_pet_id:state.pet,p_capture_hash:ready.capture.capture_hash,p_previous_record_id:previous,p_title:'Synthetic reviewed restore original',p_review_reason:'Synthetic inspection of exact local fixture bytes',p_attest:true});
    state.apiDecisions = [];
    let previous = null;
    for (let version = 1; version <= 2; version++) {
      const args = approvalArgs(randomUUID(), previous);
      const record = checked(await api.rpc('approve_ezyvet_attachment_record', args));
      assert.equal(record.version, version);
      assert.equal(record.previous_record_id, previous);
      state.apiDecisions.push({args, outcome:{status:'approved',record,cancellation:null}});
      previous = record.id;
    }
    const args = approvalArgs(randomUUID(), previous);
    const outcome = checked(await api.rpc('cancel_ezyvet_attachment_approval', {p_id:args.p_id,p_request_id:args.p_request_id,p_pet_id:args.p_pet_id,p_capture_hash:args.p_capture_hash,p_confirmed:true}));
    assert.equal(outcome.status, 'canceled');
    state.apiDecisions.push({args,outcome});
  } finally {
    if (!hadAdmin) sql(`delete from user_roles where user_id='${state.user}' and role='ADMIN'`);
  }
  const captured = snapshot();
  const originalObjects = new Set(previous.storage_objects.map(row => row.id));
  const added = captured.storage_objects.filter(row => !originalObjects.has(row.id));
  assert.equal(added.length, 2);
  for (const row of added) assert.ok(state.apiOriginals.some(original => row.bucket_id === original.intent.bucket_id && row.name === original.intent.object_path));
  assert.deepEqual({...captured,storage_objects:captured.storage_objects.filter(row => originalObjects.has(row.id))},previous,'API original fixture preserves all prior rows and original object');
  state.snapshot = captured;
  writeFileSync(statePath, JSON.stringify(state), {mode:0o600});
  console.log('Ready and reserved API originals uploaded through staff Storage API, verified privately, and captured for restore.');
} else if (mode === "capture-release-packages") {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(project, `${state.projectRun}-source`);
  checked(await api.auth.signInWithPassword({email:state.email,password:state.password}));
  const previous = snapshot();
  await seedReleasePackages({state,api,admin,sql});
  const apiOnlyPackages=state.releasePackages;
  await seedReleasePackages({state,api,admin,sql,includePrescription:true});
  state.mixedReleasePackages=state.releasePackages;
  state.releasePackages=apiOnlyPackages;
  const captured = snapshot();
  const oldAudits = new Set(previous.audit_logs.map(row => row.id));
  const addedAudits = captured.audit_logs.filter(row => !oldAudits.has(row.id));
  assert.ok(addedAudits.length > 0);
  assert.ok(addedAudits.every(row => ['record_release_policy','record_releases','record_release_sources','record_release_events','release_email_requests','release_email_payloads','sms_consent','conversations','document_link_grants','document_link_payloads','document_link_events'].includes(row.table_name)), 'Only expected release audit families added');
  assert.deepEqual({...captured,audit_logs:captured.audit_logs.filter(row => oldAudits.has(row.id))},previous,'Release packages preserve prior native/Auth/Storage/audit rows');
  state.snapshot = captured;
  writeFileSync(statePath,JSON.stringify(state),{mode:0o600});
} else if (mode === "capture-review-audit") {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(project, `${state.projectRun}-source`);
  const captured = snapshot();
  const originalIds = new Set(state.snapshot.audit_logs.map((row) => row.id));
  const additions = captured.audit_logs.filter((row) => !originalIds.has(row.id));
  const sourceEvidence = JSON.parse(readFileSync(join(run, "vaccination-receipt-fixture.json"), "utf8"));
  const families = ["record_release_policy", "record_releases", "record_release_sources", "record_release_events"];
  assert.equal(additions.length, families.length, "Only the four explicit synthetic release audit additions are allowed");
  for (const family of families) {
    assert.equal(sourceEvidence[family].length, 1);
    const audits = additions.filter((row) => row.table_name === family);
    assert.equal(audits.length, 1, `Exactly one synthetic ${family} audit required`);
    const audit = audits[0];
    assert.equal(audit.user_id, state.user);
    assert.equal(audit.action, "INSERT");
    assert.equal(audit.old_data, null);
    assert.deepEqual(audit.new_data, sourceEvidence[family][0], "Audit must exactly match the seeded release evidence");
    if (family !== "record_release_policy") assert.equal(audit.record_id, sourceEvidence[family][0].id);
  }
  assert.equal(sourceEvidence.record_release_policy[0].accepted_schema_version, 8);
  assert.equal(sourceEvidence.record_release_policy[0].acceptance_reference, "Synthetic isolated restore only");
  assert.deepEqual(
    { ...captured, audit_logs: captured.audit_logs.filter((row) => originalIds.has(row.id)) },
    state.snapshot,
    "Prescription fixture preserves every original clinical/billing/audit/Auth/Storage row",
  );
  state.snapshot = captured;
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log("Original fixture preserved; four explicit synthetic release audit additions captured for restoration.");
} else if (mode === "verify-upgrade") {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(project, `${state.projectRun}-source`);
  const upgraded = snapshot();
  assert.deepEqual(
    { ...upgraded, schema_migrations: state.snapshot.schema_migrations },
    state.snapshot,
    "Upgrade preserves all captured clinical/billing/audit/Auth/Storage data",
  );
  state.snapshot = upgraded;
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(
    "Upgrade preserved captured fixture rows; migration ledger advanced.",
  );
} else {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(project.replace(/-(source|destination)$/, ""), state.projectRun);
  assert.deepEqual(
    snapshot(),
    state.snapshot,
    "Restored clinical/billing/audit/Auth/Storage rows and relationships match backup exactly",
  );
  const login = checked(
    await api.auth.signInWithPassword({
      email: state.email,
      password: state.password,
    }),
  );
  assert.equal(login.user.id, state.user);
  if (state.apiOriginals) {
    const hadAdmin = sql(`select exists(select 1 from user_roles where user_id='${state.user}' and role='ADMIN')`) === "t";
    if (!hadAdmin) sql(`insert into user_roles(user_id,role) values('${state.user}','ADMIN')`);
    try {
      for (const original of state.apiOriginals) {
        const recovered = checked(await api.rpc('recover_ezyvet_attachment_capture', {p_id:original.id,p_animal_link_id:original.mapping}));
        assert.equal(recovered.status, original.status);
        assert.equal(recovered.request_hash, original.requestHash);
        assert.deepEqual(recovered.capture, original.capture);
        const context = checked(await admin.rpc('get_ezyvet_attachment_capture_context', {p_id:original.id,p_actor:state.user}));
        assert.deepEqual(context.intent, original.intent);
        const bytes = Buffer.from(await checked(await admin.storage.from(context.intent.bucket_id).download(context.intent.object_path)).arrayBuffer());
        assert.equal(hash(bytes), original.contentSha256);
        assert.equal(bytes.length, original.bytes);
        assert.ok((await api.storage.from(context.intent.bucket_id).download(context.intent.object_path)).error);
        assert.ok((await anonymous.storage.from(context.intent.bucket_id).download(context.intent.object_path)).error);
      }
      assert.equal(state.apiDecisions.length, 3);
      for (const decision of state.apiDecisions) {
        const {args, outcome} = decision;
        const identity = {p_id:args.p_id,p_request_id:args.p_request_id,p_pet_id:args.p_pet_id,p_capture_hash:args.p_capture_hash};
        assert.deepEqual(checked(await api.rpc('recover_ezyvet_attachment_approval', identity)), outcome);
        assert.deepEqual(checked(await api.rpc('cancel_ezyvet_attachment_approval', {...identity,p_confirmed:true})), outcome, 'Committed approval wins cancellation; canceled retry preserves receipt');
        if (outcome.status === 'approved') {
          assert.deepEqual(checked(await api.rpc('approve_ezyvet_attachment_record', args)), outcome.record, 'Exact approval retry preserves historical version');
          const context = checked(await admin.rpc('get_reviewed_ezyvet_original_context', {p_actor:state.user,p_record_id:args.p_id,p_pet_id:state.pet,p_capture_hash:args.p_capture_hash}));
          const bytes = Buffer.from(await checked(await admin.storage.from(context.bucket_id).download(context.object_path)).arrayBuffer());
          assert.equal(hash(bytes), context.content_sha256);
          assert.equal(context.content_sha256, state.apiOriginals.find(original => original.id === args.p_request_id).contentSha256);
        } else {
          const rejected = await api.rpc('approve_ezyvet_attachment_record', args);
          assert.equal(rejected.error?.code, '23514');
          assert.match(rejected.error.message, /Approval was canceled/);
        }
        assert.equal((await anonymous.rpc('recover_ezyvet_attachment_approval', identity)).error?.code, '42501');
      }
      for (const table of ['ezyvet_attachment_record_versions','ezyvet_attachment_approval_cancellations']) {
        assert.equal((await api.from(table).select('*')).error?.code, '42501');
        const before = sql(`select jsonb_agg(to_jsonb(t) order by id) from ${table} t`);
        for (const operation of ['update','delete']) {
          sql(`begin; do $probe$ begin
            begin
              ${operation === 'update' ? `update ${table} set pet_id=pet_id` : `delete from ${table}`};
              raise exception 'Expected immutable history rejection';
            exception when check_violation then null; end;
          end $probe$; rollback;`);
        }
        assert.equal(sql(`select jsonb_agg(to_jsonb(t) order by id) from ${table} t`), before);
      }
    } finally {
      if (!hadAdmin) sql(`delete from user_roles where user_id='${state.user}' and role='ADMIN'`);
    }
  }
  const record = checked(
    await api
      .from("clinical_encounters")
      .select("*")
      .eq("id", state.encounter)
      .single(),
  );
  assert.equal(record.status, "signed");
  assert.equal(record.pet_id, state.pet);
  assert.equal(record.signed_by, state.user);
  assert.equal(
    checked(
      await api
        .from("clinical_addenda")
        .select("*")
        .eq("encounter_id", state.encounter),
    ).length,
    1,
  );
  const invoice = checked(
    await api
      .from("billing_invoices")
      .select("*")
      .eq("id", state.invoice)
      .single(),
  );
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.total_cents, 9000);
  assert.equal(
    checked(
      await api
        .from("billing_credits")
        .select("*")
        .eq("invoice_id", state.invoice),
    )[0].amount_cents,
    500,
  );
  assert.equal(
    Number(
      sql(
        `select sum(quantity) from inventory_movements where lot_id='${state.lot}'`,
      ),
    ),
    8,
  );
  const storage = api.storage.from("patient-documents");
  const original = Buffer.from(
    await checked(
      await storage.download(state.document.file_path),
    ).arrayBuffer(),
  );
  assert.equal(hash(original), state.originalHash);
  assert.equal(original.length, state.originalSize);
  const signed = checked(
    await storage.createSignedUrl(state.document.file_path, 60),
  );
  const downloaded = await fetch(signed.signedUrl);
  assert.equal(downloaded.status, 200);
  assert.equal(
    hash(Buffer.from(await downloaded.arrayBuffer())),
    state.originalHash,
  );
  assert.ok(
    (
      await anonymous.storage
        .from("patient-documents")
        .download(state.document.file_path)
    ).error,
  );
  assert.equal(
    (
      await fetch(
        `${config.API_URL}/storage/v1/object/public/patient-documents/${state.document.file_path}`,
      )
    ).ok,
    false,
  );
  assert.ok(
    (
      await storage.upload(state.document.file_path, original, {
        contentType: "application/pdf",
        upsert: true,
      })
    ).error,
  );
  const remove = await storage.remove([state.document.file_path]);
  if (!remove.error) assert.deepEqual(remove.data, []);
  for (const mutation of [
    api
      .from("clinical_encounters")
      .update({ assessment: "Forbidden rewrite" })
      .eq("id", state.encounter)
      .select(),
    api
      .from("billing_invoice_items")
      .update({ amount_cents: 0 })
      .eq("invoice_id", state.invoice)
      .select(),
    api.from("inventory_movements").delete().eq("lot_id", state.lot).select(),
  ]) {
    const result = await mutation;
    if (!result.error)
      assert.deepEqual(
        result.data,
        [],
        "RLS-filtered mutation must affect no rows",
      );
  }
  const anonymousRecords = await anonymous
    .from("clinical_encounters")
    .select("*");
  if (!anonymousRecords.error) assert.deepEqual(anonymousRecords.data, []);
  assert.equal(
    hash(
      Buffer.from(
        await checked(
          await storage.download(state.document.file_path),
        ).arrayBuffer(),
      ),
    ),
    state.originalHash,
  );
  // Keep the privileged database role, but supply an actual active synthetic actor.
  // A missing-staff error must never count as evidence of immutable-history enforcement.
  for (const [statement, expected] of [
    [
      `update clinical_encounters set assessment='rewrite' where id='${state.encounter}'`,
      "Signed encounters are immutable; add an addendum",
    ],
    [
      `update clinical_addenda set content='rewrite' where encounter_id='${state.encounter}'`,
      "Clinical history is append-only",
    ],
    [
      `delete from inventory_movements where lot_id='${state.lot}'`,
      "Inventory and billing history cannot be deleted",
    ],
  ]) {
    sql(`begin;
select set_config('request.jwt.claims','{"sub":"${state.user}","role":"authenticated"}',true);
do $$declare rejected boolean := false; begin
 if current_user <> 'supabase_admin' or clinical_require_staff() <> '${state.user}'::uuid then raise exception 'Privileged synthetic actor setup failed'; end if;
 begin
  ${statement};
 exception when others then
  if SQLSTATE <> '23514' or SQLERRM <> '${expected}' then raise; end if;
  rejected := true;
 end;
 if not rejected then raise exception 'Expected exact immutable-history rejection was absent'; end if;
end $$;
rollback;`);
  }
  assertExactOutbox(sql,state.communications);
  assert.equal(
    sql("select count(*) from pg_extension where extname='pg_cron'"),
    "0",
  );
  assert.deepEqual(
    snapshot(),
    state.snapshot,
    "Read and denied-write verification leaves restored clinical/audit/ledger records unchanged",
  );
  if (state.releasePackages) {
    await verifyReleasePackages({state,api,admin,sql});
    if (state.mixedReleasePackages) await verifyReleasePackages({state,api,admin,sql,packages:state.mixedReleasePackages});
    assert.deepEqual(snapshot(),state.snapshot,'Artifact verification and rolled-back source/policy probes preserve original records');
  }
  writeFileSync(
    join(run, "verification.json"),
    JSON.stringify(
      {
        mixed_prescription_api_release_packages_restored: Boolean(state.mixedReleasePackages),
        partial_prescription_disclosure_and_source_invalidation_verified: Boolean(state.mixedReleasePackages),
        saved_schema9_email_and_link_restored: Boolean(state.releasePackages),
        restored_saved_artifact_recovery_and_current_access: Boolean(state.releasePackages),
        restored_policy_and_source_invalidation_denied: Boolean(state.releasePackages),
        fresh_local_login: true,
        identical_rows_and_ids: true,
        signed_soap_and_addendum: true,
        invoice_total_cents: 9000,
        credit_cents: 500,
        stock_units: 8,
        private_original_sha256: state.originalHash,
        private_original_bytes: state.originalSize,
        anonymous_and_public_denied: true,
        ready_original_and_signed_history_immutable: true,
        outbox_empty: !state.communications,
        exact_reviewed_outbox_inventory_verified: true,
        cron_absent: true,
        api_originals_restored: state.apiOriginals?.length ?? 0,
        approved_corrected_canceled_decisions_restored: state.apiDecisions?.length ?? 0,
        decision_replay_private_bytes_and_immutability_verified: Boolean(state.apiDecisions?.length),
        ready_and_reserved_api_original_bytes_verified: Boolean(state.apiOriginals?.length),
      },
      null,
      2,
    ),
  );
  if (state.communications) {
    const communications = await verifyCommunications({config,admin,sql,evidence:state.communications});
    writeFileSync(join(run,'communications-verification.json'),JSON.stringify(communications,null,2),{mode:0o600});
  }
  console.log(
    "PASS: restored Auth, linked signed history, immutable ledgers, exact original bytes and private access controls.",
  );
}
