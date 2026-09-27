import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  anesthesiaDrugLots,
  anesthesiaDrugRequest,
  anesthesiaDrugsLocked,
  SIGNED_RECORD_DRUG_POLICY,
  type AnesthesiaDrugInput,
} from "../../src/hub/features/anesthesia/drug-administration.ts";
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read(
  "supabase/migrations/20260928140000_anesthesia_drug_administrations.sql",
);
const hash = "a".repeat(64);
const draft = {
  status: "draft",
  started_at: "2026-01-01T16:00:00.000Z",
  ended_at: "2026-01-01T17:00:00.000Z",
};
const input = (
  extra: Partial<AnesthesiaDrugInput> = {},
): AnesthesiaDrugInput => ({
  lot_id: "lot",
  invoice_id: "invoice",
  quantity: "1.25",
  dose: "Documented by clinician",
  route: "IV",
  site: "",
  veterinarian: "Synthetic veterinarian",
  veterinarian_license: "",
  administered: "2026-01-01T09:30",
  ...extra,
});

test("request carries exact staff values, Denver instant and alert acknowledgment", () => {
  const request = anesthesiaDrugRequest(input(), draft, hash);
  assert.deepEqual(request, {
    lot_id: "lot",
    invoice_id: "invoice",
    quantity: 1.25,
    dose: "Documented by clinician",
    route: "IV",
    site: "",
    veterinarian: "Synthetic veterinarian",
    veterinarian_license: "",
    administered_at: "2026-01-01T16:30:00.000Z",
    alert_review: { source_hash: hash, acknowledged: true },
  });
  // Server owns patient and source; the client never sends them.
  assert.ok(
    !("pet_id" in request) &&
      !("source" in request) &&
      !("historical" in request),
  );
});

test("signed records are locked for new drug entries", () => {
  const signed = { ...draft, status: "signed" };
  assert.equal(anesthesiaDrugsLocked(signed), true);
  assert.equal(anesthesiaDrugsLocked(draft), false);
  assert.throws(() => anesthesiaDrugRequest(input(), signed, hash), {
    message: SIGNED_RECORD_DRUG_POLICY,
  });
});

test("rejects missing lot, invoice, alert review, fields and bad quantities", () => {
  assert.throws(() =>
    anesthesiaDrugRequest(input({ lot_id: "" }), draft, hash),
  );
  assert.throws(() =>
    anesthesiaDrugRequest(input({ invoice_id: "" }), draft, hash),
  );
  assert.throws(() => anesthesiaDrugRequest(input(), draft, null));
  for (const field of ["dose", "route", "veterinarian"] as const)
    assert.throws(() =>
      anesthesiaDrugRequest(input({ [field]: "  " }), draft, hash),
    );
  for (const quantity of ["", "0", "-1", "1.2345", "abc"])
    assert.throws(() =>
      anesthesiaDrugRequest(input({ quantity }), draft, hash),
    );
  assert.throws(() =>
    anesthesiaDrugRequest(input({ dose: "x".repeat(201) }), draft, hash),
  );
});

test("administration time must fall inside the procedure window", () => {
  assert.throws(
    () =>
      anesthesiaDrugRequest(
        input({ administered: "2026-01-01T08:59" }),
        draft,
        hash,
      ),
    /within the recorded procedure/,
  );
  assert.throws(
    () =>
      anesthesiaDrugRequest(
        input({ administered: "2026-01-01T10:01" }),
        draft,
        hash,
      ),
    /within the recorded procedure/,
  );
  const open = { ...draft, ended_at: null };
  const now = new Date("2026-01-01T17:00:00.000Z");
  assert.doesNotThrow(() =>
    anesthesiaDrugRequest(
      input({ administered: "2026-01-01T10:04" }),
      open,
      hash,
      now,
    ),
  );
  assert.throws(() =>
    anesthesiaDrugRequest(
      input({ administered: "2026-01-01T10:06" }),
      open,
      hash,
      now,
    ),
  );
  // Skipped daylight-saving wall time is rejected rather than guessed.
  const spring = {
    status: "draft",
    started_at: "2026-03-08T00:00:00.000Z",
    ended_at: null,
  };
  assert.throws(() =>
    anesthesiaDrugRequest(
      input({ administered: "2026-03-08T02:30" }),
      spring,
      hash,
      new Date("2026-03-09T00:00:00Z"),
    ),
  );
});

test("only active, unexpired, in-stock medication lots are offered", () => {
  const lot = {
    kind: "medication",
    active: true,
    balance: 2,
    expires_on: "2026-02-01",
  };
  const offered = anesthesiaDrugLots(
    [
      lot,
      { ...lot, kind: "vaccine" },
      { ...lot, active: false },
      { ...lot, balance: 0 },
      { ...lot, expires_on: "2026-01-31" },
      { ...lot, expires_on: "2026-02-01", balance: 0.5 },
    ],
    "2026-02-01",
  );
  assert.equal(offered.length, 2);
});

test("migration reuses the treatment RPC instead of writing stock or invoice rows itself", () => {
  assert.match(
    migration,
    /result:=public\.record_patient_treatment\(p_id,treatment_request\);/,
  );
  assert.doesNotMatch(
    migration,
    /insert into public\.(inventory_movements|billing_invoice_items|patient_treatments)/,
  );
  assert.match(migration, /'source','Anesthesia record '\|\|p_record_id::text/);
  assert.match(
    migration,
    /rec\.status<>'draft' then raise exception 'Signed anesthesia records are locked/,
  );
  assert.match(migration, /for share;/);
  assert.match(migration, /product_kind<>'medication'/);
  assert.match(
    migration,
    /revoke all on function public\.record_anesthesia_drug_administration\(uuid,uuid,uuid,jsonb\) from public,anon,authenticated,service_role;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.record_anesthesia_drug_administration\(uuid,uuid,uuid,jsonb\) to authenticated;/,
  );
  assert.doesNotMatch(
    migration,
    /grant (insert|update|delete)[^;]*anesthesia_drug_administrations/i,
  );
  assert.match(
    migration,
    /anesthesia_drug_window_guard before update on public\.patient_anesthesia_records/,
  );
});

test("panel is mounted on saved records with the household and blocks signing while uncertain", () => {
  const parent = read(
    "src/hub/features/anesthesia/PatientAnesthesiaRecords.tsx",
  );
  assert.match(
    parent,
    /<AnesthesiaDrugAdministrations[\s\S]*clientId=\{clientId\}[\s\S]*record=\{record\}/,
  );
  assert.match(
    parent,
    /disabled=\{busy \|\| draftDirty \|\| drugPending \|\| !record\}/,
  );
  assert.match(parent, /busy \|\| drugPending;/);
  const page = read("src/hub/features/patients/PatientPage.tsx");
  assert.match(
    page,
    /<PatientAnesthesiaRecords [^>]*clientId=\{patient\.client_id\}/,
  );
  const panel = read(
    "src/hub/features/anesthesia/AnesthesiaDrugAdministrations.tsx",
  );
  assert.match(panel, /record_anesthesia_drug_administration/);
  assert.match(panel, /Controlled-substance \(DEA\) logs are not kept here/);
  assert.doesNotMatch(panel, /defaultValue=/);
});
