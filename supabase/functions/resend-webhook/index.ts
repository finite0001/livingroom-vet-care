import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

// Retired 2026-09-27: Resend is outbound only. Client replies arrive through
// AgentMail (agentmail-inbound-webhook) and Resend delivery/status receipts go
// to resend-delivery-webhook, which has its own signing secret. This slug must
// not be registered in the Resend dashboard; it touches no database or secret.
serveDisabledLegacyFunction({
  slug: "resend-webhook",
  replacement: "resend-delivery-webhook (delivery status) and agentmail-inbound-webhook (client replies)",
});
