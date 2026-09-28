# AgentMail inbound email

**Owner decision, 2026-09-27.** Email is split by direction:

| Direction | Provider | What it covers |
| --- | --- | --- |
| Outbound app email | **Resend** | conversations, invoices, record releases, payment links, reminders (`dispatch-outbox`) |
| Inbound app email | **AgentMail** | client replies and new client email into `/hub/chats` threads and the `/hub/inbox/review` queue |
| Staff human mail | **Fastmail** | `dave@thelivingroom.vet` and aliases `admin@`, `hello@`, `billing@`, `care@`, `access@`. The root MX stays on Fastmail. |

Resend receiving is retired. `resend-webhook` is an inert HTTP 410 stub, and `resend-delivery-webhook` handles only Resend delivery, bounce, complaint and failure receipts, using its own signing secret. The legacy `send-email` and `send-sms` functions are deleted.

## Flow

```text
client replies to an app email (Reply-To = AgentMail inbox)
  -> AgentMail inbox
  -> POST agentmail-inbound-webhook   (Svix proof, 5-minute window, inbox check)
       receive_communication_event('agentmail', svix-id, derived UUID, 'inbound', {from,to,inbox_id,message_id,...})
  -> process-inbound worker (scheduler, managed server key)
       GET https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/{message_id}
       normalizeAgentMailMessage -> complete_inbound_communication
         exact household match by sender email, RFC In-Reply-To/References threading,
         otherwise the household's active conversation, otherwise review
  -> staff opens the thread; attachments captured on demand
       capture-inbound-attachment -> claim_inbound_attachment (lease names provider + signed ids)
       -> fresh message GET, attachment GET, signed CDN download -> private bucket inbound-attachment-originals
```

It uses the same tables, RPCs, review queue, attachment limits (PDF/PNG/JPEG, 10 MiB, 100 per message) and redaction as the historical Resend path. Migration `20260928180000_agentmail_inbound` does three things. It adds `agentmail` to `communication_provider_events.provider`. It makes AgentMail an `EMAIL` channel in `complete_inbound_communication`. It lets the attachment-capture functions accept AgentMail rows and return `provider`, `provider_message_id` and `provider_inbox_id` in the lease.

## Security properties

- **Signature.** The request is checked with the official Svix library (`npm:svix@2.5.0`) over the exact raw body, before any database access. A missing, invalid or tampered proof gets 401 and writes nothing.
- **Replay window.** Svix rejects timestamps more than 5 minutes from the server clock in either direction, and those requests get 401.
- **Idempotency.** `(provider, event_id)` is unique, with `event_id` set to `svix-id`, which Svix keeps the same across retries. A replay returns the original row, and a reused id with a changed payload hash fails with 23505, returned as 503. `(provider, resource_id)` is also unique, and `resource_id` is a deterministic UUIDv8 derived from the inbox id and message id. So one email becomes at most one inbound original, even if it arrives through several deliveries or webhooks.
- **Inbox binding.** The webhook refuses any `message.inbox_id` other than `AGENTMAIL_INBOX_ID`. The worker and capture step also check the derived resource id against the signed receipt metadata before making any provider request.
- **Provider content binding.** If the fetched message has a different `message_id`, `inbox_id` or sender than the signed receipt, the event goes to review, not to the inbox.
- **Payload cap.** Webhook bodies are capped at 4 MiB, because `message.received` includes the text and HTML. The provider GET is capped at 1 MB. A larger email goes to review and stays in AgentMail.
- **What is stored.** The webhook stores only the sender, the configured inbox address, the inbox, message, thread and event ids, and the creation time. The body is read later from the API. Provider attachment ids, content ids and URLs are never stored. Each attachment's `id` is a UUID derived from the message id and the provider attachment id, and capture works out the provider id again from a fresh message GET.
- **Attachment download.** The API key goes only to `api.agentmail.to`. The signed CDN URL is fetched with `credentials: "omit"` and `redirect: "error"`, and only over HTTPS on a public DNS name with no port, user info or fragment. Bytes are streamed within the stored size, checked against the file type, hashed with SHA-256 and read back from Storage before the capture finishes.
- **Ignored events.** `message.sent`, `delivered`, `bounced`, `complained`, `rejected`, `opened` and `domain.verified` get 202 and write nothing. `message.received.spam`, `.blocked` and `.unauthenticated` are also ignored on purpose. A spoofed sender must never reach a household thread, and those messages stay in the AgentMail console for manual review.
- **Logging.** Nothing is logged: no payloads, addresses or secrets.

