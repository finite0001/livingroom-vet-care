# Provider research and reference-hub comparison

Reviewed 2026-09-12. Recommendations are architectural judgments; vendor capabilities below are supported by official documentation. Live configuration and pricing were not verified.

## Email options

| Option | Strength | Tradeoff | Recommendation |
|---|---|---|---|
| Resend inbound/outbound | Existing outbound code; receiving webhooks and API content/attachment retrieval | We build threading, assignment, search and retention | Default |
| AgentMail | Managed inbox/thread/message primitives and custom domains | New provider model, integration and operational dependency | Prototype only if these primitives materially reduce effort |
| Both | Could separate automated transactional traffic and conversational mailboxes | Two integrations and careful reply/domain routing | Defer until a concrete need |
| Staff Gmail foundation | Existing reference ingestion | OAuth/watch/forwarding complexity and staff-account dependency | Not the requested architecture |

Resend supports email receiving on configured domains, with inbound content/attachments fetched through its API. This allows a custom staff inbox without Gmail. [Receiving documentation](https://resend.com/docs/dashboard/receiving/introduction), [content retrieval](https://resend.com/docs/knowledge-base/how-can-i-receive-emails-with-resend).

AgentMail supplies API inboxes and custom-domain support. It can be an alternative transport/mailbox service; autonomous clinical replies are not required. [Inboxes](https://docs.agentmail.to/inboxes), [custom domains](https://docs.agentmail.to/custom-domains/), [webhooks](https://docs.agentmail.to/webhooks-overview).

Own the practice domain and choose one receiving provider per mailbox/domain routing design. Do not configure competing MX destinations expecting both providers to receive copies. Provider verification should cover required SPF/DKIM/DMARC, reply routing and attachment round-trips. No domain name in existing website copy is assumed to be owned.

## SMS, payments and hosting

Twilio documents A2P 10DLC registration for US application messaging over local 10-digit numbers. Begin onboarding early rather than making launch depend on last-minute approval. Advanced Opt-Out supplies webhook opt-out state to synchronize into reminder suppression. [A2P overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out). This is an implementation dependency, not a legal-compliance conclusion.

Stripe Checkout provides hosted payment collection; webhooks support asynchronous payment updates. Use local invoice IDs/amounts server-side and verified payment events for reconciliation. Owner already prefers Stripe, so there is no demonstrated reason to introduce another processor now. [Checkout](https://docs.stripe.com/payments/checkout), [webhooks](https://docs.stripe.com/webhooks).

Lovable documents continued code editing after external deployment and the separate work needed to migrate backend data, files, auth and secrets. Existing Cloud passwords cannot be exported; plan reset if applicable. This supports the recommendation to establish owned Supabase before real patient onboarding. [External deployment/migration](https://docs.lovable.dev/tips-tricks/external-deployment-hosting), [hosting ownership](https://docs.lovable.dev/tips-tricks/deployment-hosting-ownership).

Vercel supports Vite apps. Keep this React Router v6 SPA and configure fallback rewrites for direct route loads; a framework rewrite is unnecessary for hosting. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## What to reuse from vet-connect-hub

Reference snapshot: `de3d530`, existing local checkout. Channel tabs, unread/priority/assignment/archive filters and patient search in `src/pages/ConversationsPage.tsx`; richer composer in `src/components/conversations/ReplyComposer.tsx`; timeline and patient context; server-side attachment authorization and webhook replay protection concepts.

Outbound email is already Resend. Gmail handles incoming mail through `gmail-push-handler`, `_shared/gmail-api.ts`, `_shared/google-oauth.ts`, watch renewal and reconciliation. Replace that ingestion layer rather than importing Gmail dependence. Reference `send-email` sets Reply-To to authenticated staff email; change this to the practice mailbox. Avoid hardcoded greentree.vet forwarding assumptions.

Reference email can send before its local message insert succeeds. Implement a durable outbox so every provider attempt has recoverable local intent. Replace conversation-global read Boolean with per-staff read state, channel filtering based only on last message with explicit thread/channel membership, and whole-dataset fetching with pagination/search.

The external ezyVet integration must be retained as a distinct adapter with source ownership and safe import semantics. See [detailed scope and safeguards](../external-pims-integration.md).

## Clinical review boundary

Certificate and clinical templates require current veterinarian review, including applicable Colorado/Boulder requirements. This planning task does not prescribe vaccine schedules, assert a retention duration or certify legal adequacy. The official [Colorado veterinary board rules](https://www.sos.state.co.us/CCR/GenerateRulePdf.do?ruleVersionId=10750) surfaced in research are a starting reference to verify for currency during template implementation, not a substitute for that review.

The Perplexity reference was inaccessible through the available web tool, so no design claims rely on its unseen contents.
