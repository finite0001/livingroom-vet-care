import {
  documentLinkConfig,
  materializeDocumentLink,
  type CapabilityGrant,
} from "./document-link-capability.ts";
import { verifyFrozenEmailPayload } from "./release-email-payload.ts";
import {
  authorizeDelivery,
  requireEmailConfiguration,
  normalizePhone,
  type DeliveryPolicyEnvironment,
} from "./delivery-policy.ts";
export interface OutboxRow {
  id: string;
  channel: "EMAIL" | "SMS";
  recipient: string;
  subject: string;
  body: string;
  provider: "resend" | "twilio";
  state: string;
  lease_token: string;
  provider_config: Record<string, string> | null;
}
export interface OutboxEnvironment extends DeliveryPolicyEnvironment {
  DOCUMENT_LINK_ORIGIN?: string;
  DOCUMENT_LINK_ACTIVE_KEY_VERSION?: string;
  DOCUMENT_LINK_KEYS?: string;
  DOCUMENT_LINK_PUBLIC_ENABLED?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}
export interface OutboxDatabase {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
interface Outcome {
  outcome: "accepted" | "failed" | "uncertain";
  providerId: string | null;
  errorCode: string | null;
}
async function call(
  db: OutboxDatabase,
  name: string,
  args?: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function dispatchOne(
  db: OutboxDatabase,
  env: OutboxEnvironment,
  transport: typeof fetch = fetch,
) {
  // An intentionally disabled installation retains pending work without claiming or sending it.
  if (!env.OUTBOUND_DELIVERY_MODE || env.OUTBOUND_DELIVERY_MODE === "disabled")
    return { processed: false, disabled: true };
  const row = (await call(db, "claim_communication")) as OutboxRow | null;
  if (!row?.id) return { processed: false };
  let metadata: Record<string, string>;
  let authorization: string;
  let endpoint: string;
  let frozenEmailPayload: string | null = null;
  let materializedSms: string | null = null;
  try {
    authorizeDelivery(env, row.channel, row.recipient);
    if (row.channel === "EMAIL") {
      const config = requireEmailConfiguration(env);
      metadata = { from: config.from, reply_to: config.replyTo };
      authorization = `Bearer ${config.apiKey}`;
      endpoint = "https://api.resend.com/emails";
    } else {
      const from = normalizePhone(env.TWILIO_FROM_NUMBER);
      if (
        !/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID ?? "") ||
        !env.TWILIO_AUTH_TOKEN?.trim() ||
        !from
      )
        throw new Error("SMS configuration unavailable");
      metadata = { from, account_sid: env.TWILIO_ACCOUNT_SID! };
      authorization = `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
      endpoint = `https://api.twilio.com/2010-04-01/Accounts/${metadata.account_sid}/Messages.json`;
    }
    if (
      row.provider_config &&
      JSON.stringify(Object.entries(row.provider_config).sort()) !==
        JSON.stringify(Object.entries(metadata).sort())
    )
      throw new Error("Sender metadata changed");
    if (row.channel === "SMS") {
      const link = (await call(db, "document_link_delivery_context", {
        p_outbox_id: row.id,
        p_lease_token: row.lease_token,
      })) as {
        grant: CapabilityGrant;
        token_hash: string;
        message_hash: string;
        artifact_hash: string;
      } | null;
      if (link) {
        const config = documentLinkConfig({
          origin: env.DOCUMENT_LINK_ORIGIN,
          activeKeyVersion: env.DOCUMENT_LINK_ACTIVE_KEY_VERSION,
          keys: env.DOCUMENT_LINK_KEYS,
          publicEnabled: env.DOCUMENT_LINK_PUBLIC_ENABLED,
        });
        if (!config.publicEnabled || link.grant.message_template !== row.body) {
          throw new Error("Document link unavailable");
        }
        const materialized = await materializeDocumentLink(link.grant, config);
        if (
          materialized.token_hash !== link.token_hash ||
          materialized.message_hash !== link.message_hash ||
          materialized.materialized_message.length > 1600
        ) {
          throw new Error("Reviewed document message differs");
        }
        materializedSms = materialized.materialized_message;
        metadata.document_link_token_hash = materialized.token_hash;
        metadata.document_link_message_hash = materialized.message_hash;
        metadata.document_link_artifact_hash = link.artifact_hash;
      }
    }
    const frozen = (await call(db, "read_frozen_email_payload", {
      p_outbox_id: row.id,
      p_lease_token: row.lease_token,
    })) as {
      payload_text: string;
      payload_hash: string;
      artifact_kind?: string;
    } | null;
    if (frozen) {
      if (row.channel !== "EMAIL")
        throw new Error("Frozen attachments require email");
      frozenEmailPayload = await verifyFrozenEmailPayload(frozen, {
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        from: metadata.from,
        replyTo: metadata.reply_to,
      });
      if (frozen.artifact_kind === "invoice")
        metadata.invoice_payload_hash = frozen.payload_hash;
    }
  } catch {
    await call(db, "release_communication_claim", {
      p_id: row.id,
      p_lease_token: row.lease_token,
      p_error_code: "delivery_policy_or_configuration_blocked",
    });
    return { processed: true, outbox_id: row.id, state: "failed" };
  }
  const started = (await call(db, "start_communication_attempt", {
    p_id: row.id,
    p_lease_token: row.lease_token,
    p_provider_config: metadata,
  })) as OutboxRow;
  if (started.state !== "claimed")
    return { processed: true, outbox_id: row.id, state: started.state };
  // Provider request data is reconstructed exclusively from immutable outbox fields.
  let outcome: Outcome;
  try {
    const response = await transport(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers:
        row.channel === "EMAIL"
          ? {
              Authorization: authorization,
              "Content-Type": "application/json",
              "Idempotency-Key": `livingroom-outbox/${row.id}`,
            }
          : {
              Authorization: authorization,
              "Content-Type": "application/x-www-form-urlencoded",
            },
      body:
        row.channel === "EMAIL"
          ? (frozenEmailPayload ??
            JSON.stringify({
              from: metadata.from,
              reply_to: metadata.reply_to,
              to: [row.recipient],
              subject: row.subject,
              text: row.body,
            }))
          : new URLSearchParams({
              From: metadata.from,
              To: row.recipient,
              Body: materializedSms ?? row.body,
            }).toString(),
    });
    if (response.ok) {
      const payload = await response.json();
      const id = row.channel === "EMAIL" ? payload?.id : payload?.sid;
      const valid =
        typeof id === "string" &&
        (row.channel === "EMAIL"
          ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id,
            )
          : /^SM[0-9a-f]{32}$/i.test(id));
      outcome = valid
        ? { outcome: "accepted", providerId: id, errorCode: null }
        : {
            outcome: "uncertain",
            providerId: null,
            errorCode: "provider_id_missing",
          };
    } else {
      const ambiguous =
        response.status >= 500 || [408, 409].includes(response.status);
      outcome = {
        outcome: ambiguous ? "uncertain" : "failed",
        providerId: null,
        errorCode: `provider_http_${response.status}`,
      };
    }
  } catch {
    outcome = {
      outcome: "uncertain",
      providerId: null,
      errorCode: "provider_transport_unknown",
    };
  }
  // If persistence fails after acceptance, leave the lease for reconciliation. Never resend here.
  await call(db, "finish_communication_attempt", {
    p_id: row.id,
    p_lease_token: row.lease_token,
    p_outcome: outcome.outcome,
    p_provider_message_id: outcome.providerId,
    p_error_code: outcome.errorCode,
  });
  return {
    processed: true,
    outbox_id: row.id,
    state: outcome.outcome,
    accepted: outcome.outcome === "accepted",
    delivered: false,
  };
}
