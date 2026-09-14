import type { ReadReleaseApiOriginal } from "./release-api-original-download.ts";
import {
  materializeDocumentLink,
  constantTimeText,
  validGrantId,
  type DocumentLinkConfig,
} from "./document-link-capability.ts";
import {
  buildDocumentLinkArtifacts,
  type DocumentLinkGrant,
} from "./document-link-artifacts.ts";
import { sha256Hex } from "./release-email-payload.ts";
import type { InvoicePractice } from "./invoice-document.ts";
export interface LinkDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
interface PreparedLink {
  grant: DocumentLinkGrant;
  artifact_hash: string | null;
  message_hash: string | null;
  manifest: unknown[] | null;
  report_html: string | null;
  events: unknown[];
  receipt: null;
}
export interface LinkDependencies {
  readApiOriginal?: ReadReleaseApiOriginal;
  config: DocumentLinkConfig | null;
  service: LinkDatabase;
  authenticate: (
    token: string,
  ) => Promise<{ actorId: string; db: LinkDatabase } | null>;
  practice: InvoicePractice;
  download: (
    bucket: string,
    path: string,
    expectedSize: number,
  ) => Promise<Uint8Array>;
}
const headers = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Expose-Headers": "content-disposition,content-type",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
const unavailable = (status = 404) =>
  json({ error: "Document link unavailable" }, status);
