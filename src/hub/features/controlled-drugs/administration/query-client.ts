import { z } from "zod";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import { freezeAdministration } from "./primitives.ts";
import { readAdministrationResponse } from "./response.ts";
import { administrationOptionsRequestSchema, administrationOperationsRequestSchema, administrationScopeRequestSchema, parseAdministrationOperations, parseAdministrationOptions, parseCurrentStockPolicy,
  parseStockOpeningPreview, stockOpeningPreviewRequestSchema } from "./queries.ts";
import { administrationConfigurationRequestSchema, parseAdministrationConfiguration } from "./configuration-query.ts";
import { calendarProjectionRequestSchema, parseCalendarProjection } from "./calendar-projection.ts";
import { AdministrationTransportError, createAdministrationOperationClient } from "./client.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
const configSchema = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(), publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict().refine(value => value.url === `https://${value.projectRef}.supabase.co`);
const methods = Object.freeze({ options: "list_controlled_stock_administration_options_v1", preview: "preview_controlled_stock_opening_v1", stockPolicy: "read_current_stock_policy_v1",
  configuration: "read_controlled_stock_administration_configuration_v1", projectCalendar: "project_controlled_review_calendar_v1", operations: "list_controlled_stock_administration_operations_v1" });
function admit<T>(parse: () => T): T { try { return parse(); } catch { throw new AdministrationTransportError(); } }
export function createAdministrationClient(configInput: ReviewRpcConfig, sessions: ReviewSessionSource, fetcher: typeof fetch = globalThis.fetch) {
  const config = Object.freeze(admit(() => configSchema.parse(configInput))), operations = createAdministrationOperationClient(config, sessions, fetcher);
  async function call<T>(method: keyof typeof methods, requestInput: unknown, identityInput: ReviewIdentity, schema: z.ZodTypeAny, observe: (raw: ExactJson, request: unknown) => T) {
    const identity = Object.freeze(admit(() => parseReviewIdentity(identityInput))), request = freezeAdministration(admit(() => schema.parse(requestInput))) as { actor_id: string };
    const deadline = performance.now() + 30000, controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (request.actor_id !== identity.actorId || !sessions.isCurrent(identity) || controller.signal.aborted || performance.now() >= deadline) throw new AdministrationTransportError(); };
    const work = async () => {
      check(); const body = JSON.stringify({ p_request: request });
      if (new TextEncoder().encode(body).length > 131072) throw new AdministrationTransportError();
      const session = await sessions.current(); check();
      if (!session || !sameReviewIdentity(session, identity) || typeof session.accessToken !== "string" || !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new AdministrationTransportError();
      const response = await fetcher(`${config.url}/rest/v1/rpc/${methods[method]}`, { method: "POST", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body }); check();
      const limits = method === "projectCalendar" ? { rawBytes: 1024 * 1024, parsedBytes: 131072 } : method === "stockPolicy" ? { rawBytes: 2 * 1024 * 1024, parsedBytes: 262144 } : undefined;
      const raw = await readAdministrationResponse(response, controller.signal, deadline, limits); check();
      const value = observe(raw, request); check(); return value;
    };
    try {
      const result = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AdministrationTransportError()); }, 30000); })]);
      check(); return result;
    } catch { controller.abort(); throw new AdministrationTransportError(); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({ ...operations,
    options: (input: unknown, identity: ReviewIdentity) => call("options", input, identity, administrationOptionsRequestSchema, parseAdministrationOptions),
    preview: (input: unknown, identity: ReviewIdentity) => call("preview", input, identity, stockOpeningPreviewRequestSchema, parseStockOpeningPreview),
    stockPolicy: (input: unknown, identity: ReviewIdentity) => call("stockPolicy", input, identity, administrationScopeRequestSchema, parseCurrentStockPolicy),
    configuration: (input: unknown, identity: ReviewIdentity) => call("configuration", input, identity, administrationConfigurationRequestSchema, parseAdministrationConfiguration),
    projectCalendar: (input: unknown, identity: ReviewIdentity) => call("projectCalendar", input, identity, calendarProjectionRequestSchema, parseCalendarProjection),
    operations: (input: unknown, identity: ReviewIdentity) => call("operations", input, identity, administrationOperationsRequestSchema, parseAdministrationOperations),
  });
}
export type AdministrationClient = ReturnType<typeof createAdministrationClient>;
