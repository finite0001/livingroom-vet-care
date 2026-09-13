# Practice mail commissioning plan

Status: owner selected Fastmail + one Resend team for automated client communications and authentication/security mail, 2026-09-13. Preparation is authorized; purchases are not. Do not create or purchase a second Resend team. No provider account, purchase, credential, webhook, mailbox, DNS write or message has been created by this proposal. Existing sending verification remains intact.

## Selected routing

| Purpose | Address | Service and boundary |
| --- | --- | --- |
| Owner administration | Owner-designated named administrator mailbox (confirmed privately) | Private Fastmail business mailbox; owner access and recovery, never forwarded to the client inbox; supersedes the earlier proposed `admin@` alias |
| Individual staff mail | Named addresses at `thelivingroom.vet` | Separate identities/mailboxes as staff are designated; no shared password |
| Automated non-clinical client notices | `care@reply.thelivingroom.vet` (proposed address) | One Living Room Vet Resend team for appointment reminders, portal notices, receipts, intake confirmations and non-clinical status updates; controlled reply handling remains subject to acceptance |
| Authentication and security mail | `access@auth.thelivingroom.vet` | The same Resend team, using a separate Auth sender and credentials for Supabase Auth; authentication events must be distinguished from client-outbox events |

Fastmail is the selected human mailbox provider; the practice application remains the planned unified client inbox. Resend is an application transport, not a replacement for staff mailboxes. Clinical narratives, medical-record/lab attachments and clinical replies are outside this initial transport commissioning scope. The original requirement to share records and lab results remains on the roadmap; its delivery design and acceptance must be resolved separately. Clients may include clinical information in incoming replies, so reply handling must preserve access controls and must not assume incoming content is non-clinical. The proposed client sender and Reply-To can initially use the same verified reply-subdomain address, avoiding transfer of the existing root verification. A later `hello@thelivingroom.vet` public alias needs deliberate forwarding and an actual end-to-end test before publication. Do not enable a root catch-all into the client inbox.

## Separate message purposes within one Resend team

The implementation now provides [optional reserved-sender Auth callback separation](auth-mail-webhook-separation.md). It passed CI and is deployed to staging, but remains unconfigured with no Resend secrets installed. The following paragraph describes the original unconfigured callback path and the acceptance requirement; it must remain intact for unknown client statuses.

The owner explicitly corrected the selection to Fastmail + Resend only. Do not commission Postmark or a second Resend team. Separate sender identities and least-privilege credentials remain useful within the selected team.

Current `receiveResend` passes supported status events to `receive_communication_event`, which rejects events without a matching outbox provider-message ID. The handler returns503 to preserve recovery when a callback arrives before the sending worker saves its receipt. Auth SMTP emails have no application outbox row. Before enabling shared-team Auth sending, implement and test explicit identification/routing of authentication events without globally acknowledging unknown client IDs. Sender-domain classification and provider-verified metadata are candidate approaches requiring payload validation; do not assume API-key separation isolates webhooks. Resend documents that [email tags are included in webhook events](https://resend.com/docs/dashboard/emails/tags), but whether the selected Supabase Auth transport can supply the necessary tags remains to be verified.

The inbound handler must retain its explicit client-recipient allowlist. Never route private admin or named staff mailboxes into the client inbox. Keep client delivery receipt retries, duplicate handling and unknown-sender review intact.

## Costs and alternatives requiring a checkout review

- A dedicated Resend Pro client team is publicly listed at $20/month. Additional team creation [documents a paid-plan step](https://resend.com/blog/multiple-teams); do not promise another free team. Check actual account checkout, tax and included receiving/domain limits before purchase. [Pricing](https://resend.com/pricing).
- Fastmail mailbox count, billing term and current checkout price remain unquoted. Obtain the exact business-plan quote for one initial owner mailbox, then add named staff deliberately. [Business pricing](https://www.fastmail.com/pricing/us/).

The earlier $35/month combined transport estimate is superseded because Postmark is removed. Obtain the exact quote for one Resend team plus Fastmail mailboxes; no mail purchase is authorized. The separately approved Supabase staging project has already been created and does not authorize mail charges.

## Commissioning sequence and evidence

1. The owner has selected the topology above. Prepare exact account quotes for review before any purchase or paid creation. Establish owner MFA/recovery and record account/team IDs without storing secrets in Git. Keep the admin recovery mailbox private.
2. Generate actual provider DNS instructions. For root mail, use the private provider's root MX and generated DKIM/SPF; for Resend use only `reply` receiving and its generated sending records; for Auth use the verified `auth` subdomain. Preserve website records, existing `send` MX/SPF, `resend._domainkey` and DMARC quarantine. Maintain one SPF policy per hostname; never copy a generic permissive DMARC example over the existing policy. [Fastmail domain setup](https://www.fastmail.help/hc/en-us/articles/1500000280261-Setting-up-your-domain-MX-only), [Resend receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains).
3. Save only the reviewed authorized DNS changes and confirm authoritative answers plus provider verification. Root and reply MX were both absent in the fresh read-only check; that observation must be repeated at cutover.
4. Configure Supabase custom SMTP with the dedicated Auth sender and exact approved site/reset URLs. Its default SMTP is not the production staff-mail solution. Prove an authorized invitation/reset reaches only the intended private mailbox and completes on the selected environment. Check that no Auth message appears in the client inbox or its processing queue. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
5. Configure the dedicated client team's server-only API key and webhook signing secret on the commissioned backend. Select only the six supported events: received, sent, delivered, bounced, complained and failed. Set From/Reply-To/receiving allowlist to the reviewed client address. Keep sends disabled until explicit controlled-recipient acceptance.
6. Run an authorized synthetic non-clinical client send/reply, non-clinical attachment, delivery callback, duplicate callback and unknown-sender review through the actual hosted application. Confirm provider and application receipts, recipient identity, privacy, suppression, TLS and effective tracking behavior. Verify Auth events are safely distinguished from client events and never enter the client inbox. Verify unknown client receipt events still retry correctly. Retain redacted evidence; don't send clinical records as test fixtures.
7. Publish the tested contact address only after operator acceptance. Record ownership, failure monitoring and recovery instructions. Preserve pending outbox receipts during any later team/key change; the application's single Resend key currently serves both sending and receiving, so historical events cannot be silently switched to another account.

## Recovery and remaining gates

Before routing changes, privately record the exact old DNS and provider configuration. If verification fails, pause the cutover; keep application sends disabled and preserve durable receipts. Do not remove a working mailbox or rotate away the only key able to retrieve pending messages. Returning MX to a prior value affects future routing and does not recover messages already accepted elsewhere.

This plan does not authorize invitations, provider tests, account purchases or root mail cutover. The existing user approval covered only the three completed sending-verification DNS records. Staging frontend commissioning, staff identities, clinical approval and payment/SMS commissioning remain separate rollout gates.
