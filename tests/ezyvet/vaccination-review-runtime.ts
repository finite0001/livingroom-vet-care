/** Real local PostgREST review assertions composed with the owned intake fixture. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
interface ApprovedVaccination {
  id: string; version: number; replaces_id: string | null; version_hash: string;
  original: Record<string, unknown>; reviewed: Record<string, unknown>; product: unknown;
  current: { is_latest: boolean; is_current: boolean };
}
interface RuntimeResult {
  request: { id: string; status: string; payload: Record<string, unknown>; request_hash: string; approved_record_id: string | null };
  receipt: ApprovedVaccination;
  requests: RuntimeResult[];
  vaccinations: ApprovedVaccination[];
  candidates: Array<Record<string, unknown>>;
}
interface RuntimeContext {
  actor: string;
  pet: string;
  mapping: string;
  candidates: Array<Record<string, unknown>>;
  rpc: (name: string, args: Record<string, unknown>, staff?: boolean) => Promise<unknown>;
  sql: (query: string) => string;
  quote: (value: string) => string;
  check: (condition: unknown, message: string) => void;
}
export async function exerciseVaccinationReview(context: RuntimeContext) {
  const { actor, pet, mapping, candidates, sql, quote, check } = context;
  const rpc = async (name: string, args: Record<string, unknown>, staff = false) =>
    await context.rpc(name, args, staff) as RuntimeResult;
  const denied = async (action: () => Promise<unknown>, message: string) => {
    let rejected = false;
    try { await action(); } catch { rejected = true; }
    check(rejected, message);
  };
  const source = candidates[0];
  assert.ok(source && candidates[1], "Two owned source candidates required");
  const patientVersion = Number(sql(`select version from public.pets where id=${quote(pet)};`));
  const payloadFor = (row: Record<string, unknown>) => ({
    animal_link_id: mapping, patient_version: patientVersion,
    snapshot_id: row.id, payload_hash: row.payload_hash, observed_head_version: row.observed_head_version,
    consult_snapshot_id: row.consult_snapshot_id, consult_payload_hash: row.consult_payload_hash,
    consult_observed_head_version: row.consult_observed_head_version,
    product_id: null, product_version: null,
    administered_on: null, administration_date_status: "uninterpreted",
    source_next_due_on: null, next_date_status: "unknown", status: "unknown",
    outside_author: null, reason: "Synthetic clinician reviewed outside evidence; date remains uninterpreted",
    replaces_id: null as string | null, expected_predecessor_hash: null as string | null,
  });
  const payload = payloadFor(source);
  const id = randomUUID();
  const prepare = (operation: string, values: Record<string, unknown>) => rpc("prepare_ezyvet_vaccination_review", { p_id: operation, p_pet_id: pet, p_payload: values }, true);
  const recover = (operation: string) => rpc("recover_ezyvet_vaccination_review", { p_id: operation, p_pet_id: pet }, true);
  const approve = (operation: string, hash: string) => rpc("approve_ezyvet_vaccination_review", { p_id: operation, p_pet_id: pet, p_expected_hash: hash, p_confirmed: true }, true);
  await denied(() => prepare(id, payload), "ADMIN alone cannot interpret outside vaccinations");
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'DVM') on conflict do nothing;`);
  sql(`delete from public.user_roles where user_id=${quote(actor)} and role='ADMIN';`);
  const clinicalCandidates = await rpc("list_ezyvet_vaccination_review_candidates", { p_pet_id: pet, p_animal_link_id: mapping }, true);
  check(clinicalCandidates.candidates.length === 2, "DVM can review patient-scoped candidates without ADMIN intake access");
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'ADMIN') on conflict do nothing;`);
  await prepare(id, payload); // Deliberately discard the response, as after a lost ACK.
  const pending = await recover(id);
  check(pending.request.status === "prepared" && pending.request.id === id && pending.receipt === null,
    "Lost prepare response recovers the original operation");
  check(pending.request.payload.administered_on === null && pending.request.payload.product_id === null,
    "Unknown dates and catalog remain unknown in frozen review");
  await denied(() => prepare(id, { ...payload, status: "administered" }), "Retained review UUID cannot change interpretation");
  await denied(() => approve(id, "0".repeat(64)), "Wrong expected prepared hash is denied");
  const abandoned = randomUUID();
  await rpc("abandon_ezyvet_vaccination_review", { p_id: abandoned, p_pet_id: pet, p_confirmed: true }, true);
  await denied(() => prepare(abandoned, payload), "Abandoned operation cannot be revived by delayed prepare");
  const malformed = randomUUID();
  await denied(() => prepare(malformed, { ...payload, administered_on: "2026-02-30", administration_date_status: "date" }), "Invalid calendar date rejected independently in SQL");
  await denied(() => prepare(randomUUID(), { ...payload, product_id: randomUUID(), product_version: 1 }), "Unrecognized catalog product cannot be approved");
  await approve(id, pending.request.request_hash); // Deliberately lose approval acknowledgement.
  const approved = await recover(id);
  check(approved.request.status === "approved" && approved.receipt?.id === approved.request.approved_record_id,
    "Lost approval response recovers its durable outside-history receipt");
  check(approved.receipt.original.date_of_administration === "1700000000" && approved.receipt.reviewed.administered_on === null && approved.receipt.product === null,
    "Raw date remains distinct from reviewed interpretation and absent product");
  const exact = await approve(id, pending.request.request_hash);
  check(exact.receipt.id === approved.receipt.id, "Exact approval retry returns the same immutable record");
  const duplicateId = randomUUID();
  const duplicate = await prepare(duplicateId, { ...payload, reason: "Synthetic second operation for identical interpretation" });
  const duplicateReceipt = await approve(duplicateId, duplicate.request.request_hash);
  check(duplicateReceipt.receipt.id === approved.receipt.id, "Different operation UUID cannot duplicate identical source interpretation");
  const requests = await rpc("list_ezyvet_vaccination_review_requests", { p_pet_id: pet }, true);
  check(requests.requests.some((entry) => entry.request.id === id), "Server discovery preserves approved requests after browser pointer loss");
  const correctionId = randomUUID();
  const correctionPayload = { ...payload, outside_author: "Synthetic outside clinician reference",
    reason: "Synthetic correction explicitly records an outside author reference",
    replaces_id: approved.receipt.id, expected_predecessor_hash: approved.receipt.version_hash };
  const correction = await prepare(correctionId, correctionPayload);
  const corrected = await approve(correctionId, correction.request.request_hash);
  check(corrected.receipt.replaces_id === approved.receipt.id && corrected.receipt.version === 2,
    "Correction appends an explicit successor rather than editing approved evidence");
  const chart = await rpc("list_patient_imported_vaccinations", { p_pet_id: pet }, true);
  check(chart.vaccinations.length === 2 && chart.vaccinations.filter((entry) => entry.current.is_latest).length === 1,
    "Patient chart preserves correction history and one latest version");
  const stalePreparedId = randomUUID();
  const stalePrepared = await prepare(stalePreparedId, payloadFor(candidates[1]));
  sql(`delete from public.user_roles where user_id=${quote(actor)} and role='DVM';`);
  await denied(() => recover(id), "Role revocation blocks terminal review recovery despite an existing session");
  const staffChart = await rpc("list_patient_imported_vaccinations", { p_pet_id: pet }, true);
  check(staffChart.vaccinations.length === 2, "Active non-DVM staff can read approved outside history");
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'DVM') on conflict do nothing;`);
  return async () => {
    await denied(() => approve(stalePreparedId, stalePrepared.request.request_hash), "Changed consult prevents a new approval from stale prepared evidence");
    const terminal = await recover(correctionId);
    check(terminal.receipt.id === corrected.receipt.id && terminal.receipt.current.is_current === false,
      "Terminal recovery retains exact receipt and exposes source discrepancy");
    const afterChange = await rpc("list_patient_imported_vaccinations", { p_pet_id: pet }, true);
    check(afterChange.vaccinations.every((entry) => entry.current.is_current === false),
      "Source consult changes mark historical records stale without rewriting approvals");
  };
}
