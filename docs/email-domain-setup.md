# Email domain setup — proposed DNS, not activated

## Current preparation

Resend domain `thelivingroom.vet` was created through the existing signed-in account on 2026-09-12. Domain ID: `d0425972-bcaa-4a5b-ba4a-5566bdec519c`; region: `us-east-1`. Saved domain state is `NotStarted` / unverified. Sending is requested On; **receiving is saved Off**. The onboarding screen showed proposed receiving DNS but did not persist receiving activation.

No DNS records were changed, domain verification completed, webhook configured, API key created or messages sent as part of this preparation. Mailbox names remain unpublished. Domain registration in Resend alone does not establish working practice email or Supabase Auth SMTP.

TLS was changed from Opportunistic to **Enforced** and visibly saved. Recipient servers that cannot negotiate TLS will fail delivery rather than receive an unencrypted message. No tracking subdomain was configured and the new tracking form was not submitted. No click/open tracking was enabled by this preparation; the exact effective tracking behavior remains a controlled-message verification gate, not an inferred Off flag. The account banner concerning shared tracking on two other domains was left unchanged.

The domain occupies the tenth of ten domain slots on the existing Pro account. No billing upgrade or charge flow was performed.

## Proposed GoDaddy records for sending verification

The following exact values were supplied by the pending Resend domain UI and rechecked on 2026-09-12. GoDaddy's new-record form defaults to **1/2 Hour (1,800 seconds)**; the three prepared, unsaved rows use that default. Enter host labels as shown rather than appending the domain twice.

| Type | GoDaddy host/name | Value / destination | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey` | Public DKIM key below | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

DKIM TXT value (public verification material, not a credential):

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC2s9/FPhv2kCpQTVy9xKLLXpNZ/zcCy9No/FRYFxnSV8b0b8FioQCalfpXQ7UDaTxIdOddDhHOB548cGr7u/5k7OG0nKJlQAQRLrS4KqMmhUQ4VHFibPnYYV7tCcdZgsXmw2tPFfhSl3W506qhCS8gJJkriyyOoQftUfa+lHCODQIDAQAB
```

The `send` MX/TXT entries configure the provider's sending subdomain; they do not route incoming mail for the root domain. Do not substitute `@` for `send` on those rows. Compare existing records first and resolve conflicts explicitly; preserve unrelated DNS, website records and newly configured mail services.

## GoDaddy review checkpoint — 2026-09-12

The signed-in GoDaddy domain settings were accessible and showed these seven existing records. This is the current read-only checkpoint, not a new zone configuration:

| Type | Host | Existing value | TTL |
| --- | --- | --- | --- |
| A | `@` | GoDaddy `Parked` | 600 seconds |
| NS | `@` | `ns07.domaincontrol.com.` | 1 hour |
| NS | `@` | `ns08.domaincontrol.com.` | 1 hour |
| CNAME | `www` | `thelivingroom.vet.` | 1 hour |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com.` | 1 hour |
| SOA | `@` | Primary nameserver `ns07.domaincontrol.com.` | 1 hour |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | 1 hour |

There were no MX records and no existing `send` or `resend._domainkey` records. Resend still showed Not Started, sending requested On and receiving Off. All three proposed sending rows were entered into GoDaddy's **unsaved** form and visually checked; Save All Records and Resend verification were not submitted. The form alone does not alter DNS and may expire. Recheck both the zone and provider values immediately before any authorized save.

The proposed change adds only those three rows. It preserves the parked website, nameservers, root mail routing and existing DMARC policy. Root receiving, website cutover, mailbox publication and application sending remain separate decisions. No registrant contact information is included in this checkpoint.

## Root-domain receiving — reviewed mail-routing cutover only

| Type | GoDaddy host/name | Value / destination | Priority |
| --- | --- | --- | --- |
| MX | `@` | `inbound-smtp.us-east-1.amazonaws.com` | 10 |

**Do not apply this root MX record merely to prepare sending.** It routes incoming domain email and belongs in a reviewed mail-routing cutover with an agreed receiving workflow and recovery plan. Receiving is currently saved Off in Resend; any later activation must be reviewed alongside this routing change. The earlier read-only DNS query returned no MX answers on 2026-09-12; that is a dated observation, not authorization to replace records. Recheck immediately before any write and preserve any mail records added since that query. Confirm the intended effect with the domain owner before changing existing routing.

## Verification and publication gates

1. Recheck current authoritative DNS and the Resend domain's exact requested records. Record the existing values and review the proposed changes before an authorized write.
2. After authorized sending-record changes, verify propagation and Resend's actual verified status. Keep outbound disabled until application sender configuration and the controlled recipient test are approved.
3. Commission the signed inbound webhook and authenticated receiving/read API worker, with durable attachment/content ingestion, idempotency, sender/household review, retry handling and a recoverable failure queue. A registered domain is not a shared mailbox, and webhook registration alone does not prove ingestion works.
4. Test an authorized synthetic inbound message and an authorized controlled outgoing message, including reply routing, attachments, delivery status, enforced-TLS behavior and actual click/open-tracking behavior. Retain evidence before advertising a contact mailbox. No such messages have been sent by this setup step.
5. Review Supabase Auth SMTP separately, including invitation/password-reset sender and return URLs. Use server secret storage for all future API keys and webhook signing secrets; the public DKIM key above does not authorize API access.
6. Perform root MX cutover only with the reviewed receiving workflow ready and an explicit operational decision. Publish mailbox names only after actual inbound/read-worker and controlled-delivery evidence is complete.

See [messaging environments](messaging-environments.md), [inbound processing](inbound-communications.md), [deployment runbook](deployment-runbook.md) and [commercial-readiness tracker](commercial-readiness.md). This document contains proposed records and acceptance steps, not evidence that DNS, inboxes or delivery are live.