## Outbound Reply-To

`resolveEmailReplyTo` in `_shared/delivery-policy.ts` sets the Reply-To for every Resend email, including frozen conversation, invoice, release and payment payloads:

- It uses `AGENTMAIL_INBOX_ADDRESS`, lower-cased.
- If `RESEND_REPLY_TO` is also set and names a different mailbox, there is no Reply-To, and every send fails closed ("valid practice reply mailbox").
- In `live` mode, sends fail closed if `AGENTMAIL_INBOX_ADDRESS` is unset or invalid.
- `test` and `disabled` modes may fall back to `RESEND_REPLY_TO` until AgentMail is configured.

Prepared payloads freeze the Reply-To. An email prepared before the address changes fails its frozen-payload check and must be prepared again.

## Threading

Replies are matched in this order:

1. If the reply's `In-Reply-To` or `References` includes a Message-ID the app already received, it joins that conversation.
2. Otherwise it joins the household's single active conversation. If there is none, a new conversation is created.
3. An unknown or shared sender waits in review, even if it quotes a known thread.

The app does not yet record the RFC Message-ID that Resend puts on outbound mail. A client's **first** reply to an app email is therefore threaded by household (step 2), not by header. This is enough because each household has at most one active conversation. Recording outbound Message-IDs is a possible follow-up.

## Choosing the receiving address (MX trade-off)

The root domain `thelivingroom.vet` stays on Fastmail. There are three options:

