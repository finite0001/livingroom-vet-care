import type { ReadReleaseApiOriginal } from "./release-api-original-download.ts";
import {
  buildReleaseEmailPayload,
  type ReleaseEmailIntent,
} from "./release-email-payload.ts";
import type { ReleaseBundle } from "./record-release-renderer.ts";
export interface ReleaseEmailDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface PreparedReleaseEmail {
  request: ReleaseEmailIntent & { state: string };
  payload_hash: string | null;
  manifest: unknown[] | null;
  report_html: string | null;
  receipt: unknown | null;
}
export interface ReleaseEmailPreparationDependencies {
  readApiOriginal?: ReadReleaseApiOriginal;
  authenticate: (
    token: string,
  ) => Promise<{ actorId: string; db: ReleaseEmailDatabase } | null>;
  service: ReleaseEmailDatabase;
  download: (
    bucket: string,
    path: string,
    expectedSize: number,
  ) => Promise<Uint8Array>;
  sender: { from: string; replyTo: string };
}
async function rpc(
  db: ReleaseEmailDatabase,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
export function createPrepareReleaseEmailHandler(
  deps: ReleaseEmailPreparationDependencies,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "Staff authorization required" }, 401);
    }
    try {
      const auth = await deps.authenticate(authorization.slice(7));
      if (!auth) return json({ error: "Staff authorization required" }, 401);
      const text = await req.text();
      if (new TextEncoder().encode(text).length > 450000) {
        return json({ error: "Email intent too large" }, 413);
      }
      const args = JSON.parse(text);
      const keys = [
        "p_request_id",
        "p_release_id",
        "p_conversation_id",
        "p_subject",
        "p_body",
        "p_release_hash",
      ];
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).some((k) => !keys.includes(k)) ||
        keys.some((k) => typeof args[k] !== "string")
      ) {
        return json({ error: "Exact release email intent required" }, 400);
      }
      const prepared = (await rpc(
        auth.db,
        "prepare_release_email",
        args,
      )) as PreparedReleaseEmail;
      // A recorded queue receipt settles an ambiguous retry; never capture or queue again here.
      if (prepared.receipt) return json(prepared);
      // Exact prepare RPC already bound actor and request arguments. A captured
      // payload is historical evidence, not fresh delivery authorization.
      if (
        typeof prepared.payload_hash === "string" &&
        /^[a-f0-9]{64}$/.test(prepared.payload_hash)
      ) return json(prepared);
      const context = (await rpc(
        deps.service,
        "release_email_capture_context",
        { p_request_id: args.p_request_id, p_actor_id: auth.actorId },
      )) as {
        request: ReleaseEmailIntent;
        bundle: ReleaseBundle;
        captured: boolean;
      };
      if (!context.captured) {
        const frozen = await buildReleaseEmailPayload(
          context.request,
          context.bundle,
          deps.sender,
          deps.download,
          deps.readApiOriginal ? original => deps.readApiOriginal!(original, "release_email", args.p_request_id, auth.actorId) : undefined,
        );
        await rpc(deps.service, "capture_release_email_payload", {
          p_request_id: args.p_request_id,
          p_actor_id: auth.actorId,
          p_payload_text: frozen.payload_text,
        });
      }
      return json(
        await rpc(auth.db, "recover_release_email", {
          p_release_id: args.p_release_id,
          p_request_id: args.p_request_id,
        }),
      );
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // Never return provider payloads, private paths, base64 or SQL diagnostic context.
      return json(
        {
          error: code === "42501"
            ? "Release or household authorization is unavailable."
            : code === "23505"
            ? "Recover the existing release email; its intent or bytes are already fixed."
            : code === "23514"
            ? "Release email validation failed. Check the reviewed records and attachment limits."
            : "Preparation was not confirmed. Recover the saved request before retrying.",
          code: code || "preparation_unconfirmed",
          retry_requires_recovery: true,
        },
        code === "42501"
          ? 403
          : code === "23505"
          ? 409
          : code === "23514"
          ? 400
          : 500,
      );
    }
  };
}
