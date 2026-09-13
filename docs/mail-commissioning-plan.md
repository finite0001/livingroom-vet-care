# Practice mail commissioning proposal

Status: prepared for owner review, 2026-09-13. No provider account, purchase, credential, webhook, mailbox, DNS write or message has been created by this proposal. Existing sending verification remains intact.

## Proposed routing

| Purpose | Address | Service and boundary |
| --- | --- | --- |
| Owner administration | `admin@thelivingroom.vet` | Private Fastmail business mailbox; owner access and recovery, never forwarded to the client inbox |
| Individual staff mail | Named addresses at `thelivingroom.vet` | Separate identities/mailboxes as staff are designated; no shared password |
| Practice client communication | `care@reply.thelivingroom.vet` | Dedicated Living Room Vet Resend team, sending and receiving; only its client events reach the application webhook |
| Login and password reset | `access@auth.thelivingroom.vet` | Dedicated Postmark transactional server/stream used by Supabase Auth; no callback route into the client inbox |

Fastmail is the proposed human mailbox provider; the practice application remains the client inbox. The proposed client sender and Reply-To can initially use the same verified reply-subdomain address, avoiding transfer of the existing root verification. A later `hello@thelivingroom.vet` public alias needs deliberate forwarding and an actual end-to-end test before publication. Do not enable a root catch-all into the client inbox.

## Why separate the mail flows

Current `receiveResend` accepts supported status events and passes them to `receive_communication_event`. That SQL function rejects status events without a matching outbox provider-message ID; the handler returns503 so a callback racing the sending worker's receipt can be retried. Auth SMTP messages and other projects' messages have no such outbox row. Globally acknowledging unknown IDs would weaken this existing delivery-recovery contract.

Resend's [multi-tenant guidance](https://resend.com/docs/knowledge-base/setting-up-resend-for-multi-tenants) describes application routing for shared-account events and isolation with separate accounts. The [create-webhook API](https://resend.com/docs/api-reference/webhooks/create-webhook) documents event selection, not a domain filter. A domain-restricted sending key alone is not webhook isolation. Therefore the existing ten-domain team plus a capacity add-on is not the proposed client deployment.

The inbound handler requires exactly one allowed recipient in the signed event and agreement with the fetched message. Set `RESEND_INBOUND_ADDRESSES` only to the explicit client address; never include admin or named staff mailboxes. Forwarding from a root alias must prove the actual signed/fetched recipient behavior rather than assuming the forwarding destination replaces the original recipient.

## Costs and alternatives requiring a checkout review

- A dedicated Resend Pro client team is publicly listed at $20/month. Additional team creation [documents a paid-plan step](https://resend.com/blog/multiple-teams); do not promise another free team. Check actual account checkout, tax and included receiving/domain limits before purchase. [Pricing](https://resend.com/pricing).
- Postmark publicly lists a $15/month Basic plan and a 100-email/month evaluation allowance. Evaluation is not a production capacity decision; unrestricted recipient sending also requires account approval. Use stream-specific SMTP credentials, not a human mailbox password. [Pricing](https://postmarkapp.com/pricing), [SMTP credentials](https://postmarkapp.com/support/article/811-what-are-the-smtp-details-api-tokens-i-should-be-using), [account approval](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work).
- A second, Auth-only Resend team is an alternative that reduces vendor count; budget its published paid plan separately rather than assuming free entitlement. Its API keys, domains and callbacks must remain separate from the client team.
- Fastmail mailbox count, billing term and current checkout price remain unquoted. Obtain the exact business-plan quote for one initial owner mailbox, then add named staff deliberately. [Business pricing](https://www.fastmail.com/pricing/us/).

The proposed paid client-plus-Auth transport budget is therefore $35/month before mailbox fees/tax, based on public prices rather than a binding account quote. No new mail-service charge is approved or submitted here. This is separate from the pending additional $10/month Supabase staging proposal.

## Commissioning sequence and evidence

1. Owner selects the mailbox and transport topology; inspect exact account quotes before paid creation. Establish owner MFA/recovery and record account/team IDs without storing secrets in Git. Keep the admin recovery mailbox private.
2. Generate actual provider DNS instructions. For root mail, use the private provider's root MX and generated DKIM/SPF; for Resend use only `reply` receiving and its generated sending records; for Auth use the verified `auth` subdomain. Preserve website records, existing `send` MX/SPF, `resend._domainkey` and DMARC quarantine. Maintain one SPF policy per hostname; never copy a generic permissive DMARC example over the existing policy. [Fastmail domain setup](https://www.fastmail.help/hc/en-us/articles/1500000280261-Setting-up-your-domain-MX-only), [Resend receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains).
3. Save only the reviewed authorized DNS changes and confirm authoritative answers plus provider verification. Root and reply MX were both absent in the fresh read-only check; that observation must be repeated at cutover.
4. Configure Supabase custom SMTP with the dedicated Auth sender and exact approved site/reset URLs. Its default SMTP is not the production staff-mail solution. Prove an authorized invitation/reset reaches only the intended private mailbox and completes on the selected environment. Check that no Auth message appears in the client inbox or its processing queue. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
5. Configure the dedicated client team's server-only API key and webhook signing secret on the commissioned backend. Select only the six supported events: received, sent, delivered, bounced, complained and failed. Set From/Reply-To/receiving allowlist to the reviewed client address. Keep sends disabled until explicit controlled-recipient acceptance.
6. Run an authorized synthetic client send/reply, attachment, delivery callback, duplicate callback and unknown-sender review through the actual hosted application. Confirm provider and application receipts, recipient identity, privacy, suppression, TLS and effective tracking behavior. Verify another service's events do not enter this webhook. Retain redacted evidence; don't send clinical records as test fixtures.
7. Publish the tested contact address only after operator acceptance. Record ownership, failure monitoring and recovery instructions. Preserve pending outbox receipts during any later team/key change; the application's single Resend key currently serves both sending and receiving, so historical events cannot be silently switched to another account.

## Recovery and remaining gates

Before routing changes, privately record the exact old DNS and provider configuration. If verification fails, pause the cutover; keep application sends disabled and preserve durable receipts. Do not remove a working mailbox or rotate away the only key able to retrieve pending messages. Returning MX to a prior value affects future routing and does not recover messages already accepted elsewhere.

This plan does not authorize invitations, provider tests, account purchases or root mail cutover. The existing user approval covered only the three completed sending-verification DNS records. Hosted staging, staff identities, clinical approval and payment/SMS commissioning remain separate rollout gates.
