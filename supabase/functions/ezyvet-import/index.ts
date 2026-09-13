import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
import type { ImportRun } from "./handler.ts";
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const handler = createHandler({
  env: (key) => Deno.env.get(key),
  fetch,
  now: Date.now,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  gateway: {
    async authenticate(bearer) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data.user) return null;
      const { data: activeAdmin, error: roleError } = await admin.rpc(
        "ezyvet_is_active_admin",
        { p_actor: data.user.id },
      );
      if (roleError) throw roleError;
      return { id: data.user.id, activeAdmin: activeAdmin === true };
    },
    async claim(id, actor, site, resource, sourceOrigin) {
      const { data, error } = await admin.rpc("claim_ezyvet_import", {
        p_id: id,
        p_actor: actor,
        p_site_uid: site,
        p_resource: resource,
        p_source_origin: sourceOrigin,
      });
      if (error) throw error;
      return data as ImportRun;
    },
    async claimWeight(id, actor, site, sourceOrigin, animalLinkId) {
      const { data, error } = await admin.rpc("claim_ezyvet_weight_import", {
        p_id: id,
        p_actor: actor,
        p_site_uid: site,
        p_source_origin: sourceOrigin,
        p_animal_link_id: animalLinkId,
      });
      if (error) throw error;
      return data as ImportRun;
    },
    async claimClinical(id, actor, site, resource, sourceOrigin, animalLinkId) {
      const { data, error } = await admin.rpc("claim_ezyvet_clinical_import", {
        p_id: id,
        p_actor: actor,
        p_site_uid: site,
        p_resource: resource,
        p_source_origin: sourceOrigin,
        p_animal_link_id: animalLinkId,
      });
      if (error) throw error;
      return data as ImportRun;
    },
    async claimVaccination(
      id,
      actor,
      site,
      sourceOrigin,
      animalLinkId,
      consultSnapshotId,
      consultPayloadHash,
      consultObservedHeadVersion,
    ) {
      const { data, error } = await admin.rpc(
        "claim_ezyvet_vaccination_import",
        {
          p_id: id,
          p_actor: actor,
          p_site_uid: site,
          p_resource: "vaccination",
          p_source_origin: sourceOrigin,
          p_animal_link_id: animalLinkId,
          p_consult_snapshot_id: consultSnapshotId,
          p_consult_payload_hash: consultPayloadHash,
          p_consult_observed_head_version: consultObservedHeadVersion,
        },
      );
      if (error) throw error;
      return data as ImportRun;
    },
    async stage(run, actor, page) {
      const { data, error } = await admin.rpc("stage_ezyvet_import_page", {
        p_id: run.id,
        p_actor: actor,
        p_lease_id: run.lease_id,
        p_page: page.page,
        p_complete: page.complete,
        p_items: page.items,
      });
      if (error) throw error;
      return data as ImportRun;
    },
    async fail(run, actor, code, seconds) {
      const { error } = await admin.rpc("fail_ezyvet_import_page", {
        p_id: run.id,
        p_actor: actor,
        p_lease_id: run.lease_id,
        p_code: code,
        p_retry_seconds: seconds,
      });
      if (error) throw error;
    },
  },
});
Deno.serve(handler);
