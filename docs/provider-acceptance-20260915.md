# Provider acceptance checkpoint — September 15, 2026

## Stripe sandbox recovered

A fresh connector call returns `The Living Room Vet sandbox`, account `acct_1UF1ewGUaxUNX5Ol`, `livemode=false`. This supersedes the expired-authorization blocker in earlier rehearsal notes. No payment or refund was performed.

A provider endpoint read finds one webhook, `we_1UFEiWGUaxUNX5OlbNtD6lHW`, status disabled, API version `2026-08-26.dahlia`, targeting the primary project `mgadheotkdnrsatfivjy`. It is not a staging webhook and was not changed. Fresh staging SQL confirms zero payment-provider profiles.

The current Supabase CLI reports no access token; database MCP reads work. Connector access does not supply the application's Stripe secret key. The owner has been asked to save the sandbox key as STRIPE_SECRET_KEY directly in staging Edge Function secrets, never in chat. No key was generated, exposed or copied during this checkpoint.

Fresh source retrieval also verified all four staging payment functions (`invoice-checkout`, `invoice-refund`, `stripe-webhook`, `process-stripe-events`) at version 8. All 36 returned file instances match the current merged source exactly. Checkout/refund have gateway JWT verification enabled; webhook/worker rely on their explicit signature/worker authentication and have gateway verification disabled. This verifies deployed code parity, not runtime secrets or provider acceptance.

### Remaining bounded acceptance procedure

1. Provision staging-only runtime key and exact sandbox account/mode/return origin. Verify deployed handler source and disabled gates before activation. Do not repoint the primary webhook.
2. Configure the existing service-only payment-provider RPC for the stable staging origin and the verified sandbox account. Register a separate matching staging webhook and securely save its signing secret, with only supported event types.
3. Enable the required payment/webhook/worker gates only for the controlled sandbox rehearsal. Use the retained USD1.00 PILOT TEST invoice and authenticated staff workflow; do not synthesize ledger payment evidence.
4. Create and complete hosted Checkout using Stripe test payment data. Verify signed webhook receipt, provider reconciliation, one captured payment and zero duplicate ledger effects on replay/recovery.
5. Record the reviewed accounting credit before preparing a refund. Verify the application refund request against the actual provider refund and resulting invoice balance; pending status is not settled cash.
6. Verify checkout return/status access boundaries, expired/failed flow and retry recovery. Record sanitized object IDs and assertions, then restore gates. No real money or client messages are part of this rehearsal.

This procedure is pending, not an acceptance receipt.

## ezyVet bounded read accepted

Before the vendor response, an authenticated staging request processed one contact page and persisted 50 snapshots. Database evidence showed one run/one page, next_page 2, no error code, zero mappings, one unchanged synthetic client/pet and zero outbox rows. A running scan with another page available is not a completed source migration. Import mode was restored to disabled.

The owner subsequently authorized temporary continued use of the current credentials without changing the current setup while they coordinate dedicated registration with ezyVet. They now prefer selective two-way integration. Current runtime remains read-only. The representative's quote and published write-back recurring fee need reconciliation; the owner manages correspondence. See [the current handoff](ezyvet-existing-connection-handoff.md).

No original client data, raw source payload, API key or authentication artifact is included in this document.
