# Authentication callbacks in the shared Resend team

The Resend webhook can separate authentication delivery statuses from client-outbox statuses using an explicitly reserved sender. This is inactive unless `RESEND_AUTH_FROM_ADDRESS` is configured on the server.

## Contract

- Svix signature verification and email resource/event validation occur before sender classification. Resend documents the sender in its [signed event payload](https://www.resend.com/changelog/webhook-event-visibility).
- `RESEND_AUTH_FROM_ADDRESS` must be one bare mailbox reserved exclusively for Supabase Auth. It must never have been used for client-outbox sends. Confirm that reservation and the exact SMTP sender during commissioning.
- `RESEND_FROM` must identify a different valid client sender. The inbound receiving allowlist must not include the Auth sender. Invalid or overlapping configuration returns503 rather than acknowledging an ambiguous event.
- Only supported outbound sent/delivered/bounced/complained/failed statuses with that exact signed sender are acknowledged as authentication events. Recipients, subjects, message bodies and recovery links are not written to the client ledger. Authentication delivery history and bounce monitoring remain in the private provider dashboard.
- Every other outbound status still uses the existing durable client receipt path. A callback arriving before its client-outbox receipt is saved continues to return503 for provider retry. Unconfigured separation preserves this behavior.
- Incoming mail from the reserved Auth sender is not accepted as a client reply. Other inbound messages retain the existing exact client-recipient allowlist. Private staff/root mail must stay outside that allowlist and outside client-domain MX routing.

This classification is a sender-configuration boundary, not independent proof of a Supabase Auth transaction. Access to the reserved sender/credentials must remain restricted to Auth. Do not reuse the address for unrelated mail, infer purpose from the recipient, or enable this before checking historical sender use.

## Evidence and remaining acceptance

All28 inbound tests pass, including seven new scenarios covering five Auth status families, semantic duplicates, unknown/malformed/misleading client senders, known-client persistence, default-off behavior, ambiguous configuration, private inbound rejection and invalid signatures. TypeScript, focused lint and the Resend Edge entrypoint Deno check pass. Fixtures contain only synthetic mail and signatures; no provider messages were sent.

On September 13, 2026, all three PR114 CI jobs passed at `0b7dc592f62efdeec3a18f3fb187ba9058dbf4ca` (run34779084073). The tested webhook was deployed to staging `kothoqicubowyhwfsrte` as version3. A post-deployment download matched all five source files exactly. A secret-name-only preflight found no `RESEND_` settings, and an unsigned POST returned503 `Webhook unavailable`, confirming the unconfigured endpoint does not acknowledge events. No provider settings or secrets were changed and no messages were sent. The owner-selected payment backend and public site were not redeployed.

Authentication separation remains unconfigured. Commission the private owner mailbox, reserved Auth sender/domain, custom SMTP, callback secrets and exact redirects first. Then run an explicitly authorized invitation/reset and non-clinical client callback test, including lost client receipts. Confirm Auth activity stays in the provider dashboard, unknown client callbacks retry, and no Auth content reaches the hub. Mailbox/DNS/provider acceptance, delivery monitoring and commercial launch remain incomplete.
