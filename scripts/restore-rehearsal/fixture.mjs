import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
const [mode, statusPath, run] = process.argv.slice(2);
assert.ok(["create", "verify", "verify-upgrade"].includes(mode));
const config = JSON.parse(readFileSync(statusPath, "utf8"));
const url = new URL(config.API_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, mode !== "verify" ? "58321" : "59321");
const project = readFileSync(
  join(dirname(statusPath), "supabase/config.toml"),
  "utf8",
).match(/^project_id = "(lrv-restore-[a-f0-9]{10}-(?:source|destination))"/)[1];
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
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
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
union all select 'auth_users',jsonb_agg(jsonb_build_object('id',id,'email',email,'encrypted_password',encrypted_password)) from auth.users
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
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Synthetic Restore','Only',null,'restore@example.test','EMAIL','Synthetic mailing address',null);
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
  assert.equal(sql("select count(*) from communication_outbox"), "0");
  assert.equal(
    sql("select count(*) from pg_extension where extname='pg_cron'"),
    "0",
  );
  assert.deepEqual(
    snapshot(),
    state.snapshot,
    "Read and denied-write verification leaves restored clinical/audit/ledger records unchanged",
  );
  writeFileSync(
    join(run, "verification.json"),
    JSON.stringify(
      {
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
        outbox_empty: true,
        cron_absent: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: restored Auth, linked signed history, immutable ledgers, exact original bytes and private access controls.",
  );
}
