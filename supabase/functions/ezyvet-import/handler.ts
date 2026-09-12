import {
  configuration,
  createAdapter,
  ImportError,
  resources,
} from "./adapter.ts";
import type { AdapterDependencies, PageResult, Resource } from "./adapter.ts";
export interface ImportRun {
  id: string;
  source_site_uid: string;
  resource: Resource;
  requested_by: string;
  next_page: number;
  status: string;
  lease_id: string | null;
  animal_external_id?: string;
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
    )
      return respond({ error: "ORIGIN_DENIED" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST")
      return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer "))
      return respond({ error: "UNAUTHORIZED" }, 401);
    let run: ImportRun | null = null;
    let actor = "";
    try {
      const user = await dependencies.gateway.authenticate(
        authorization.slice(7),
      );
      if (!user) return respond({ error: "UNAUTHORIZED" }, 401);
      if (!user.activeAdmin)
        return respond({ error: "ACTIVE_ADMIN_REQUIRED" }, 403);
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
          (key) => !["run_id", "resource", "animal_link_id"].includes(key),
        ) ||
        typeof body.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.run_id,
        ) ||
        !resources.includes(body.resource as Resource)
      )
        return respond({ error: "INVALID_REQUEST" }, 400);
      if (!config.readResources.includes(body.resource as Resource))
        return respond({ error: "RESOURCE_NOT_CONFIGURED" }, 400);
      if (
        body.resource === "healthstatus" &&
        (typeof body.animal_link_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(body.animal_link_id))
      )
        return respond({ error: "PATIENT_MAPPING_REQUIRED" }, 400);
      if (body.resource !== "healthstatus" && body.animal_link_id !== undefined)
        return respond({ error: "INVALID_REQUEST" }, 400);
      run =
        body.resource === "healthstatus"
          ? await dependencies.gateway.claimWeight!(
              body.run_id,
              actor,
              config.siteUid,
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
        run.animal_external_id,
      );
      const result = await dependencies.gateway.stage(run, actor, page);
      return respond(
        { ...summary(result), staged_count: page.items.length },
        200,
      );
    } catch (error) {
      const code =
        error instanceof ImportError
          ? error.code
          : error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "55P03"
            ? "IMPORT_BUSY"
            : "IMPORT_FAILED";
      const seconds =
        error instanceof ImportError ? Math.max(2, error.retryAfter) : 5;
      if (run?.lease_id) {
        try {
          await dependencies.gateway.fail(run, actor, code, seconds);
        } catch {
          /* The durable lease expires; do not leak database or upstream error bodies. */
        }
      }
      return respond(
        { error: code, retry_after_seconds: seconds, retry_safe: true },
        code === "IMPORT_BUSY" ? 409 : 503,
      );
    }
  };
}