async function readBody(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Body unavailable");
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("Body limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function rpc(
  db: LinkDatabase,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function createStaffDocumentLinkHandler(
  deps: LinkDependencies,
  mode: "prepare" | "recover",
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return unavailable(405);
    if (!deps.config) return unavailable(503);
    const bearer = req.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ")) return unavailable(401);
    try {
      const auth = await deps.authenticate(bearer.slice(7));
      if (!auth) return unavailable(401);
      const body = await readBody(req, mode === "prepare" ? 16000 : 1024);
      const prepareKeys = [
        "p_request_id",
        "p_family",
        "p_source_id",
        "p_client_id",
        "p_conversation_id",
        "p_recipient",
        "p_source_hash",
        "p_expires_at",
        "p_message_template",
      ];
      const keys =
        mode === "prepare"
          ? prepareKeys
          : ["p_family", "p_source_id", "p_request_id"];
      if (
        !object(body) ||
        Object.keys(body).some((k) => !keys.includes(k)) ||
        keys
          .filter((k) => mode === "prepare" || k !== "p_request_id")
          .some((k) => typeof body[k] !== "string") ||
        !["invoice", "record_release"].includes(String(body.p_family)) ||
        !validGrantId(body.p_source_id) ||
        (body.p_request_id !== undefined && !validGrantId(body.p_request_id))
      )
        return unavailable(400);
      let saved = (await rpc(auth.db, "recover_document_link", {
        p_family: body.p_family,
        p_source_id: body.p_source_id,
        ...(body.p_request_id ? { p_request_id: body.p_request_id } : {}),
      })) as PreparedLink | null;
      if (mode === "prepare") {
        saved = (await rpc(auth.db, "prepare_document_link", {
          ...body,
          p_origin: saved?.grant.origin ?? deps.config.origin,
          p_key_version:
            saved?.grant.key_version ?? deps.config.activeKeyVersion,
        })) as PreparedLink;
        // Durable captured/reviewed/revoked recovery never rerenders or extends expiry.
        if (saved.grant.state === "preparing") {
          const context = (await rpc(
            deps.service,
            "document_link_capture_context",
            { p_id: saved.grant.id, p_actor_id: auth.actorId },
          )) as { grant: DocumentLinkGrant; captured: boolean };
          if (!context.captured) {
            const capability = await materializeDocumentLink(
              context.grant,
              deps.config,
            );
            const frozen = await buildDocumentLinkArtifacts(
              context.grant,
              deps.practice,
              deps.download,
              deps.readApiOriginal ? original => deps.readApiOriginal!(original, "document_link", context.grant.id, auth.actorId) : undefined,
            );
            await rpc(deps.service, "capture_document_link", {
              p_id: context.grant.id,
              p_actor_id: auth.actorId,
              p_payload_text: frozen.payload_text,
              p_token_hash: capability.token_hash,
              p_message_hash: capability.message_hash,
            });
          }
          saved = (await rpc(auth.db, "recover_document_link", {
            p_family: body.p_family,
            p_source_id: body.p_source_id,
            p_request_id: body.p_request_id,
          })) as PreparedLink;
        }
      }
      if (!saved) return json(null);
      if (saved.grant.actor_id !== auth.actorId)
        throw new Error("Actor mismatch");
      const materialized = await materializeDocumentLink(
        saved.grant,
        deps.config,
      );
      if (
        saved.message_hash !== null &&
        !constantTimeText(saved.message_hash, materialized.message_hash)
      )
        throw new Error("Materialized message differs");
      // Transient response only. Never persist this URL/message in DB, audit, cache or logs.
      return json({
        ...saved,
        client_url: materialized.client_url,
        materialized_message: materialized.materialized_message,
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      return json(
        {
          error: "Document link preparation or recovery unavailable",
          code: ["23514", "23505", "42501"].includes(code || "")
            ? code
            : "document_link_unconfirmed",
          retry_requires_recovery: true,
        },
        code === "23505"
          ? 409
          : code === "23514"
            ? 400
            : code === "42501"
              ? 403
              : 500,
      );
    }
  };
}
export function createRetrieveDocumentLinkHandler(
  deps: Pick<LinkDependencies, "service" | "config">,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return unavailable(405);
    if (!deps.config?.publicEnabled) return unavailable(503);
    try {
      const body = await readBody(req, 1024);
      if (
        !object(body) ||
        Object.keys(body).sort().join(",") !==
          "artifact_index,grant_id,token" ||
        !validGrantId(body.grant_id) ||
        typeof body.token !== "string" ||
        !/^v1\.[A-Za-z0-9_-]{43}$/.test(body.token) ||
        (body.artifact_index !== null &&
          (!Number.isInteger(body.artifact_index) ||
            Number(body.artifact_index) < 0 ||
            Number(body.artifact_index) > 24))
      )
        return unavailable();
      const context = (await rpc(deps.service, "document_link_access_context", {
        p_id: body.grant_id,
      })) as {
        id: string;
        key_version: string;
        origin: string;
        capability_context: string;
        token_hash: string;
      };
      const capability = await materializeDocumentLink(
        { ...context, message_template: "{{document_link}}" },
        deps.config,
      );
      if (
        !constantTimeText(capability.token, body.token) ||
        !constantTimeText(capability.token_hash, context.token_hash)
      )
        return unavailable();
      const value = (await rpc(deps.service, "retrieve_document_link", {
        p_id: body.grant_id,
        p_token_hash: capability.token_hash,
        p_artifact_index: body.artifact_index,
      })) as Record<string, unknown>;
      if (body.artifact_index === null) {
        if (
          value.grant_id !== body.grant_id ||
          typeof value.expires_at !== "string" ||
          !Number.isFinite(Date.parse(value.expires_at)) ||
          !Array.isArray(value.manifest) ||
          value.manifest.length < 1 ||
          value.manifest.length > 25
        )
          return unavailable();
        const manifest = value.manifest.map((item, index) => {
          if (
            !object(item) ||
            item.index !== index ||
            typeof item.filename !== "string" ||
            !/^[A-Za-z0-9 _.-]{1,180}$/.test(item.filename) ||
            ![
              "text/html",
              "application/pdf",
              "image/jpeg",
              "image/png",
            ].includes(String(item.mime_type)) ||
            !Number.isSafeInteger(item.file_size) ||
            Number(item.file_size) < 1 ||
            Number(item.file_size) > 20971520 ||
            typeof item.sha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(item.sha256)
          )
            throw new Error("Manifest invalid");
          return {
            index,
            filename: item.filename,
            mime_type: item.mime_type,
            file_size: item.file_size,
            sha256: item.sha256,
          };
        });
        return json({
          grant_id: value.grant_id,
          expires_at: value.expires_at,
          manifest,
        });
      }
      if (
        typeof value.content !== "string" ||
        typeof value.filename !== "string" ||
        typeof value.mime_type !== "string" ||
        !["text/html", "application/pdf", "image/jpeg", "image/png"].includes(
          value.mime_type,
        ) ||
        !Number.isSafeInteger(value.file_size) ||
        Number(value.file_size) < 1 ||
        Number(value.file_size) > 20971520 ||
        typeof value.sha256 !== "string"
      )
        return unavailable();
      const raw = atob(value.content),
        bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      if (
        bytes.length !== value.file_size ||
        !constantTimeText(await sha256Hex(bytes), value.sha256)
      )
        return unavailable();
      const filename = value.filename
        .replace(/[^A-Za-z0-9 _.-]/g, "_")
        .slice(0, 180);
      return new Response(bytes, {
        headers: {
          ...headers,
          "Content-Type": value.mime_type,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Security-Policy":
            "default-src 'none'; sandbox; frame-ancestors 'none'",
          "Content-Length": String(bytes.length),
        },
      });
    } catch {
      return unavailable();
    }
  };
}
