import {
  buildInvoiceEmailPayload,
  type InvoiceEmailIntent,
} from "./invoice-email-payload.ts";
import type { InvoiceEmailBundle } from "./invoice-email-payload.ts";
import type { InvoicePractice } from "./invoice-document.ts";
export interface InvoiceEmailDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface PreparedInvoiceEmail {
  request: InvoiceEmailIntent & { state: string };
  payload_hash: string | null;
  manifest: unknown[] | null;
  report_html: string | null;
  receipt: unknown | null;
}
export interface InvoiceEmailPreparationDependencies {
  authenticate: (
    token: string,
  ) => Promise<{ actorId: string; db: InvoiceEmailDatabase } | null>;
  service: InvoiceEmailDatabase;
  practice: InvoicePractice;
  sender: { from: string; replyTo: string };
}
async function rpc(
  db: InvoiceEmailDatabase,
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
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
export function createPrepareInvoiceEmailHandler(
  deps: InvoiceEmailPreparationDependencies,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer "))
      return json({ error: "Staff authorization required" }, 401);
    try {
      const auth = await deps.authenticate(authorization.slice(7));
      if (!auth) return json({ error: "Staff authorization required" }, 401);
      const text = await req.text();
      if (new TextEncoder().encode(text).length > 450000)
        return json({ error: "Email intent too large" }, 413);
      const args = JSON.parse(text);
      const keys = [
        "p_request_id",
        "p_invoice_id",
        "p_client_id",
        "p_recipient",
        "p_conversation_id",
        "p_subject",
        "p_body",
        "p_invoice_hash",
      ];
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).some((k) => !keys.includes(k)) ||
        keys.some((k) => typeof args[k] !== "string")
      )
        return json({ error: "Exact invoice email intent required" }, 400);
      const prepared = (await rpc(
        auth.db,
        "prepare_invoice_email",
        args,
      )) as PreparedInvoiceEmail;
      // A recorded queue receipt settles an ambiguous retry; never capture or queue again here.
      if (prepared.receipt) return json(prepared);
      const context = (await rpc(
        deps.service,
        "invoice_email_capture_context",
        { p_request_id: args.p_request_id, p_actor_id: auth.actorId },
      )) as {
        request: InvoiceEmailIntent;
        bundle: InvoiceEmailBundle;
        captured: boolean;
      };
      if (!context.captured) {
        const frozen = await buildInvoiceEmailPayload(
          context.request,
          context.bundle,
          deps.sender,
          deps.practice,
        );
        await rpc(deps.service, "capture_invoice_email_payload", {
          p_request_id: args.p_request_id,
          p_actor_id: auth.actorId,
          p_payload_text: frozen.payload_text,
        });
      }
      return json(
        await rpc(auth.db, "recover_invoice_email", {
          p_invoice_id: args.p_invoice_id,
          p_request_id: args.p_request_id,
        }),
      );
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // Never return provider payloads, private paths, base64 or SQL diagnostic context.
      return json(
        {
          error:
            code === "42501"
              ? "Invoice or household authorization is unavailable."
              : code === "23505"
                ? "Recover the existing invoice email; its intent or bytes are already fixed."
                : code === "23514"
                  ? "Invoice email validation failed. Check the issued invoice and attachment limits."
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
