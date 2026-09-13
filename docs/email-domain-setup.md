# Email domain setup — sending DNS saved and verified

## Current preparation

Resend domain `thelivingroom.vet` was created through the existing signed-in account on 2026-09-12. Domain ID: `d0425972-bcaa-4a5b-ba4a-5566bdec519c`; region: `us-east-1`. After the owner-approved DNS save and verification request, Resend now reports **Verified** and that the domain is ready to send emails. Sending is requested On; **receiving is saved Off**. The onboarding screen showed proposed receiving DNS but did not persist receiving activation.

The three sending-verification DNS records below are now saved and confirmed through authoritative DNS. Sending-domain verification has completed; no webhook was configured, API key created or message sent. Mailbox names remain unpublished. Domain registration in Resend alone does not establish working practice email or Supabase Auth SMTP.

TLS was changed from Opportunistic to **Enforced** and visibly saved. Recipient servers that cannot negotiate TLS will fail delivery rather than receive an unencrypted message. No tracking subdomain was configured and the new tracking form was not submitted. No click/open tracking was enabled by this preparation; the exact effective tracking behavior remains a controlled-message verification gate, not an inferred Off flag. The account banner concerning shared tracking on two other domains was left unchanged.

The domain occupies the tenth of ten domain slots on the existing Pro account. No billing upgrade or charge flow was performed.

## Saved GoDaddy records for sending verification

The following exact values were supplied by the Resend domain UI and saved with the owner's approval on 2026-09-12. The saved GoDaddy rows display **1 hour (3,600 seconds)**, despite the earlier form's 30-minute default. Queries directed to authoritative nameserver `ns07.domaincontrol.com` confirmed all three record values. Host labels below are relative to `thelivingroom.vet`.

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

The signed-in GoDaddy domain settings were accessible and showed these seven existing records. These form the preserved baseline preceding the three additions:

| Type | Host | Existing value | TTL |
| --- | --- | --- | --- |
| A | `@` | GoDaddy `Parked` | 600 seconds |
| NS | `@` | `ns07.domaincontrol.com.` | 1 hour |
| NS | `@` | `ns08.domaincontrol.com.` | 1 hour |
| CNAME | `www` | `thelivingroom.vet.` | 1 hour |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com.` | 1 hour |
| SOA | `@` | Primary nameserver `ns07.domaincontrol.com.` | 1 hour |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | 1 hour |

Before the save there were no MX records and no existing `send` or `resend._domainkey` records. After the owner authorized saving and verification, GoDaddy displayed **10 records**: the seven preserved baseline entries and the three correct sending-verification entries above. Authoritative DNS queries confirmed the DKIM TXT, sending-subdomain MX (priority 10) and SPF TXT values.

Resend's verification action was then submitted. After reloading, its status changed from Pending to **Verified**, with the confirmation that the domain is ready to send emails. Enforced TLS was also rechecked. Sending remains requested On and receiving remains saved Off. The parked website, nameservers and existing DMARC policy were preserved. No root-domain MX, webhook, API key or provider send was added by this step.

The owner's `admin@` response was interpreted and stated as **`admin@thelivingroom.vet`** for the intended first administrator. This records intended account setup only: no mailbox or Supabase Auth account has been created. Mailbox publication, receiving and Auth SMTP remain separate commissioning tasks.

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

See [messaging environments](messaging-environments.md), [inbound processing](inbound-communications.md), [deployment runbook](deployment-runbook.md) and [commercial-readiness tracker](commercial-readiness.md). The sending DNS additions are saved and authoritative values are confirmed. Resend sending-domain verification is complete; inboxes, Auth SMTP and application delivery have not been commissioned.