| Option | Address clients reply to | DNS and mail flow | Trade-offs |
| --- | --- | --- | --- |
| **A. Subdomain on AgentMail (recommended)** | `care@reply.thelivingroom.vet` | Add `reply.thelivingroom.vet` as an AgentMail custom domain. Publish the MX, SPF and DKIM records AgentMail generates for that subdomain. The root MX is unchanged. | Branded, and the email goes directly to AgentMail with no forwarding hop, so the sender's DKIM/DMARC survive. The address is used only as Reply-To; the visible From stays a Resend sender. This matches the `reply` subdomain in the [mail commissioning plan](mail-commissioning-plan.md), with AgentMail replacing Resend receiving. |
| B. AgentMail-hosted address | e.g. `livingroomvet@agentmail.to` | None. | Fastest to set up, but unbranded, and clients see a third-party domain. Good for the first controlled test. |
| C. Fastmail forwards `care@` to AgentMail | `care@thelivingroom.vet` | Add a Fastmail forwarding rule from `care@` to the AgentMail inbox address. | Keeps the familiar address, but adds a forwarding hop. AgentMail drops mail whose authentication headers fail ([docs](https://docs.agentmail.to/knowledge-base/inbound-emails-missing)), and forwarding can break SPF and DMARC. Replies are duplicated in the staff mailbox, and `care@` staff mail gets mixed with client threads. There is also a loop risk if AgentMail ever sends. Unverified; don't use without a test. |

**Recommendation: option A.** Use option B only for a first smoke test if the DNS isn't ready yet.

## Owner runbook

See [go-live runbook](go-live-runbook-2026-09.md) §8 for the ordered checklist. Summary:

1. **Create the inbox.** In the AgentMail console, add the custom domain `reply.thelivingroom.vet` ([custom domains](https://docs.agentmail.to/custom-domains)). Publish its records in GoDaddy, **only on the `reply` subdomain**, and wait for Verified. Then create the inbox `care@reply.thelivingroom.vet`. Record its `inbox_id` exactly as AgentMail shows it.
2. **Register the webhook**, scoped to that inbox and subscribed only to `message.received`, at `https://<ref>.supabase.co/functions/v1/agentmail-inbound-webhook` ([webhooks](https://docs.agentmail.to/webhooks-overview)). Copy its `whsec_…` signing secret.
3. **Create an API key** with the least privilege that can read that inbox's messages and attachments.
4. **Set secrets** (names only; values go in through the dashboard or an env file outside the repository): `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `AGENTMAIL_INBOX_ID`, `AGENTMAIL_INBOX_ADDRESS`. Unset `RESEND_REPLY_TO`, or set it to the same address.
5. **Deploy** `agentmail-inbound-webhook`, `process-inbound`, `capture-inbound-attachment` and the email senders (runbook §4).
6. **Controlled test** in `OUTBOUND_DELIVERY_MODE=test`, with `OUTBOUND_TEST_EMAILS=<owner's own mailbox>` and a synthetic household using that mailbox:
   1. Send one email from `/hub/chats`. Check that it arrives with `Reply-To: care@reply.thelivingroom.vet`.
   2. Reply from the owner's mailbox. The AgentMail webhook log should show 204, and `communication_provider_events` should gain one `agentmail` row.
   3. Invoke `process-inbound` once, or let the scheduler run it. The reply should appear in the same `/hub/chats` thread.
   4. Reply again with a small PDF attached. Capture it from the thread, and confirm it opens and its SHA-256 is recorded.
   5. Send one email from an unknown address to the inbox. It should go to `/hub/inbox/review`.
   6. Record the evidence, then set `OUTBOUND_DELIVERY_MODE=disabled` again.

## Verified against documentation (retrieved 2026-09-27)

- Webhook verification (Svix, `svix-id`/`svix-timestamp`/`svix-signature`, `whsec_` secrets, raw body): <https://docs.agentmail.to/webhook-verification>
- Event types and payloads (`event_type`, `event_id`, `message.inbox_id`, `message_id`, `from`, `created_at`; filtered variants must be subscribed explicitly): <https://docs.agentmail.to/events>
- Webhook scoping (`inbox_ids`, `event_types`, respond 2xx promptly): <https://docs.agentmail.to/webhooks-overview>
- Get Message (`GET /v0/inboxes/{inbox_id}/messages/{message_id}`, Bearer, `attachments[]`, `in_reply_to`, `references`, `headers`): <https://docs.agentmail.to/api-reference/inboxes/messages/get>
- Get Attachment (`download_url`, `expires_at`): <https://docs.agentmail.to/api-reference/inboxes/messages/get-attachment>
- Rate limits (429 with `Retry-After`): <https://docs.agentmail.to/knowledge-base/rate-limits>. The durable worker's exponential backoff covers this.
- Custom domains and subdomains (per-domain MX, SPF and DKIM; wildcard MX only for `subdomains_enabled`): <https://docs.agentmail.to/custom-domains>

## Unverified (isolated in `_shared/inbound/agentmail.ts`; confirm in the controlled test)

1. **Get Attachment response shape.** The API reference says JSON with `download_url`, but the Attachments guide says the raw file. The adapter accepts both, and the live shape must be confirmed.
2. **CDN host for `download_url`.** It isn't documented, so the adapter accepts any public HTTPS DNS host. Pin it once it is observed.
3. **`message_id` format.** The docs show RFC form (`<abc@domain>`), but it isn't confirmed that this is always the original Message-ID header. It is URL-encoded in API paths, and the encoding is also unconfirmed.
4. **`inbox_id` form.** The event examples show `inbox_…`, but some SDK examples use the inbox email address. Set `AGENTMAIL_INBOX_ID` to exactly what the webhook payload contains.
5. **`attachment_id` format and `content_type` casing and parameters.** Types are normalized to a lower-case media type without parameters.
6. **Svix retry schedule and 410 handling for AgentMail.** Defaults are assumed.
7. **Whether `message.received` for a forwarded message (option C) passes AgentMail authentication filtering.**
8. **EU region** (`api.agentmail.eu`) isn't supported; the US API origin is fixed.
