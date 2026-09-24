import { randomUUID } from "node:crypto";

interface FixtureContext {
  actor: string;
  pet: string;
  site: string;
  animalLink: string;
  ids: string[];
  // Real loopback PostgREST adapters supplied by the owned disposable harness.
  rpc: (name: string, args: Record<string, unknown>) => Promise<ReturnType<typeof JSON.parse>>;
  staff: (name: string, args: Record<string, unknown>) => Promise<ReturnType<typeof JSON.parse>>;
}

export async function seedReviewedPrescription(context: FixtureContext) {
  const { actor, pet, site, animalLink, ids, rpc, staff } = context;
  const parentRun = randomUUID(), itemRun = randomUUID(), reviewId = randomUUID();
  ids.push(parentRun, itemRun, reviewId);
  const parentLease = await rpc("claim_ezyvet_prescription_import", {
    p_id: parentRun, p_actor: actor, p_site_uid: site,
    p_resource: "prescription", p_source_origin: "https://api.trial.ezyvet.com",
    p_animal_link_id: animalLink,
  });
  await rpc("stage_ezyvet_import_page", {
    p_id: parentRun, p_actor: actor, p_lease_id: parentLease.lease_id,
    p_page: 1, p_complete: true,
    p_items: [{ external_id: "903", payload: {
      id: "903", animal_id: "77", consult_id: "901",
      prescribing_vet_user_id: "outside-prescriber",
      date_of_prescription: "unresolved date", prescription_item_list: [904, 905],
    } }],
  });
  const parent = (await staff("list_ezyvet_prescription_candidates", {
    p_animal_link_id: animalLink, p_resource: "prescription", p_limit: 20,
  })).candidates.find((candidate: { external_id: string; is_current: boolean }) =>
    candidate.external_id === "903" && candidate.is_current);
  ids.push(parent.id);
  const itemContext = {
    p_animal_link_id: animalLink,
    p_prescription_snapshot_id: parent.id,
    p_prescription_payload_hash: parent.payload_hash,
    p_prescription_observed_head_version: parent.head_version,
  };
  const itemLease = await rpc("claim_ezyvet_prescriptionitem_import", {
    p_id: itemRun, p_actor: actor, p_site_uid: site, p_resource: "prescriptionitem",
    p_source_origin: "https://api.trial.ezyvet.com", ...itemContext,
  });
  await rpc("stage_ezyvet_import_page", {
    p_id: itemRun, p_actor: actor, p_lease_id: itemLease.lease_id,
    p_page: 1, p_complete: true, p_items: [{ external_id: "904", payload: {
      id: "904", prescription_id: "903", product_id: "42",
      qty: "outside units", remaining: "not a refill authorization",
      instructions: "<script>outside prescription prose</script>",
      date_start: null, serial_number: "outside reference",
    } }],
  });
  const item = (await staff("list_ezyvet_prescriptionitem_candidates", {
    p_animal_link_id: animalLink, p_limit: 20,
  })).candidates.find((candidate: { external_id: string; is_current: boolean }) =>
    candidate.external_id === "904" && candidate.is_current);
  ids.push(item.id);
  const payload = {
    item_run_id: itemRun, patient_version: 1,
    interpretation: {
      prescribed_on: null, prescription_date_status: "uninterpreted",
      status: "unknown", outside_author: "Outside prescriber, unverified name",
      reason: "Synthetic review preserves original prescription evidence",
      completeness: "partial", partial_reason: "Source item 905 was not observed",
      replaces_id: null, expected_predecessor_hash: null,
      items: [{ snapshot_id: item.id, start_on: null, start_date_status: "unknown",
        product_id: null, product_version: null, note: "No local dose inferred" }],
    },
  };
  const prepared = await staff("prepare_ezyvet_prescription_review", {
    p_id: reviewId, p_pet_id: pet, p_payload: payload,
  });
  const approved = await staff("approve_ezyvet_prescription_review", {
    p_id: reviewId, p_pet_id: pet,
    p_expected_hash: prepared.request.request_hash, p_confirmed: true,
  });
  return { approved, prepared, payload, parentRun, itemRun, itemContext };
}
