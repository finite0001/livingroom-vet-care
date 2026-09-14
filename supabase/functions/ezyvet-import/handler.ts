import {
  configuration,
  createAdapter,
  ImportError,
  patientScoped,
  resources,
} from "./adapter.ts";
import type {
  AttachmentParent,
  AdapterDependencies,
  ClinicalResource,
  PageResult,
  Resource,
} from "./adapter.ts";
export interface ImportRun {
  id: string;
  source_site_uid: string;
  resource: Resource;
  requested_by: string;
  next_page: number;
  status: string;
  lease_id: string | null;
  animal_external_id?: string;
  consult_external_id?: string;
  prescription_external_id?: string;
  parent_context?: AttachmentParent & { animal_link_id: string; parent_snapshot_id: string; parent_payload_hash: string; parent_observed_head_version: number; source_origin: string; source_site_uid: string };
}
export interface ImportGateway {
  authenticate: (
    bearer: string,
  ) => Promise<{ id: string; activeAdmin: boolean } | null>;
  claim: (
    id: string,
    actor: string,
    site: string,
    resource: Resource,
    sourceOrigin: string,
  ) => Promise<ImportRun>;
  claimWeight?: (
    id: string,
    actor: string,
    site: string,
    sourceOrigin: string,
    animalLinkId: string,
  ) => Promise<ImportRun>;
  claimClinical?: (
    id: string,
    actor: string,
    site: string,
    resource: ClinicalResource,
    sourceOrigin: string,
    animalLinkId: string,
  ) => Promise<ImportRun>;
  claimVaccination?: (
    id: string,
    actor: string,
    site: string,
    sourceOrigin: string,
    animalLinkId: string,
    consultSnapshotId: string,
    consultPayloadHash: string,
    consultObservedHeadVersion: number,
  ) => Promise<ImportRun>;
  claimPrescriptionItem?: (
    id: string,
    actor: string,
    site: string,
    sourceOrigin: string,
    animalLinkId: string,
    prescriptionSnapshotId: string,
    prescriptionPayloadHash: string,
    prescriptionObservedHeadVersion: number,
  ) => Promise<ImportRun>;
  claimAttachment?: (
    id: string, actor: string, site: string, sourceOrigin: string, animalLinkId: string,
    parentType: "Animal" | "Consult", parentSnapshotId: string, parentPayloadHash: string, parentVersion: number,
  ) => Promise<ImportRun>;
  claimPrescription?: (
    id: string, actor: string, site: string, sourceOrigin: string, animalLinkId: string,
  ) => Promise<ImportRun>;
  stage: (
    run: ImportRun,
    actor: string,
    page: PageResult,
  ) => Promise<ImportRun>;
  fail: (
    run: ImportRun,
    actor: string,
    code: string,
    seconds: number,
  ) => Promise<void>;
}
export interface HandlerDependencies extends AdapterDependencies {
  env: (key: string) => string | undefined;
  gateway: ImportGateway;
}
export function createHandler(dependencies: HandlerDependencies) {
  let adapter: ReturnType<typeof createAdapter> | null = null;
  let adapterKey = "";
  return async (request: Request): Promise<Response> => {
    const appUrl = dependencies.env("APP_URL");
    let origin: string;
    try {
      origin = new URL(appUrl || "").origin;
    } catch {
      return new Response(null, { status: 503 });
    }
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const respond = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers });
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== origin
    ) {
      return respond({ error: "ORIGIN_DENIED" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") {
      return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return respond({ error: "UNAUTHORIZED" }, 401);
    }
    let run: ImportRun | null = null;
    let actor = "";
    try {
      const user = await dependencies.gateway.authenticate(
        authorization.slice(7),
      );
      if (!user) return respond({ error: "UNAUTHORIZED" }, 401);
      if (!user.activeAdmin) {
        return respond({ error: "ACTIVE_ADMIN_REQUIRED" }, 403);
      }
      actor = user.id;
      const config = configuration(dependencies.env);
      const reader = request.body?.getReader();
      if (!reader) return respond({ error: "INVALID_REQUEST" }, 400);
      let text = "";
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 2048) {
            await reader.cancel();
            return respond({ error: "INVALID_REQUEST" }, 400);
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text);
      } catch {
        return respond({ error: "INVALID_REQUEST" }, 400);
      }
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== "object" ||
        Object.keys(body).some(
          (key) =>
            ![
              "run_id",
              "resource",
              "animal_link_id",
              "consult_snapshot_id",
              "consult_payload_hash",
              "consult_observed_head_version",
              "prescription_snapshot_id",
              "prescription_payload_hash",
              "prescription_observed_head_version",
              "parent_type", "parent_snapshot_id", "parent_payload_hash", "parent_observed_head_version",
            ].includes(key),
        ) ||
        typeof body.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(
            body.run_id,
          ) ||
        !resources.includes(body.resource as Resource)
      ) {
        return respond({ error: "INVALID_REQUEST" }, 400);
      }
      if (!config.readResources.includes(body.resource as Resource)) {
        return respond({ error: "RESOURCE_NOT_CONFIGURED" }, 400);
      }
      if (
        (patientScoped(body.resource as Resource) ||
          body.resource === "vaccination" || body.resource === "prescriptionitem" || body.resource === "attachment") &&
        (typeof body.animal_link_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(body.animal_link_id))
      ) {
        return respond({ error: "PATIENT_MAPPING_REQUIRED" }, 400);
      }
      if (
        !patientScoped(body.resource as Resource) &&
        body.resource !== "vaccination" && body.resource !== "prescriptionitem" && body.resource !== "attachment" &&
        body.animal_link_id !== undefined
      ) {
        return respond({ error: "INVALID_REQUEST" }, 400);
      }
      if (body.resource === "vaccination") {
        if (
          typeof body.consult_snapshot_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(body.consult_snapshot_id) ||
          typeof body.consult_payload_hash !== "string" ||
          !/^[0-9a-f]{64}$/.test(body.consult_payload_hash) ||
          typeof body.consult_observed_head_version !== "number" ||
          !Number.isSafeInteger(body.consult_observed_head_version) ||
          body.consult_observed_head_version < 1 ||
          body.consult_observed_head_version > 2147483647
        ) {
          return respond({ error: "CONSULT_MAPPING_REQUIRED" }, 400);
        }
      } else if (
        [
          "consult_snapshot_id",
          "consult_payload_hash",
          "consult_observed_head_version",
        ].some((key) => key in body)
      ) {
        return respond({ error: "INVALID_REQUEST" }, 400);
      }
      if (body.resource === "prescriptionitem") {
        if (
          typeof body.prescription_snapshot_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(body.prescription_snapshot_id) ||
          typeof body.prescription_payload_hash !== "string" ||
          !/^[0-9a-f]{64}$/.test(body.prescription_payload_hash) ||
          typeof body.prescription_observed_head_version !== "number" ||
          !Number.isSafeInteger(body.prescription_observed_head_version) ||
          body.prescription_observed_head_version < 1 ||
          body.prescription_observed_head_version > 2147483647
        ) {
          return respond({ error: "PRESCRIPTION_MAPPING_REQUIRED" }, 400);
        }
      } else if (
        [
          "prescription_snapshot_id",
          "prescription_payload_hash",
          "prescription_observed_head_version",
        ].some((key) => key in body)
      ) {
        return respond({ error: "INVALID_REQUEST" }, 400);
      }
      if (body.resource === "attachment") {
        if (typeof body.parent_type !== "string" || !["Animal", "Consult"].includes(body.parent_type) ||
          typeof body.parent_snapshot_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.parent_snapshot_id) ||
          typeof body.parent_payload_hash !== "string" || !/^[0-9a-f]{64}$/.test(body.parent_payload_hash) ||
          typeof body.parent_observed_head_version !== "number" || !Number.isSafeInteger(body.parent_observed_head_version) ||
          body.parent_observed_head_version < 1 || body.parent_observed_head_version > 2147483647) {
          return respond({ error: "ATTACHMENT_PARENT_REQUIRED" }, 400);
        }
        if (!dependencies.gateway.claimAttachment) return respond({ error: "ATTACHMENT_INTAKE_UNAVAILABLE" }, 503);
      } else if (["parent_type", "parent_snapshot_id", "parent_payload_hash", "parent_observed_head_version"].some(key => key in body)) {
        return respond({ error: "INVALID_REQUEST" }, 400);
      }
      if ((body.resource === "prescription" && !dependencies.gateway.claimPrescription) ||
        (body.resource === "prescriptionitem" && !dependencies.gateway.claimPrescriptionItem)) {
        return respond({ error: "PRESCRIPTION_INTAKE_UNAVAILABLE" }, 503);
      }
      run = body.resource === "attachment"
        ? await dependencies.gateway.claimAttachment!(body.run_id, actor, config.siteUid, config.baseUrl,
          body.animal_link_id as string, body.parent_type as "Animal" | "Consult", body.parent_snapshot_id as string,
          body.parent_payload_hash as string, body.parent_observed_head_version as number)
        : body.resource === "prescription"
        ? await dependencies.gateway.claimPrescription!(body.run_id, actor, config.siteUid,
          config.baseUrl, body.animal_link_id as string)
        : body.resource === "prescriptionitem"
        ? await dependencies.gateway.claimPrescriptionItem!(body.run_id, actor, config.siteUid,
          config.baseUrl, body.animal_link_id as string, body.prescription_snapshot_id as string,
          body.prescription_payload_hash as string, body.prescription_observed_head_version as number)
        : body.resource === "vaccination"
        ? await dependencies.gateway.claimVaccination!(
          body.run_id,
          actor,
          config.siteUid,
          config.baseUrl,
          body.animal_link_id as string,
          body.consult_snapshot_id as string,
          body.consult_payload_hash as string,
          body.consult_observed_head_version as number,
        )
        : body.resource === "healthstatus"
        ? await dependencies.gateway.claimWeight!(
          body.run_id,
          actor,
          config.siteUid,
          config.baseUrl,
          body.animal_link_id as string,
        )
        : body.resource === "consult" || body.resource === "history"
        ? await dependencies.gateway.claimClinical!(
          body.run_id,
          actor,
          config.siteUid,
          body.resource,
          config.baseUrl,
          body.animal_link_id as string,
        )
        : await dependencies.gateway.claim(
          body.run_id,
          actor,
          config.siteUid,
          body.resource as Resource,
          config.baseUrl,
        );
      if (body.resource === "attachment") {
        const context = run.parent_context;
        if (run.id !== body.run_id || run.requested_by !== actor || run.resource !== "attachment" ||
          run.source_site_uid !== config.siteUid || !context || context.animal_link_id !== body.animal_link_id ||
          context.parent_type !== body.parent_type || context.parent_snapshot_id !== body.parent_snapshot_id ||
          context.parent_payload_hash !== body.parent_payload_hash || context.parent_observed_head_version !== body.parent_observed_head_version ||
          context.source_origin !== config.baseUrl || context.source_site_uid !== config.siteUid) {
          run = null;
          throw new ImportError("ATTACHMENT_CONTEXT_MISMATCH");
        }
      }
      const summary = (value: ImportRun) => ({
        run_id: value.id,
        status: value.status,
        next_page: value.next_page,
        review_only: true,
      });
      if (run.status !== "running") return respond(summary(run), 200);
      const key = JSON.stringify(config);
      if (!adapter || key !== adapterKey) {
        adapter = createAdapter(config, dependencies);
        adapterKey = key;
      }
      const page = await adapter.page(
        run.resource,
        run.next_page,
        run.resource === "vaccination" || run.resource === "prescriptionitem" || run.resource === "attachment" ? undefined : run.animal_external_id,
        run.consult_external_id,
        run.prescription_external_id,
        run.parent_context,
      );
      const result = await dependencies.gateway.stage(run, actor, page);
      return respond(
        { ...summary(result), staged_count: page.items.length },
        200,
      );
    } catch (error) {
      const vaccinationCode = error && typeof error === "object" &&
          "code" in error && "message" in error &&
          ((error.code === "22023" &&
            error.message === "VACCINATION_RUN_REQUIRES_NEW_CONTEXT") ||
            (error.code === "40001" &&
              error.message === "SOURCE_CONSULT_STALE"))
        ? String(error.message)
        : null;
      const prescriptionCode = error && typeof error === "object" && "code" in error && "message" in error &&
        ((error.code === "22023" && ["PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING", "PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT"].includes(String(error.message))) ||
          (error.code === "40001" && error.message === "SOURCE_PRESCRIPTION_STALE"))
        ? String(error.message) : null;
      const attachmentCode = error && typeof error === "object" && "code" in error && "message" in error &&
        ((error.code === "22023" && error.message === "ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT") ||
          (error.code === "40001" && error.message === "SOURCE_ATTACHMENT_PARENT_STALE")) ? String(error.message) : null;
      const code = attachmentCode ?? prescriptionCode ?? vaccinationCode ??
        (error && typeof error === "object" && "code" in error &&
            error.code === "22023" && "message" in error &&
            error.message === "CLINICAL_RUN_REQUIRES_NEW_MAPPING"
          ? "CLINICAL_RUN_REQUIRES_NEW_MAPPING"
          : error instanceof ImportError
          ? error.code
          : error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "55P03"
          ? "IMPORT_BUSY"
          : "IMPORT_FAILED");
      const seconds = error instanceof ImportError
        ? Math.max(2, error.retryAfter)
        : 5;
      if (run?.lease_id) {
        try {
          await dependencies.gateway.fail(run, actor, code, seconds);
        } catch {
          /* The durable lease expires; do not leak database or upstream error bodies. */
        }
      }
      const requiresNewContext = [
        "CLINICAL_RUN_REQUIRES_NEW_MAPPING",
        "VACCINATION_RUN_REQUIRES_NEW_CONTEXT",
        "SOURCE_CONSULT_STALE",
        "PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING",
        "PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT",
        "SOURCE_PRESCRIPTION_STALE",
        "ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT",
        "SOURCE_ATTACHMENT_PARENT_STALE",
      ].includes(code);
      return respond(
        {
          error: code,
          retry_after_seconds: seconds,
          retry_safe: !requiresNewContext,
        },
        code === "IMPORT_BUSY" || requiresNewContext ? 409 : 503,
      );
    }
  };
}
