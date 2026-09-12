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
          ? JSON.stringify({
              from: metadata.from,
              reply_to: metadata.reply_to,
              to: [row.recipient],
              subject: row.subject,
              text: row.body,
            })
          : new URLSearchParams({
              From: metadata.from,
              To: row.recipient,
              Body: row.body,
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
